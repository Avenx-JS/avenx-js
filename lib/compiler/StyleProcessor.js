import crypto from 'crypto';
import path from 'path';
import { createRequire } from 'module';
import { logger } from '../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../core/runtime/AvenxError.js';
import { StyleCompilerError } from './errors/index.js';

const require = createRequire(import.meta.url);

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
        // Start of comment
        i += 2;
        while (i < css.length) {
          if (css[i] === '*' && css[i + 1] === '/') {
            i += 2;
            break;
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

  return selectors
    .map((selector) => selector.trim())
    .filter(Boolean)
    .map((selector) => (selector.includes('&') ? selector.replace(/&/g, `.${hash}`) : `.${hash}${selector}`))
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
   */
  constructor(options = {}) {
    this.options = options;
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
   * Retrieves the accumulated global styles.
   * @returns {string} The complete CSS string for the application.
   */
  getGlobalStyles() {
    this.generatedLines = [];

    // Header comment
    this.appendGeneratedLine('/* Generated by Avenx-JS */');

    // 1. Global CSS rules
    for (const css of this.rawGlobalCSS) {
      const info = this.rawGlobalCSSSourceInfo.find((item) => item.css === css);
      const sourceFile = info ? info.sourceFile : '';
      const startLine = info ? info.startLine : 1;

      const appliedCss = this.applyVariables(css);
      const lines = appliedCss.split('\n');
      lines.forEach((line, idx) => {
        this.appendGeneratedLine(line, sourceFile, sourceFile ? startLine + idx : null);
      });
    }

    // Divider comment
    this.appendGeneratedLine('/* Scoped Styles */');

    // 2. Scoped styles
    for (const item of this.scopedRules) {
      this.appendGeneratedLine(item.text, item.sourceFile, item.sourceLine);
    }

    return this.generatedLines.map((l) => l.text).join('\n');
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
   * Processes the CSS within an HTML template. It identifies @css attributes,
   * scopes the rules with a unique hash, replaces variables, and updates the HTML.
   * @param {string} html - The HTML template.
   * @param {object} [desBlocks] - Pre-defined style blocks from a .component.css file.
   * @param {string} [componentName] - The name of the component for hash generation.
   * @param {string} [desPath] - The original CSS file path.
   * @returns {string} The modified HTML.
   */
  process(html, desBlocks = {}, componentName = '', desPath = '') {
    let modifiedHtml = html;

    // 1. First, handle all @css attributes (new syntax)
    // This replaces '@css name' with 'class="hash"' or merges with existing classes
    modifiedHtml = modifiedHtml.replace(
      /<([^>]+)\s+@css\s+([\w-]+)([^>]*)>/g,
      (fullMatch, before, blockName, after) => {
        const cssContent = desBlocks[blockName];
        if (!cssContent) return `<${before}${after}>`;

        const metadata = desBlocks._sourceMapInfo && desBlocks._sourceMapInfo[blockName];
        const sourceFile = metadata ? metadata.sourceFile : desPath;
        const startLine = metadata ? metadata.startLine : 1;

        const hash = this.getHash(cssContent, componentName);
        this.extractRules(this.applyVariables(cssContent), hash, sourceFile, startLine);

        const tagWithClass = this.mergeClassIntoTag(before + after, hash);
        return `<${tagWithClass}>`;
      },
    );

    // 2. Then, handle all <@css /> tags (old/anonymous syntax)
    const tagRegex = /<@css\s+([\w-]+)?\s*\/?>/g;
    let match;

    while ((match = tagRegex.exec(modifiedHtml)) !== null) {
      const fullMatch = match[0];
      const blockName = match[1];
      const cssContent = blockName ? desBlocks[blockName] : null;

      if (!cssContent) {
        modifiedHtml = modifiedHtml.replace(fullMatch, '');
        tagRegex.lastIndex = 0; // Restart because string changed
        continue;
      }

      const metadata = desBlocks._sourceMapInfo && desBlocks._sourceMapInfo[blockName];
      const sourceFile = metadata ? metadata.sourceFile : desPath;
      const startLine = metadata ? metadata.startLine : 1;

      const hash = this.getHash(cssContent, componentName);
      this.extractRules(this.applyVariables(cssContent), hash, sourceFile, startLine);

      const matchIndex = match.index;
      const beforeMatch = modifiedHtml.substring(0, matchIndex);
      const lastTagStart = beforeMatch.lastIndexOf('<');
      const lastTagEnd = beforeMatch.lastIndexOf('>');

      if (lastTagStart !== -1 && lastTagStart > lastTagEnd) {
        // Inside a tag: <div <@css ... /> >
        const tagContent = modifiedHtml.substring(lastTagStart + 1, matchIndex);
        const updatedTag = this.mergeClassIntoTag(tagContent, hash);
        modifiedHtml =
          modifiedHtml.substring(0, lastTagStart + 1) +
          updatedTag +
          modifiedHtml.substring(matchIndex + fullMatch.length);
      } else {
        // Outside a tag: <div> <@css ... /> </div>
        // Search for the previous tag to apply the class to
        const prevTagRegex = /<([a-zA-Z0-9-]+)([^>]*)>$/;
        const prevTagMatch = beforeMatch.trimEnd().match(prevTagRegex);

        if (prevTagMatch) {
          const tagStart = beforeMatch.lastIndexOf(prevTagMatch[0]);
          const tagContent = prevTagMatch[1] + prevTagMatch[2];
          const updatedTag = this.mergeClassIntoTag(tagContent, hash);

          modifiedHtml =
            modifiedHtml.substring(0, tagStart + 1) +
            updatedTag +
            '>' +
            modifiedHtml.substring(tagStart + prevTagMatch[0].length, matchIndex) +
            modifiedHtml.substring(matchIndex + fullMatch.length);
        } else {
          modifiedHtml = modifiedHtml.replace(fullMatch, '');
        }
      }
      tagRegex.lastIndex = 0; // Restart because string changed
    }

    return modifiedHtml;
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
   * @returns {string} The CSS content with variables replaced.
   */
  applyVariables(cssContent) {
    let content = cssContent;
    // Sort variables by length descending to prevent partial replacement (e.g., @primary vs @primary-hover)
    const sortedVars = Object.entries(this.cssVariables).sort((a, b) => b[0].length - a[0].length);

    for (const [varName, varValue] of sortedVars) {
      // Use a negative lookahead to ensure we don't match a partial variable name
      // that is actually followed by a hyphen or word characters.
      const varRegex = new RegExp(`@${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
      content = content.replace(varRegex, varValue);
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

    const cleanCss = stripCssComments(cssContent);

    const scopeRules = (content, currentBaseLine) => {
      const rules = [];
      let current = '';
      let depth = 0;
      let inString = null;
      let currentLineOffset = 0;
      let ruleStartLineOffset = 0;

      const processPart = (part, originalLineOffset) => {
        const rule = part.trim();
        if (!rule) return;

        const originalLine = currentBaseLine + originalLineOffset;

        if (rule.includes('{')) {
          // It has a body block (nested rule or at-rule)
          const openBraceIdx = rule.indexOf('{');
          const closeBraceIdx = rule.lastIndexOf('}');
          if (openBraceIdx !== -1 && closeBraceIdx !== -1) {
            let selector = rule.substring(0, openBraceIdx).trim();
            const body = rule.substring(openBraceIdx + 1, closeBraceIdx).trim();

            if (selector.startsWith('@')) {
              // Check if it's a nesting at-rule (like @media, @supports, @container, or @document)
              if (
                selector.startsWith('@media') ||
                selector.startsWith('@supports') ||
                selector.startsWith('@document') ||
                selector.startsWith('@container')
              ) {
                // Recursively process the rules inside
                const scopedBodyRules = scopeRules(body, originalLine);
                rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
                scopedBodyRules.forEach((r) => {
                  rules.push({ cssLine: r.cssLine, sourceLine: r.sourceLine || originalLine });
                });
                rules.push({ cssLine: `}`, sourceLine: originalLine });
              } else {
                // Non-nesting at-rule (like @keyframes, @font-face) - keep body unchanged
                rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
                body.split('\n').forEach((line) => {
                  rules.push({ cssLine: line, sourceLine: originalLine });
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
          if (char === '"' || char === "'") {
            inString = char;
          } else if (char === '{') {
            if (depth === 0) {
              ruleStartLineOffset = currentLineOffset;
            }
            depth++;
          } else if (char === '}') {
            depth--;
          }

          if (depth === 0 && (char === ';' || char === '}')) {
            processPart(current, ruleStartLineOffset);
            current = '';
            ruleStartLineOffset = currentLineOffset;
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
        const sass = this.#requireModule('sass');
        if (!sass) {
          logger.warn(new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type).message);
          return cssContent;
        }
        const result = sass.compileString(cssContent, {
          syntax: type === 'sass' ? 'indented' : 'scss',
        });
        return result.css;
      }

      if (type === 'postcss') {
        const postcss = this.#requireModule('postcss');
        if (!postcss) {
          logger.warn(new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type).message);
          return cssContent;
        }
        const result = postcss([]).process(cssContent);
        return result.css;
      }

      if (type === 'less') {
        const less = this.#requireModule('less');
        if (!less) {
          logger.warn(new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type).message);
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
      logger.error(`Error compiling ${type}: ${err.message}`);
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
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
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
