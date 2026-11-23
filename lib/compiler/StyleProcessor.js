import { captureUnitBaseline, sliceUnitContribution, canApplyUnitContribution, applyUnitContribution } from './style/unitCache.js';
import { processMediaQueries, scopeAtRules } from './style/atRules.js';
import { addVariable, applyVariables } from './style/variables.js';
import { StylePreprocessors, preprocessBlock } from './style/preprocessors.js';
import { registerSourceFile, appendGeneratedLine, getSourceMap, inlineSourceMapComment } from './style/sourceMap.js';
import crypto from 'crypto';
import path from 'path';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { tokenizeMarkup, applyEdits, leadingSpaceStart } from '../core/utils/markupLexer.js';
import { buildVoidTagsSet } from './parser/htmlTree.js';

/**
 * Strips CSS comments (/* ... *\/) from a CSS string, taking care not to touch comments within quoted strings.
 * @param {string} css - The CSS string.
 * @returns {string} The CSS string without comments.
 */
function stripCssComments(css) {
  let result = '';
  let inString = null; // null, '"', or "'"
  let i = 0;
  while (i < css.length) {
    const char = css[i];
    const nextChar = css[i + 1];

    if (inString) {
      result += char;
      if (char === '\\') {
        if (i + 1 < css.length) {
          result += css[i + 1];
          i += 2;
          continue;
        }
      } else if (char === inString) {
        inString = null;
      }
      i++;
    } else {
      if (char === '/' && nextChar === '*') {
        // Start of comment - preserve newlines to maintain line number alignment
        i += 2;
        while (i < css.length) {
          if (css[i] === '*' && css[i + 1] === '/') {
            i += 2;
            break;
          }
          if (css[i] === '\n') {
            result += '\n';
          } else {
            result += ' ';
          }
          i++;
        }
      } else {
        if (char === '"' || char === "'") {
          inString = char;
        }
        result += char;
        i++;
      }
    }
  }
  return result;
}

/**
 * Scopes custom CSS properties (variables) defined within a component's stylesheet.
 * Rewrites custom property declarations (e.g. --primary: red;) and usages (e.g. var(--primary))
 * by appending the component's unique hash (e.g. --ax-<hashId>-primary).
 * @param {string} cssContent - The CSS content (with comments stripped).
 * @param {string} hash - The component scope hash (e.g. 'avenx-12345678').
 * @returns {string} The CSS content with scoped custom properties.
 */
function scopeCustomProperties(cssContent, hash) {
  if (!cssContent || !hash) return cssContent;

  const hashId = hash.replace(/^avenx-/, '');
  const localPropNames = new Set();

  // 1. Scan CSS while ignoring text within string quotes ("..." or '...') to collect custom property declarations
  let inString = null;
  let i = 0;
  while (i < cssContent.length) {
    const char = cssContent[i];

    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      i++;
      continue;
    }

    // Look for custom property declaration starting with '--'
    if (char === '-' && cssContent[i + 1] === '-') {
      const prevChar = i > 0 ? cssContent[i - 1] : ' ';
      if (/[\s;{}]/.test(prevChar)) {
        let j = i + 2;
        let name = '';
        while (j < cssContent.length && /[\w-]/.test(cssContent[j])) {
          name += cssContent[j];
          j++;
        }
        while (j < cssContent.length && /\s/.test(cssContent[j])) {
          j++;
        }
        if (j < cssContent.length && cssContent[j] === ':') {
          if (name.length > 0) {
            localPropNames.add(name);
          }
        }
      }
    }
    i++;
  }

  if (localPropNames.size === 0) return cssContent;

  // 2. Sort names by length descending to prevent substring collision issues
  const sortedPropNames = Array.from(localPropNames).sort((a, b) => b.length - a.length);

  // 3. Replace property declarations and usages while preserving string literals
  const chunks = [];
  inString = null;
  let lastIndex = 0;
  i = 0;

  while (i < cssContent.length) {
    const char = cssContent[i];
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) {
        chunks.push({ isString: true, text: cssContent.substring(lastIndex, i + 1) });
        inString = null;
        lastIndex = i + 1;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      if (i > lastIndex) {
        chunks.push({ isString: false, text: cssContent.substring(lastIndex, i) });
      }
      inString = char;
      lastIndex = i;
      i++;
      continue;
    }

    i++;
  }

  if (lastIndex < cssContent.length) {
    chunks.push({ isString: inString !== null, text: cssContent.substring(lastIndex) });
  }

  for (const chunk of chunks) {
    if (chunk.isString) continue;

    for (const propName of sortedPropNames) {
      const scopedVarName = `--ax-${hashId}-${propName}`;
      const escapedPropName = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const declarationPattern = new RegExp(`(^|[\\s;{}])--${escapedPropName}(\\s*:)`, 'g');
      chunk.text = chunk.text.replace(declarationPattern, `$1${scopedVarName}$2`);

      const varPattern = new RegExp(`(var\\(\\s*)--${escapedPropName}(?=[\\s,)]|$)`, 'g');
      chunk.text = chunk.text.replace(varPattern, `$1${scopedVarName}`);
    }
  }

  return chunks.map((c) => c.text).join('');
}

