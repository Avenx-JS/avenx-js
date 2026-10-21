import crypto from 'crypto';
import path from 'path';
import { createRequire } from 'module';
import { logger } from '../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { StyleCompilerError } from './errors/index.js';
import { reportWarning } from './utils/warningReporter.js';
import { tokenizeMarkup, applyEdits, leadingSpaceStart } from '../core/utils/markupLexer.js';
import { buildVoidTagsSet } from './parser/htmlTree.js';
import { getClosestKey } from '../config.js';

const require = createRequire(import.meta.url);

const STANDARD_AT_RULES = new Set([
  '@media',
  '@supports',
  '@keyframes',
  '@font-face',
  '@layer',
  '@container',
  '@import',
  '@charset',
  '@namespace',
  '@property',
  '@page',
]);

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
  }

  /**
   * Snapshots how much has been accumulated, so one unit's contribution can be
   * told apart from the build's.
   *
   * The compilation cache in `incrementalCache.js` reuses a unit's whole
   * compilation product, and a unit's stylesheet is part of that product: the
   * scoped rules it produced have to land in the same place in the output as
   * they would have on a cold build. Capturing that from outside is not
   * possible, because the de-duplication set is private to this class -- which
   * is why the capture lives here rather than there.
   * @returns {object} A baseline for {@link StyleProcessor#sliceUnitContribution}.
   */
  captureUnitBaseline() {
    return {
      sourceKeys: new Set(this.sourcesCache.keys()),
      rawGlobalCSS: new Set(this.rawGlobalCSS),
      variables: { ...this.cssVariables },
      hashes: new Set(this.#addedHashes),
      scopedStylesLength: this.scopedStyles.length,
      sourceInfoLength: this.rawGlobalCSSSourceInfo.length,
      scopedRulesLength: this.scopedRules.length,
    };
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
    return {
      sources: [...this.sourcesCache.entries()].filter(([file]) => !baseline.sourceKeys.has(file)),
      rawGlobalCSS: [...this.rawGlobalCSS].filter((css) => !baseline.rawGlobalCSS.has(css)),
      sourceInfo: this.rawGlobalCSSSourceInfo.slice(baseline.sourceInfoLength),
      variables: Object.entries(this.cssVariables).filter(([name, value]) => baseline.variables[name] !== value),
      hashes: [...this.#addedHashes].filter((hash) => !baseline.hashes.has(hash)),
      scopedStyles: this.scopedStyles.slice(baseline.scopedStylesLength),
      scopedRules: this.scopedRules.slice(baseline.scopedRulesLength),
    };
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
    if (!contribution) return false;
    return !contribution.hashes.some((hash) => this.#addedHashes.has(hash));
  }

  /**
   * Replays a stored contribution, in the position a cold build would have put it.
   * @param {object} contribution - From {@link StyleProcessor#sliceUnitContribution}.
   * @returns {void}
   */
  applyUnitContribution(contribution) {
    for (const [file, content] of contribution.sources) {
      this.sourcesCache.set(file, content);
    }
    for (const css of contribution.rawGlobalCSS) {
      this.rawGlobalCSS.add(css);
    }
    for (const info of contribution.sourceInfo) {
      this.rawGlobalCSSSourceInfo.push(info);
    }
    for (const [name, value] of contribution.variables) {
      this.cssVariables[name] = value;
    }
    for (const hash of contribution.hashes) {
      this.#addedHashes.add(hash);
    }
    this.scopedStyles += contribution.scopedStyles;
    for (const rule of contribution.scopedRules) {
      this.scopedRules.push(rule);
    }
  }

  /**
   * Registers a source stylesheet content for source map generation.
   * @param {string} filePath - Absolute file path of the style source.
   * @param {string} content - CSS content of the source.
   */
  registerSourceFile(filePath, content) {
    this.sourcesCache.set(filePath, content);
  }

  /**
   * Adds a global CSS variable to the processor.
   * @param {string} name - The name of the variable (without the @ prefix).
   * @param {string} value - The value of the variable.
   */
  addVariable(name, value) {
    this.cssVariables[name] = value;
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
    const map = this.getSourceMap(distDir, cssFileName);
    const json = JSON.stringify(map);
    const base64 = Buffer.from(json).toString('base64');
    return `/*# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64} */`;
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
    this.generatedLines.push({
      text,
      sourceFile: sourceFile || null,
      sourceLine: sourceLine !== null ? sourceLine : null,
    });
  }

  /**
   * Generates the Source Map v3 JSON object.
   * @param {string} distDir - The absolute directory path of the output bundle.
   * @param {string} cssFileName - The name of the CSS bundle file (e.g., 'bundle.css').
   * @returns {object} The source map object.
   */
  getSourceMap(distDir, cssFileName = 'bundle.css') {
    const sourcesList = [];
    const sourceToIndex = new Map();

    this.generatedLines.forEach((line) => {
      if (line.sourceFile && !sourceToIndex.has(line.sourceFile)) {
        const relativePath = path.relative(distDir, line.sourceFile).replace(/\\/g, '/');
        sourceToIndex.set(line.sourceFile, sourcesList.length);
        sourcesList.push(relativePath);
      }
    });

    const sourcesContent = sourcesList.map((relPath) => {
      const absPath = Array.from(sourceToIndex.keys()).find(
        (key) => path.relative(distDir, key).replace(/\\/g, '/') === relPath,
      );
      return this.sourcesCache.get(absPath) || '';
    });

    let mappings = '';
    const state = {
      prevGenCol: 0,
      prevSourceIdx: 0,
      prevSourceLine: 0,
      prevSourceCol: 0,
    };

    this.generatedLines.forEach((line, idx) => {
      if (idx > 0) {
        mappings += ';';
      }

      if (line.sourceFile && line.sourceLine !== null) {
        const sourceIdx = sourceToIndex.get(line.sourceFile);
        const sourceLine0 = Math.max(0, line.sourceLine - 1);

        state.prevGenCol = 0;
        mappings += encodeMapping(0, sourceIdx, sourceLine0, 0, state);
      }
    });

    return {
      version: 3,
      file: cssFileName,
      sources: sourcesList,
      sourcesContent: sourcesContent,
      names: [],
      mappings: mappings,
    };
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

    return applyEdits(html, edits);
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
    let content = cssContent;
    const sortedVars = Object.entries(this.cssVariables).sort((a, b) => b[0].length - a[0].length);

    for (const [varName, varValue] of sortedVars) {
      const varRegex = new RegExp(`@${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
      content = content.replace(varRegex, varValue);
    }

    // --- NEW: Check for unresolved @def variables ---
    const remainingAtTokens = content.match(/@[\w-]+/g) || [];
    const knownVarNames = Object.keys(this.cssVariables);

    for (const token of remainingAtTokens) {
      if (STANDARD_AT_RULES.has(token.toLowerCase())) {
        continue;
      }

      const varNameWithoutAt = token.slice(1);
      const closest = getClosestKey(varNameWithoutAt, knownVarNames);
      const suggestion = closest ? ` Did you mean "@${closest}"?` : '';

      reportWarning(
        AvenxErrorCodes.COMPILER_UNRESOLVED_DEF_REFERENCE,
        [token, sourceFile || 'the stylesheet', suggestion],
        this.config,
      );
    }

    return content;
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
    const rules = [];
    rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
    const scopedBodyRules = scopeRulesFn(body, bodyStartLine);
    scopedBodyRules.forEach((r) => {
      rules.push({ cssLine: r.cssLine, sourceLine: r.sourceLine !== null ? r.sourceLine : originalLine });
    });
    rules.push({ cssLine: `}`, sourceLine: originalLine });
    return rules;
  }

  /**
   * Extracts CSS rules from a content string, scopes them using the provided hash,
   * and appends them to the global stylesheet.
   * @param {string} cssContent - The CSS content to extract rules from.
   * @param {string} hash - The hash to use for scoping.
   * @param {string} [sourceFile] - Source file path.
   * @param {number} [startLine] - Start line number in the source file.
   * @private
   */
  extractRules(cssContent, hash, sourceFile = '', startLine = 1) {
    if (this.#addedHashes.has(hash)) return;
    this.#addedHashes.add(hash);

    const cleanCss = scopeCustomProperties(stripCssComments(cssContent), hash);

    const scopeRules = (content, currentBaseLine) => {
      const rules = [];
      let current = '';
      let depth = 0;
      let inString = null;
      let currentLineOffset = 0;
      let ruleStartLineOffset = null;

      const processPart = (part, originalLineOffset) => {
        const rule = part.trim();
        if (!rule) return;

        const lineOffset = originalLineOffset !== null ? originalLineOffset : currentLineOffset;
        const originalLine = currentBaseLine + lineOffset;

        if (rule.includes('{')) {
          // It has a body block (nested rule or at-rule)
          const openBraceIdx = rule.indexOf('{');
          const closeBraceIdx = rule.lastIndexOf('}');
          if (openBraceIdx !== -1 && closeBraceIdx !== -1) {
            let selector = rule.substring(0, openBraceIdx).trim();
            const body = rule.substring(openBraceIdx + 1, closeBraceIdx).trim();

            if (selector.startsWith('@')) {
              // Check if it's a nesting at-rule (like @media, @supports, @container, or @document)
              if (selector.startsWith('@media')) {
                const openBraceIdxInPart = part.indexOf('{');
                const headerLines = part.substring(0, openBraceIdxInPart + 1).split('\n').length - 1;
                const bodyStartLine = originalLine + headerLines;

                const mediaRules = this._processMediaQueries(selector, body, originalLine, bodyStartLine, scopeRules);
                mediaRules.forEach((r) => rules.push(r));
              } else if (
                selector.startsWith('@supports') ||
                selector.startsWith('@document') ||
                selector.startsWith('@container')
              ) {
                const openBraceIdxInPart = part.indexOf('{');
                const headerLines = part.substring(0, openBraceIdxInPart + 1).split('\n').length - 1;
                const bodyStartLine = originalLine + headerLines;

                // Recursively process the rules inside
                const scopedBodyRules = scopeRules(body, bodyStartLine);
                rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
                scopedBodyRules.forEach((r) => {
                  rules.push({ cssLine: r.cssLine, sourceLine: r.sourceLine !== null ? r.sourceLine : originalLine });
                });
                rules.push({ cssLine: `}`, sourceLine: originalLine });
              } else {
                // Non-nesting at-rule (like @keyframes, @font-face) - keep body unchanged
                rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
                body.split('\n').forEach((line, idx) => {
                  rules.push({ cssLine: line, sourceLine: originalLine + idx });
                });
                rules.push({ cssLine: `}`, sourceLine: originalLine });
              }
            } else {
              // Regular selector rule
              selector = scopeSelectorList(selector, hash);
              rules.push({ cssLine: `${selector} { ${body} }`, sourceLine: originalLine });
            }
          }
        } else {
          // It's one or more base properties (e.g. "color: red; margin: 0;")
          const props = rule
            .split(';')
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          if (props.length > 0) {
            rules.push({ cssLine: `.${hash} { ${props.join('; ')}; }`, sourceLine: originalLine });
          }
        }
      };

      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === '\n') {
          currentLineOffset++;
        }
        if (inString) {
          current += char;
          if (char === '\\') {
            if (i + 1 < content.length) {
              current += content[i + 1];
              if (content[i + 1] === '\n') currentLineOffset++;
              i++;
            }
          } else if (char === inString) {
            inString = null;
          }
        } else {
          current += char;
          if (ruleStartLineOffset === null && current.trim().length > 0) {
            ruleStartLineOffset = currentLineOffset;
          }

          if (char === '"' || char === "'") {
            inString = char;
          } else if (char === '{') {
            depth++;
          } else if (char === '}') {
            depth--;
          }

          if (depth === 0 && (char === ';' || char === '}')) {
            processPart(current, ruleStartLineOffset);
            current = '';
            ruleStartLineOffset = null;
          }
        }
      }

      if (current.trim()) {
        processPart(current, ruleStartLineOffset);
      }

      return rules;
    };

    const scoped = scopeRules(cleanCss, startLine);
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
   * Requires a module dynamically.
   * @param {string} name - The module name.
   * @returns {any} The module or null.
   * @private
   */
  #requireModule(name) {
    try {
      return require(name);
    } catch {
      return null;
    }
  }

  /**
   * Preprocesses CSS content using the configured preprocessor.
   * @param {string} cssContent - The raw CSS/SCSS content.
   * @param {string} type - The preprocessor type.
   * @returns {string} The compiled CSS.
   */
  preprocessCss(cssContent, type) {
    if (!type || type === 'none') return cssContent;

    try {
      if (type === 'sass' || type === 'scss') {
        const packageName = 'sass';
        const sass = this.#requireModule(packageName);
        if (!sass) {
          reportWarning(
            AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING,
            new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type, packageName),
            this.config,
          );
          return cssContent;
        }
        const result = sass.compileString(cssContent, {
          syntax: type === 'sass' ? 'indented' : 'scss',
        });
        return result.css;
      }

      if (type === 'postcss') {
        const packageName = 'postcss';
        const postcss = this.#requireModule(packageName);
        if (!postcss) {
          reportWarning(
            AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING,
            new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type, packageName),
            this.config,
          );
          return cssContent;
        }
        const result = postcss([]).process(cssContent);
        return result.css;
      }

      if (type === 'less') {
        const packageName = 'less';
        const less = this.#requireModule(packageName);
        if (!less) {
          reportWarning(
            AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING,
            new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type, packageName),
            this.config,
          );
          return cssContent;
        }
        let output = cssContent;
        less.render(cssContent, { syncImport: true }, (err, result) => {
          if (err) throw err;
          output = result.css;
        });
        return output;
      }
    } catch (err) {
      logger.error(new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_FAILED, type, err.message).message);
      return cssContent;
    }

    return cssContent;
  }

  /**
   * Preprocesses an individual CSS block by wrapping it and compiling.
   * @param {string} rawGlobalCss - The raw global CSS content.
   * @param {string} blockBody - The raw CSS block body.
   * @param {string} preprocessor - The preprocessor type.
   * @returns {string} The preprocessed and filtered CSS block body.
   */
  preprocessBlock(rawGlobalCss, blockBody, preprocessor) {
    const placeholder = '__avenx_temp_class__';
    const input = `${rawGlobalCss}\n\n.${placeholder} {\n${blockBody}\n}`;
    const compiled = this.preprocessCss(input, preprocessor);
    if (compiled === input) {
      return blockBody;
    }
    return this.filterScopedRules(compiled, placeholder);
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

const VLQ_BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes a single integer into Base64 VLQ.
 * @param {number} value
 * @returns {string}
 */
export function encodeVLQ(value) {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += VLQ_BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

/**
 * Encodes a 4-tuple change using previous encoder state.
 * @param {number} genCol
 * @param {number} sourceIdx
 * @param {number} sourceLine
 * @param {number} sourceCol
 * @param {object} state
 * @returns {string}
 */
export function encodeMapping(genCol, sourceIdx, sourceLine, sourceCol, state) {
  const dGenCol = genCol - state.prevGenCol;
  const dSourceIdx = sourceIdx - state.prevSourceIdx;
  const dSourceLine = sourceLine - state.prevSourceLine;
  const dSourceCol = sourceCol - state.prevSourceCol;

  state.prevGenCol = genCol;
  state.prevSourceIdx = sourceIdx;
  state.prevSourceLine = sourceLine;
  state.prevSourceCol = sourceCol;

  return encodeVLQ(dGenCol) + encodeVLQ(dSourceIdx) + encodeVLQ(dSourceLine) + encodeVLQ(dSourceCol);
}

export default StyleProcessor;