const CSS_ANIMATION_KEYWORDS = new Set([
  'none',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'infinite',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

const TIMING_OR_NUMBER_OR_DIMENSION = /^[-+]?(?:\d*\.?\d+)(?:[a-zA-Z%]+)?$/;

/**
 * Splits CSS animation property value into comma-separated layers outside parentheses and quotes.
 * @param {string} value - The animation property value.
 * @returns {string[]} Array of animation layers.
 */
function splitLayers(value) {
  const layers = [];
  let current = '';
  let parenDepth = 0;
  let inString = null;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inString) {
      current += char;
      if (char === '\\') {
        if (i + 1 < value.length) current += value[++i];
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      current += char;
    } else if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
    } else if (char === ',' && parenDepth === 0) {
      layers.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  layers.push(current);
  return layers;
}

/**
 * Tokenizes a single animation layer by whitespace outside parentheses and quotes.
 * @param {string} layer - A single animation layer string.
 * @returns {string[]} Tokens within the layer.
 */
function tokenizeLayer(layer) {
  const tokens = [];
  let current = '';
  let parenDepth = 0;
  let inString = null;

  for (let i = 0; i < layer.length; i++) {
    const char = layer[i];
    if (inString) {
      current += char;
      if (char === '\\') {
        if (i + 1 < layer.length) current += layer[++i];
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      current += char;
    } else if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
    } else if (/\s/.test(char) && parenDepth === 0) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Rewrites a single token in an animation shorthand declaration if it matches a scoped keyframe.
 * @param {string} token - The animation token.
 * @param {Map<string, string>} keyframeMap - Map of declared keyframe names to scoped names.
 * @returns {string} The rewritten or unchanged token.
 */
function rewriteAnimationToken(token, keyframeMap) {
  if (token.includes('(')) return token;

  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    const quote = token[0];
    const unquoted = token.slice(1, -1);
    if (keyframeMap.has(unquoted)) {
      return `${quote}${keyframeMap.get(unquoted)}${quote}`;
    }
    return token;
  }

  const lower = token.toLowerCase();
  if (CSS_ANIMATION_KEYWORDS.has(lower)) return token;
  if (TIMING_OR_NUMBER_OR_DIMENSION.test(token)) return token;

  if (keyframeMap.has(token)) {
    return keyframeMap.get(token);
  }

  return token;
}

/**
 * Rewrites animation or -webkit-animation shorthand property value.
 * @param {string} value - The animation shorthand property value.
 * @param {Map<string, string>} keyframeMap - Map of declared keyframe names to scoped names.
 * @returns {string} The rewritten animation property value.
 */
function rewriteAnimationShorthandValue(value, keyframeMap) {
  const layers = splitLayers(value);
  return layers
    .map((layer) => {
      let important = '';
      const importantMatch = layer.match(/\s*!\s*important\s*$/i);
      let core = layer;
      if (importantMatch) {
        important = importantMatch[0];
        core = layer.slice(0, importantMatch.index);
      }
      const leadingWs = core.match(/^\s*/)[0];
      const trailingWs = core.match(/\s*$/)[0];
      const tokens = tokenizeLayer(core.trim());
      const rewritten = tokens.map((t) => rewriteAnimationToken(t, keyframeMap)).join(' ');
      return `${leadingWs}${rewritten}${trailingWs}${important}`;
    })
    .join(',');
}

/**
 * Rewrites animation-name or -webkit-animation-name property value.
 * @param {string} value - The animation-name property value.
 * @param {Map<string, string>} keyframeMap - Map of declared keyframe names to scoped names.
 * @returns {string} The rewritten animation-name property value.
 */
function rewriteAnimationNameValue(value, keyframeMap) {
  const layers = splitLayers(value);
  return layers
    .map((layer) => {
      let important = '';
      const importantMatch = layer.match(/\s*!\s*important\s*$/i);
      let core = layer;
      if (importantMatch) {
        important = importantMatch[0];
        core = layer.slice(0, importantMatch.index);
      }
      const leadingWs = core.match(/^\s*/)[0];
      const trailingWs = core.match(/\s*$/)[0];
      const trimmed = core.trim();
      let rewritten = trimmed;

      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        const quote = trimmed[0];
        const unquoted = trimmed.slice(1, -1);
        if (keyframeMap.has(unquoted)) {
          rewritten = `${quote}${keyframeMap.get(unquoted)}${quote}`;
        }
      } else if (!CSS_ANIMATION_KEYWORDS.has(trimmed.toLowerCase()) && keyframeMap.has(trimmed)) {
        rewritten = keyframeMap.get(trimmed);
      }

      return `${leadingWs}${rewritten}${trailingWs}${important}`;
    })
    .join(',');
}

/**
 * Collects all @keyframes and @-webkit-keyframes declared in a CSS string outside string literals.
 * @param {string} cssContent - CSS content (comments stripped).
 * @param {string} hash - Scope hash (e.g. 'avenx-ddfa3ca0').
 * @returns {Map<string, string>} Map of keyframe name to scoped name.
 */
function collectKeyframes(cssContent, hash) {
  const map = new Map();
  if (!cssContent || !hash) return map;
  const scopeHash = hash.replace(/^avenx-/, '');
  let inString = null;
  let i = 0;

  while (i < cssContent.length) {
    const char = cssContent[i];
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      i++;
      continue;
    }

    if (char === '@') {
      const rest = cssContent.substring(i);
      const match = rest.match(/^@(-webkit-)?keyframes\s+([^{]+)/i);
      if (match) {
        const rawName = match[2].trim();
        let unquotedName = rawName;
        if ((rawName.startsWith('"') && rawName.endsWith('"')) || (rawName.startsWith("'") && rawName.endsWith("'"))) {
          unquotedName = rawName.slice(1, -1);
        }
        if (unquotedName.length > 0) {
          map.set(unquotedName, `${unquotedName}-${scopeHash}`);
        }
        i += match[0].length;
        continue;
      }
    }
    i++;
  }
  return map;
}

/**
 * Scopes @keyframes declarations and animation references in a CSS block.
 * @param {string} cssContent - CSS content (comments stripped).
 * @param {string} hash - Scope hash (e.g. 'avenx-ddfa3ca0').
 * @param {Map<string, string>} [existingMap] - Optional shared keyframe map.
 * @returns {string} The CSS with scoped keyframes and animation declarations.
 */
function scopeKeyframes(cssContent, hash, existingMap = null) {
  if (!cssContent || !hash) return cssContent;
  const collected = collectKeyframes(cssContent, hash);
  const keyframeMap = existingMap || new Map();
  for (const [name, scopedName] of collected) {
    if (!keyframeMap.has(name)) {
      keyframeMap.set(name, scopedName);
    }
  }
  if (keyframeMap.size === 0) return cssContent;

  let result = '';
  let inString = null;
  let i = 0;

  while (i < cssContent.length) {
    const char = cssContent[i];

    if (inString) {
      result += char;
      if (char === '\\') {
        if (i + 1 < cssContent.length) {
          result += cssContent[++i];
        }
      } else if (char === inString) {
        inString = null;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      result += char;
      i++;
      continue;
    }

    // 1. Rewrite @keyframes / @-webkit-keyframes header
    if (char === '@') {
      const rest = cssContent.substring(i);
      const match = rest.match(/^@((-webkit-)?keyframes)\s+([^{]+)\{/i);
      if (match) {
        const atRuleKeyword = match[1];
        const rawName = match[3].trim();
        let unquoted = rawName;
        let quote = '';
        if ((rawName.startsWith('"') && rawName.endsWith('"')) || (rawName.startsWith("'") && rawName.endsWith("'"))) {
          quote = rawName[0];
          unquoted = rawName.slice(1, -1);
        }
        if (keyframeMap.has(unquoted)) {
          const scoped = keyframeMap.get(unquoted);
          result += `@${atRuleKeyword} ${quote ? quote + scoped + quote : scoped} {`;
          i += match[0].length;
          continue;
        }
      }
    }

    // 2. Rewrite animation / animation-name / -webkit-animation / -webkit-animation-name declaration
    const prevChar = i > 0 ? cssContent.slice(0, i).trim().slice(-1) : ';';
    if (prevChar === '' || prevChar === ';' || prevChar === '{' || prevChar === '}') {
      const rest = cssContent.substring(i);
      const declMatch = rest.match(/^((-webkit-)?animation(-name)?)\s*:/i);
      if (declMatch) {
        const propName = declMatch[1];
        const colonIdx = i + declMatch[0].length;
        let valEnd = colonIdx;
        let valParenDepth = 0;
        let valInString = null;

        while (valEnd < cssContent.length) {
          const c = cssContent[valEnd];
          if (valInString) {
            if (c === '\\') {
              valEnd += 2;
              continue;
            }
            if (c === valInString) {
              valInString = null;
            }
            valEnd++;
            continue;
          }
          if (c === '"' || c === "'") {
            valInString = c;
            valEnd++;
            continue;
          }
          if (c === '(') {
            valParenDepth++;
            valEnd++;
            continue;
          }
          if (c === ')') {
            valParenDepth = Math.max(0, valParenDepth - 1);
            valEnd++;
            continue;
          }
          if (valParenDepth === 0 && (c === ';' || c === '}')) {
            break;
          }
          valEnd++;
        }

        const rawVal = cssContent.substring(colonIdx, valEnd);
        const isNameOnly = /name$/i.test(propName);
        const rewrittenVal = isNameOnly
          ? rewriteAnimationNameValue(rawVal, keyframeMap)
          : rewriteAnimationShorthandValue(rawVal, keyframeMap);

        result += `${propName}:${rewrittenVal}`;
        if (valEnd < cssContent.length && cssContent[valEnd] === ';') {
          result += ';';
          i = valEnd + 1;
        } else {
          i = valEnd;
        }
        continue;
      }
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Transforms deep CSS pseudo-selectors (:deep(...) / ::v-deep(...) / ::v-deep / :deep)
 * into standard scoped selectors by removing the deep pseudo-selector wrappers/keywords.
 * @param {string} selector - The CSS selector string.
 * @returns {string} The transformed selector string.
 */
function transformDeepSelectors(selector) {
  let result = selector;

  // 1. Handle parenthesized :deep(...) and ::v-deep(...)
  let matchIndex;
  while ((matchIndex = result.search(/(?:::v-deep|:deep)\(/)) !== -1) {
    const pseudoStart = matchIndex;
    const openParenIdx = result.indexOf('(', pseudoStart);

    let depth = 1;
    let closeParenIdx = -1;
    for (let i = openParenIdx + 1; i < result.length; i++) {
      if (result[i] === '(') depth++;
      else if (result[i] === ')') {
        depth--;
        if (depth === 0) {
          closeParenIdx = i;
          break;
        }
      }
    }

    if (closeParenIdx === -1) {
      break;
    }

    let prefix = result.substring(0, pseudoStart);
    const innerContent = result.substring(openParenIdx + 1, closeParenIdx).trim();
    const suffix = result.substring(closeParenIdx + 1);

    const needsSpaceBefore = prefix.length > 0 && !/\s$/.test(prefix);

    if (/\s$/.test(prefix) && /^[\s]/.test(innerContent)) {
      prefix = prefix.trimEnd();
    }

    result = prefix + (needsSpaceBefore ? ' ' : '') + innerContent + suffix;
  }

  // 2. Handle non-parenthesized ::v-deep and :deep (e.g. .parent ::v-deep .child)
  result = result.replace(/\s*(?:::v-deep|:deep)(?=[\s>+~]|$)\s*/g, (match, offset, string) => {
    const before = string.substring(0, offset);
    const after = string.substring(offset + match.length);
    if (!before || /^[\s>+~]/.test(after) || /[\s>+~]$/.test(before)) {
      return '';
    }
    return ' ';
  });

  return result;
}

/**
 * Applies a component hash to each selector in a selector list.
 * Commas inside functions, attribute selectors, strings, and escapes are not
 * selector delimiters and must be preserved.
 * @param {string} selectorList - The CSS selector list.
 * @param {string} hash - The component scope hash.
 * @returns {string} The scoped selector list.
 */
function scopeSelectorList(selectorList, hash) {
  const selectors = [];
  let current = '';
  let inString = null;
  let parenthesisDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorList.length; i++) {
    const char = selectorList[i];

    if (char === '\\') {
      current += char;
      if (i + 1 < selectorList.length) {
        current += selectorList[++i];
      }
      continue;
    }

    if (inString) {
      current += char;
      if (char === inString) inString = null;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      current += char;
    } else if (char === '(') {
      parenthesisDepth++;
      current += char;
    } else if (char === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      current += char;
    } else if (char === '[') {
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
    } else if (char === ',' && parenthesisDepth === 0 && bracketDepth === 0) {
      selectors.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  selectors.push(current);

  const hashClass = `.${hash}`;

  return selectors
    .map((selector) => selector.trim())
    .filter(Boolean)
    .map((selector) => {
      let scoped;
      if (selector.includes('&')) {
        scoped = selector.replace(/&/g, hashClass);
      } else if (selector.startsWith(hashClass) || selector.includes(hashClass)) {
        scoped = selector;
      } else {
        scoped = `${hashClass}${selector}`;
      }
      return transformDeepSelectors(scoped);
    })
    .join(', ');
}

/**
 * StyleProcessor is responsible for handling all CSS-related logic during the build process.
 * This includes managing global CSS variables, scoping component-specific styles using hashes,
 * and extracting CSS rules into a global stylesheet.
 */
class StyleProcessor {
  /**
   * Explicit state shared with incremental stylesheet bookkeeping.
   * @returns {object} Current collections and scalar stylesheet text.
   */
  #unitCacheState() {
    return {
      sourcesCache: this.sourcesCache,
      rawGlobalCSS: this.rawGlobalCSS,
      cssVariables: this.cssVariables,
      rawGlobalCSSSourceInfo: this.rawGlobalCSSSourceInfo,
      scopedStyles: this.scopedStyles,
      scopedRules: this.scopedRules,
      addedHashes: this.#addedHashes
    };
  }

  /** @type {StylePreprocessors} Optional package cache and warning deduplication. */
  #preprocessors = new StylePreprocessors();

  /**
   * Tracks which hashes have already been added to globalStyles to prevent duplicates.
   * @type {Set<string>}
   * @private
   */
  #addedHashes = new Set();

  /**
   * Creates an instance of StyleProcessor.
   * @param {object} [options] - Configuration options.
   * @param {object} [config] - Project configuration object.
   */
  constructor(options = {}, config = null) {
    this.options = options;
    this.config = config || (options && options.config ? options.config : null);
    this.reset();
  }

  /**
   * Resets the processor state, clearing all accumulated styles and variables.
   */
  reset() {
    /**
     * The accumulated global stylesheet content.
     * @type {string}
     */
    this.globalStyles = '';

    /**
     * A map of CSS variable names to their values.
     * @type {Object<string, string>}
     */
    this.cssVariables = {};

    /**
     * Raw global CSS rules added via addGlobalCSS.
     * @type {Set<string>}
     */
    this.rawGlobalCSS = new Set();

    /**
     * Raw global CSS rules metadata mapping.
     * @type {object[]}
     */
    this.rawGlobalCSSSourceInfo = [];

    /**
     * Scoped CSS rules.
     * @type {string}
     */
    this.scopedStyles = '';

    this.#addedHashes = new Set();
    this.#preprocessors.resetWarnings();

    /**
     * Cache mapping original CSS file path to its content string.
     * @type {Map<string, string>}
     */
    this.sourcesCache = new Map();

    /**
     * List of scoped CSS rules to build the source map lines.
     * @type {object[]}
     */
    this.scopedRules = [];

    /**
     * Accumulated list of all generated CSS lines with their mapping metadata.
     * @type {object[]}
     */
    this.generatedLines = [];

    /**
     * Component-level keyframe map for scoping animation declarations.
     * @type {Map<string, string>|null}
     */
    this.currentKeyframeMap = null;
  }

  /**
   * Snapshots how much has been accumulated, so one unit's contribution can be
   * told apart from the build's.
   *
   * The compilation cache in `incrementalCache.js` reuses a unit's whole
   * compilation product, and a unit's stylesheet is part of that product: the
   * scoped rules it produced have to land in the same place in the output as
   * they would have on a cold build. Capturing that from outside is not
   * possible without the private de-duplication set. The delegate passes that
   * set explicitly to the stylesheet contribution helpers.
   * @returns {object} A baseline for {@link StyleProcessor#sliceUnitContribution}.
   */
  captureUnitBaseline() {
    return captureUnitBaseline(this.#unitCacheState());
  }

  /**
   * Collects everything added since a baseline.
   *
   * Every field this processor accumulates per unit is append-only, so the
   * difference from a baseline is exactly one unit's contribution.
   * @param {object} baseline - From {@link StyleProcessor#captureUnitBaseline}.
   * @returns {object} The contribution, for {@link StyleProcessor#applyUnitContribution}.
   */
  sliceUnitContribution(baseline) {
    return sliceUnitContribution(this.#unitCacheState(), baseline);
  }

  /**
   * Whether a stored contribution can be replayed into the current state.
   *
   * `extractRules` ignores a scope hash it has already seen, so a contribution
   * whose hash is present would have produced nothing on a cold build while
   * replaying it would append the rules a second time. Two units do not share a
   * scope hash in practice, so this is a guard rather than a code path -- but
   * "in practice" is not the standard for something that decides what reaches a
   * stylesheet, and the caller can always compile the unit instead.
   * @param {object} contribution - From {@link StyleProcessor#sliceUnitContribution}.
   * @returns {boolean} True when replaying reproduces a cold build.
   */
  canApplyUnitContribution(contribution) {
    return canApplyUnitContribution(this.#unitCacheState(), contribution);
  }

  /**
   * Replays a stored contribution, in the position a cold build would have put it.
   * @param {object} contribution - From {@link StyleProcessor#sliceUnitContribution}.
   * @returns {void}
   */
  applyUnitContribution(contribution) {
    this.scopedStyles = applyUnitContribution(this.#unitCacheState(), contribution);
  }

  /**
   * Registers a source stylesheet content for source map generation.
   * @param {string} filePath - Absolute file path of the style source.
   * @param {string} content - CSS content of the source.
   */
  registerSourceFile(filePath, content) {
    return registerSourceFile(this.sourcesCache, filePath, content);
  }

  /**
   * Adds a global CSS variable to the processor.
   * @param {string} name - The name of the variable (without the @ prefix).
   * @param {string} value - The value of the variable.
   */
  addVariable(name, value) {
    return addVariable(this.cssVariables, name, value);
  }

  /**
   * Adds raw global CSS rules to the stylesheet.
   * @param {string} css - The raw CSS string.
   * @param {string} [sourceFile] - Source file path.
   * @param {number} [startLine] - Start line number in the source file.
   */
  addGlobalCSS(css, sourceFile = '', startLine = 1) {
    this.rawGlobalCSS.add(css);
    this.rawGlobalCSSSourceInfo.push({ css, sourceFile, startLine });
  }

  /**
   * Generates a base64 inline source map comment.
   * @param {string} [distDir] - Output directory.
   * @param {string} [cssFileName] - Output CSS filename.
   * @returns {string} The base64 inline source map comment string.
   */
  getInlineSourceMapComment(distDir = '', cssFileName = 'bundle.css') {
    if (!this.generatedLines || this.generatedLines.length === 0) {
      this.getGlobalStyles();
    }
    return inlineSourceMapComment(this.getSourceMap(distDir, cssFileName));
  }

  /**
   * Retrieves the accumulated global styles.
   * @param {object|boolean} [options] - Options or boolean indicating if dev inline source maps should be included.
   * @param {Set<string>} [options.includeSources] - Stylesheet paths that reached
   *   the bundle. When given, styles from any other source file are left out.
   * @returns {string} The complete CSS string for the application.
   */
  getGlobalStyles(options = {}) {
    this.generatedLines = [];

    // Header comment
    this.appendGeneratedLine('/* Generated by Avenx-JS */');

    // Which stylesheets reached the bundle. Every component is compiled so that
    // Atlas can describe the project as written, but a component the bundler
    // shook out must not leave its CSS behind -- that would be dead weight the
    // old pipeline did not ship, because it only ever parsed the components it
    // kept.
    const included = options && options.includeSources instanceof Set ? options.includeSources : null;
    const wanted = (sourceFile) => !included || !sourceFile || included.has(sourceFile);

    // 1. Global CSS rules
    for (const css of this.rawGlobalCSS) {
      const info = this.rawGlobalCSSSourceInfo.find((item) => item.css === css);
      const sourceFile = info ? info.sourceFile : '';
      const startLine = info ? info.startLine : 1;

      if (!wanted(sourceFile)) {
        continue;
      }

      const appliedCss = this.applyVariables(css, sourceFile);
      const lines = appliedCss.split('\n');
      lines.forEach((line, idx) => {
        this.appendGeneratedLine(line, sourceFile, sourceFile ? startLine + idx : null);
      });
    }

    // Divider comment
    this.appendGeneratedLine('/* Scoped Styles */');

    // 2. Scoped styles
    for (const item of this.scopedRules) {
      if (!wanted(item.sourceFile)) {
        continue;
      }
      this.appendGeneratedLine(item.text, item.sourceFile, item.sourceLine);
    }

    let cssOutput = this.generatedLines.map((l) => l.text).join('\n');

    const opts = typeof options === 'boolean' ? { dev: options } : options || {};
    const isDevMode =
      opts.dev === true ||
      opts.inlineSourceMap === true ||
      opts.sourceMap === 'inline' ||
      (this.options &&
        (this.options.dev === true || this.options.inlineSourceMap === true || this.options.sourceMap === 'inline')) ||
      (this.config &&
        (this.config.dev === true ||
          (this.config.style && (this.config.style.dev === true || this.config.style.sourceMap === 'inline'))));

    if (isDevMode) {
      const distDir = opts.distDir || '';
      const cssFileName = opts.cssFileName || 'bundle.css';
      const inlineComment = this.getInlineSourceMapComment(distDir, cssFileName);
      cssOutput += `\n${inlineComment}\n`;
    }

    return cssOutput;
  }

  /**
   * Helper to append a generated CSS line.
   * @param {string} text - Line contents.
   * @param {string|null} [sourceFile] - Original stylesheet file path.
   * @param {number|null} [sourceLine] - Original line number (1-based).
   */
  appendGeneratedLine(text, sourceFile = null, sourceLine = null) {
    return appendGeneratedLine(this.generatedLines, text, sourceFile, sourceLine);
  }

  /**
   * Generates the Source Map v3 JSON object.
   * @param {string} distDir - The absolute directory path of the output bundle.
   * @param {string} cssFileName - The name of the CSS bundle file (e.g., 'bundle.css').
   * @returns {object} The source map object.
   */
  getSourceMap(distDir, cssFileName = 'bundle.css') {
    return getSourceMap(this.generatedLines, this.sourcesCache, this.config, distDir, cssFileName);
  }

  /**
   * Applies scoped style blocks to a template.
   *
   * Two spellings name a block declared inside `<@css>` in the component
   * stylesheet:
   *
   * - the attribute `<div @css card>`, which styles that element;
   * - the tag `<@css card />`, which styles the element it is the first child
   *   of, or the element it immediately follows (styling.md, section 2).
   *
   * The template is read with the shared markup lexer and edited by the spans
   * it reports, so a `>` or `<!--` inside an attribute value can never be
   * mistaken for markup. Every other character of the template is left exactly
   * as written.
   *
   * Problems are not thrown from here, because a stylesheet processor does not
   * know which file or source line a template came from. They are recorded on
   * {@link StyleProcessor#lastDiagnostics} for the component parser to report
   * with a location.
   * @param {string} html - The template.
   * @param {object} [desBlocks] - Style blocks by name.
   * @param {string} [componentName] - The component name, part of the hash.
   * @param {string} [desPath] - The stylesheet path, for source maps.
   * @param {string[]} [customVoidTags] - Additional void tag names.
   * @returns {string} The template with every style directive applied.
   */
  process(html, desBlocks = {}, componentName = '', desPath = '', customVoidTags = []) {
    /** @type {Array<{severity: string, code: string, args: string[], offset: number, snippet: string}>} */
    this.lastDiagnostics = [];

    if (typeof html !== 'string' || !html.includes('@css')) {
      this.#reportUnusedStyleBlocks(desBlocks, new Set(), componentName, desPath);
      return html;
    }

    const tokens = tokenizeMarkup(html);
    const voidTags = buildVoidTagsSet(customVoidTags);
    const blocks = desBlocks || {};

    this.currentKeyframeMap = new Map();
    if (blocks && typeof blocks === 'object') {
      for (const [blockName, blockCss] of Object.entries(blocks)) {
        if (blockName.startsWith('_') || typeof blockCss !== 'string') continue;
        const blockHash = this.getHash(blockCss, componentName);
        const collected = collectKeyframes(blockCss, blockHash);
        for (const [name, scopedName] of collected) {
          if (!this.currentKeyframeMap.has(name)) {
            this.currentKeyframeMap.set(name, scopedName);
          }
        }
      }
    }
    const snippetOf = (token) => html.slice(token.start, token.end);
    const record = (severity, code, token, args) => {
      this.lastDiagnostics.push({ severity, code, args, offset: token.start, snippet: snippetOf(token) });
    };

    /** @type {Map<object, {removals: Array<{start: number, end: number}>, hashes: string[]}>} */
    const tagEdits = new Map();
    const editsFor = (token) => {
      let entry = tagEdits.get(token);
      if (!entry) {
        entry = { removals: [], hashes: [] };
        tagEdits.set(token, entry);
      }
      return entry;
    };
    /** @type {Array<{start: number, end: number, text: string}>} */
    const edits = [];
    const attributeUses = [];
    const elementUses = [];

    // Pass 1: find every use, and which open tag each close tag closes. The
    // matching mirrors the tree parser: a close tag pops to the nearest open
    // tag of the same name, and void or self-closing tags never open a scope.
    const openStack = [];
    /** @type {Map<object, object>} */
    const openerOf = new Map();
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];

      if (token.type === 'close') {
        const name = token.name.toLowerCase();
        if (name === '@css') {
          edits.push({ start: token.start, end: token.end, text: '' });
          continue;
        }
        for (let j = openStack.length - 1; j >= 0; j--) {
          if (openStack[j].name.toLowerCase() === name) {
            openerOf.set(token, openStack[j]);
            openStack.length = j;
            break;
          }
        }
        continue;
      }

      if (token.type !== 'open' || token.unterminated) continue;

      if (token.name === '@css') {
        elementUses.push({ token, index });
        continue;
      }

      for (let a = 0; a < token.attrs.length; a++) {
        const attr = token.attrs[a];
        if (attr.name !== '@css') continue;

        if (attr.value !== null) {
          record('error', AvenxErrorCodes.COMPILER_INVALID_STYLE_DIRECTIVE, token, [
            componentName,
            '@css takes the block name as the next word, not as a value',
          ]);
          continue;
        }
        const nameAttr = token.attrs[a + 1];
        if (!nameAttr || nameAttr.value !== null || !/^[\w-]+$/.test(nameAttr.name)) {
          record('error', AvenxErrorCodes.COMPILER_INVALID_STYLE_DIRECTIVE, token, [
            componentName,
            '@css must be followed by a style block name',
          ]);
          continue;
        }
        attributeUses.push({ token, blockName: nameAttr.name });
        editsFor(token).removals.push({ start: leadingSpaceStart(html, attr.start), end: nameAttr.end });
        a++;
      }

      if (!token.selfClosing && !token.directive && !voidTags.has(token.name.toLowerCase())) {
        openStack.push(token);
      }
    }

    const hashFor = (blockName, token) => {
      const cssContent = blocks[blockName];
      if (!cssContent) {
        const where = desPath ? ` (${path.basename(desPath)})` : '';
        record('warning', AvenxErrorCodes.COMPILER_UNKNOWN_STYLE_BLOCK, token, [componentName, blockName, where]);
        return null;
      }
      const metadata = blocks._sourceMapInfo && blocks._sourceMapInfo[blockName];
      const sourceFile = metadata ? metadata.sourceFile : desPath;
      const startLine = metadata ? metadata.startLine : 1;
      const hash = this.getHash(cssContent, componentName);

      // Update this line to pass sourceFile to applyVariables:
      this.extractRules(this.applyVariables(cssContent, sourceFile), hash, sourceFile, startLine);
      return hash;
    };

    // Attribute uses first, then tag uses, each in source order: the order the
    // blocks are first emitted into the stylesheet is unchanged from the
    // previous implementation.
    for (const use of attributeUses) {
      const hash = hashFor(use.blockName, use.token);
      if (hash) editsFor(use.token).hashes.push(hash);
    }

    for (const { token, index } of elementUses) {
      edits.push({ start: token.start, end: token.end, text: '' });

      const nameAttr = token.attrs[0];
      if (!nameAttr && !token.selfClosing) {
        // `<@css> rules </@css>` written in the template rather than in the
        // stylesheet. It was never read as styles: the template fell back to
        // the string renderer, which printed the rules into the page as text.
        record('error', AvenxErrorCodes.COMPILER_INVALID_STYLE_DIRECTIVE, token, [
          componentName,
          '<@css> blocks belong in the component stylesheet (the matching .component.css or .page.css file), not in the template',
        ]);
        continue;
      }
      if (!nameAttr || nameAttr.value !== null || !/^[\w-]+$/.test(nameAttr.name)) {
        record('error', AvenxErrorCodes.COMPILER_INVALID_STYLE_DIRECTIVE, token, [
          componentName,
          '<@css /> must name a style block',
        ]);
        continue;
      }

      const target = this.#styleTarget(tokens, index, openerOf, html);
      if (!target) {
        record('warning', AvenxErrorCodes.COMPILER_STYLE_DIRECTIVE_NO_TARGET, token, [componentName, nameAttr.name]);
        continue;
      }
      const hash = hashFor(nameAttr.name, token);
      if (hash) editsFor(target).hashes.push(hash);
    }

    const used = new Set([
      ...attributeUses.map((use) => use.blockName),
      ...elementUses.map(({ token }) => token.attrs[0] && token.attrs[0].name).filter(Boolean),
    ]);
    this.#reportUnusedStyleBlocks(blocks, used, componentName, desPath);

    for (const [token, entry] of tagEdits) {
      edits.push(...this.#classEdits(html, token, entry));
    }

    const result = applyEdits(html, edits);
    this.currentKeyframeMap = null;
    return result;
  }

  /**
   * Reports style blocks the template never names (AVX_W55).
   *
   * Such a block is dropped: nothing hashes it, so none of its rules reach the
   * stylesheet. That was silent, and silence is the whole problem -- the build
   * succeeds, the page renders unstyled, and nothing connects the two. It is
   * also the exact failure of writing the stylesheet as ordinary CSS
   * (`.card { ... }`) and the template with class attributes, because `.card`
   * is then a block *named* ".card" that no `@css` directive can even spell.
   *
   * Reported once per component with every unused name, rather than once per
   * block: a stylesheet that is wholly unused is one mistake, not eight.
   * Recorded with a negative offset, since the location is a line in the
   * stylesheet rather than anywhere in the template.
   * @param {object} blocks - Declared style blocks by name.
   * @param {Set<string>} used - Block names the template referenced.
   * @param {string} componentName - The component name, for the message.
   * @param {string} desPath - The stylesheet path.
   * @returns {void}
   */
  #reportUnusedStyleBlocks(blocks, used, componentName, desPath) {
    if (!blocks || typeof blocks !== 'object') return;

    const unused = Object.keys(blocks).filter(
      (name) => !name.startsWith('_') && !used.has(name) && blocks[name],
    );
    if (unused.length === 0) return;

    const where = desPath ? path.basename(desPath) : 'the component stylesheet';
    this.lastDiagnostics.push({
      severity: 'warning',
      code: AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK,
      args: [componentName || 'this component', unused.map((name) => `"${name}"`).join(', '), where],
      offset: -1,
      snippet: '',
    });
  }

  /**
   * Finds the element a `<@css />` tag at `index` styles.
   *
   * Looking back past whitespace and other `<@css />` tags: an open tag is the
   * host (the directive is its first child) or a preceding void or self-closing
   * sibling; a close tag means the directive follows that element, which is
   * styled. Anything else -- text, an interpolation, a comment, a directive --
   * leaves the tag without a target.
   * @param {object[]} tokens - The template tokens.
   * @param {number} index - Index of the `<@css />` token.
   * @param {Map<object, object>} openerOf - Close token to its open token.
   * @param {string} html - The template.
   * @returns {object|null} The open token to style, or null.
   */
  #styleTarget(tokens, index, openerOf, html) {
    for (let k = index - 1; k >= 0; k--) {
      const previous = tokens[k];
      if (previous.type === 'text' && html.slice(previous.start, previous.end).trim() === '') continue;
      if (previous.type === 'open' && previous.name === '@css') continue;
      if (previous.type === 'close' && previous.name.toLowerCase() === '@css') continue;

      const candidate = previous.type === 'open' ? previous : previous.type === 'close' ? openerOf.get(previous) : null;
      if (candidate && !candidate.unterminated && /^[A-Za-z][A-Za-z0-9-]*$/.test(candidate.name)) {
        return candidate;
      }
      return null;
    }
    return null;
  }

  /**
   * Builds the edits that remove style directives from one tag and merge the
   * resulting classes into its `class` attribute.
   *
   * New classes are prepended to an existing quoted `class` value, and a tag
   * without one gains `class="…"` as its last attribute -- the same output the
   * previous implementation produced for the forms it handled.
   * @param {string} html - The template.
   * @param {object} token - The open-tag token.
   * @param {{removals: Array<{start: number, end: number}>, hashes: string[]}} entry - What to change.
   * @returns {Array<{start: number, end: number, text: string}>} The edits.
   */
  #classEdits(html, token, entry) {
    const edits = entry.removals.map((range) => ({ start: range.start, end: range.end, text: '' }));
    const removed = (attr) => entry.removals.some((range) => attr.start >= range.start && attr.end <= range.end);
    const classAttr = token.attrs.find((attr) => attr.name.toLowerCase() === 'class' && !removed(attr));
    const existing = classAttr && classAttr.value !== null ? classAttr.value : '';
    const hashes = [...new Set(entry.hashes)].filter((hash) => !existing.split(/\s+/).includes(hash));

    if (hashes.length === 0) {
      return edits;
    }
    const merged = `${hashes.join(' ')} ${existing}`;

    if (classAttr && classAttr.quote) {
      edits.push({ start: classAttr.valueStart, end: classAttr.valueEnd, text: merged });
    } else if (classAttr) {
      edits.push({ start: classAttr.start, end: classAttr.end, text: `class="${merged.trim()}"` });
    } else if (token.selfClosing) {
      edits.push({ start: leadingSpaceStart(html, token.attrEnd), end: token.attrEnd, text: ` class="${hashes.join(' ')}" ` });
    } else {
      const gt = token.end - 1;
      edits.push({ start: Math.max(leadingSpaceStart(html, gt), token.nameEnd), end: gt, text: ` class="${hashes.join(' ')}"` });
    }
    return edits;
  }

  /**
   * Merges a CSS class hash into an existing tag string, handling existing class attributes.
   * @param {string} tagContent - The content of the tag (e.g., "div id='foo'").
   * @param {string} hash - The CSS class hash to merge.
   * @returns {string} The updated tag content.
   * @private
   */
  mergeClassIntoTag(tagContent, hash) {
    const classRegex = /(?<=^|\s)class="([^"]*)"|(?<=^|\s)class='([^']*)'/;
    const match = tagContent.match(classRegex);

    if (match) {
      const isSingleQuote = match[2] !== undefined;
      const existingClasses = isSingleQuote ? match[2] : match[1];
      const quote = isSingleQuote ? "'" : '"';

      if (existingClasses.includes(hash)) return tagContent;

      const newClassAttr = `class=${quote}${hash} ${existingClasses}${quote}`;
      return tagContent.replace(match[0], newClassAttr);
    } else {
      // Check if it's a self-closing tag or has other attributes
      if (tagContent.trim().endsWith('/')) {
        return tagContent.replace(/\s*\/$/, ` class="${hash}" /`);
      }
      return tagContent.trimEnd() + ` class="${hash}"`;
    }
  }

  /**
   * Replaces CSS variables (e.g., @primary) with their values.
   * @param {string} cssContent - The CSS content to process.
   * @param {string} [sourceFile] - Source file path for error reporting.
   * @returns {string} The CSS content with variables replaced.
   */
  applyVariables(cssContent, sourceFile = '') {
    return applyVariables(this.cssVariables, this.config, cssContent, sourceFile);
  }

  /**
   * Generates a unique hash for a CSS block.
   * @param {string} cssContent - The CSS content.
   * @param {string} componentName - The name of the component.
   * @returns {string} The generated hash.
   */
  getHash(cssContent, componentName) {
    return (
      'avenx-' +
      crypto
        .createHash('md5')
        .update(cssContent + componentName)
        .digest('hex')
        .substring(0, 8)
    );
  }

  /**
   * Processes CSS rules inside an @media block cleanly in a single AST pass,
   * injecting component scope hash classes onto root element selectors without duplication.
   * @param {string} selector - The @media query header (e.g. "@media (max-width: 600px)").
   * @param {string} body - The CSS content inside the @media block.
   * @param {number} originalLine - Source line number.
   * @param {number} bodyStartLine - Source line number for body.
   * @param {Function} scopeRulesFn - Function reference for scoping rules inside the media block.
   * @returns {object[]} Array of scoped rule objects.
   * @private
   */
  _processMediaQueries(selector, body, originalLine, bodyStartLine, scopeRulesFn) {
    return processMediaQueries(selector, body, originalLine, bodyStartLine, scopeRulesFn);
  }

  /**
   * Extracts CSS rules from a content string, scopes them using the provided hash,
   * and appends them to the global stylesheet.
   * @param {string} cssContent - The CSS content to extract rules from.
   * @param {string} hash - The hash to use for scoping.
   * @param {string} [sourceFile] - Source file path.
   * @param {number} [startLine] - Start line number in the source file.
   * @param {Map<string, string>} [keyframeMap] - Optional keyframe map for scoping animation declarations.
   * @private
   */
  extractRules(cssContent, hash, sourceFile = '', startLine = 1, keyframeMap = null) {
    if (this.#addedHashes.has(hash)) return;
    this.#addedHashes.add(hash);

    const activeMap = keyframeMap || this.currentKeyframeMap || null;
    const cleanCss = scopeKeyframes(scopeCustomProperties(stripCssComments(cssContent), hash), hash, activeMap);

    const scoped = scopeAtRules(cleanCss, startLine, hash,
      (selector) => scopeSelectorList(selector, hash),
      (...args) => this._processMediaQueries(...args));
    scoped.forEach((r) => {
      this.scopedStyles += r.cssLine + '\n';
      this.scopedRules.push({
        text: r.cssLine,
        sourceFile: sourceFile,
        sourceLine: r.sourceLine,
      });
    });
  }

  /**
   * Preprocesses CSS content using the configured preprocessor.
   * @param {string} cssContent - The raw CSS/SCSS content.
   * @param {string} type - The preprocessor type.
   * @returns {string} The compiled CSS.
   */
  preprocessCss(cssContent, type) {
    return this.#preprocessors.preprocessCss(cssContent, type, this.config);
  }

  /**
   * Preprocesses an individual CSS block by wrapping it and compiling.
   * @param {string} rawGlobalCss - The raw global CSS content.
   * @param {string} blockBody - The raw CSS block body.
   * @param {string} preprocessor - The preprocessor type.
   * @returns {string} The preprocessed and filtered CSS block body.
   */
  preprocessBlock(rawGlobalCss, blockBody, preprocessor) {
    return preprocessBlock(rawGlobalCss, blockBody, preprocessor,
      (css, type) => this.preprocessCss(css, type),
      (css, placeholder) => this.filterScopedRules(css, placeholder));
  }

  /**
   * Filters compiled CSS rules to keep only those targeting the placeholder class.
   * @param {string} compiledCss - The compiled CSS.
   * @param {string} placeholder - The placeholder class name.
   * @returns {string} The filtered rules with placeholder replaced by parent selector &.
   */
  filterScopedRules(compiledCss, placeholder) {
    const rules = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < compiledCss.length; i++) {
      const char = compiledCss[i];
      current += char;
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          rules.push(current.trim());
          current = '';
        }
      }
    }
    return rules
      .filter((rule) => rule.includes(placeholder))
      .map((rule) => rule.replaceAll(`.${placeholder}`, '&'))
      .join('\n');
  }
}

export { encodeVLQ, encodeMapping } from './style/sourceMap.js';

export { collectKeyframes, scopeKeyframes };
export default StyleProcessor;
