import fs from 'fs';
import path from 'path';
import ExpressionParser from './expressionParser.js';
import { logger } from '../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../core/runtime/AvenxError.js';
import { processBindDirectives } from '../core/utils/templateUtils.js';

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
 * ComponentParser handles the parsing of Avenx component files (.js and .css).
 * It extracts component state, computed properties, methods, and templates,
 * and coordinates with the StyleProcessor to handle styles.
 */
class ComponentParser {
  /**
   * @param {StyleProcessor} styleProcessor - An instance of StyleProcessor to handle styles.
   */
  constructor(styleProcessor) {
    /** @type {StyleProcessor} */
    this.styleProcessor = styleProcessor;
    /** @type {ExpressionParser} */
    this.expressionParser = new ExpressionParser();
  }

  /**
   * Parses a .component.js or .page.js file and its corresponding CSS file.
   * @param {string} filePath - The absolute path to the file.
   * @param {'component'|'page'} [type] - The type of file being parsed.
   * @returns {string} The generated JavaScript class.
   */
  parse(filePath, type = 'component') {
    const isPage = type === 'page';
    const suffix = isPage ? '.page.js' : '.component.js';
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, suffix);

    // Convert user-profile or user_profile to UserProfile
    const name = fileName
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    const desPath = filePath.replace(suffix, isPage ? '.page.css' : '.component.css');
    const desBlocks = {};
    const styles = {};

    if (fs.existsSync(desPath)) {
      const desContent = fs.readFileSync(desPath, 'utf-8');
      const globalMatch = desContent.match(/<@global>([\s\S]*?)<\/ ?@global>/i);
      if (globalMatch) {
        const inner = globalMatch[1];
        const defRegex = /@def\s+([\w-]+)\s+([^;]+);/g;
        let defMatch;
        while ((defMatch = defRegex.exec(inner)) !== null) {
          styles[defMatch[1]] = defMatch[2].trim();
        }
      }
      this.extractStylesAndVars(desContent, desBlocks);
    }

    const state = this.extractState(content);
    const computed = this.extractComputed(content);
    const methods = this.extractMethods(content);
    let template = this.extractTemplate(content, desBlocks, name, filePath, state, computed, methods);

    // Handle declarative tags: <MyComponent /> or <MyComponent>...</MyComponent> -> <div data-avenx-comp="MyComponent">...</div>
    // Only if it looks like a component (starts with uppercase)
    template = this.processComponentTags(template);

    // Identify and mark static subtrees for patcher performance optimization
    template = this.optimizeStaticSubtrees(template);

    const methodStrings = Object.entries(methods)
      .map(([k, v]) => `${k}: \`${v}\``)
      .join(',\n        ');

    if (isPage) {
      return `
/**
 * Page component representing ${name}.
 */
class ${name} extends AvenxPage {
    /**
     * @param {Object} bridges - Mapped bridges.
     * @param {Object} componentRegistry - Registry of components.
     * @param {Object} props - Page properties.
     */
    constructor(bridges, componentRegistry, props) {
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, bridges, \`${template}\`, { ${methodStrings} }, componentRegistry, props, ${JSON.stringify(styles)});
    }
}`;
    }

    return `
/**
 * Component representing ${name}.
 */
class ${name} extends AvenxComponent {
    /**
     * @param {Object} bridges - Mapped bridges.
     * @param {Object} props - Component properties.
     */
    constructor(bridges, props) {
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, bridges, \`${template}\`, { ${methodStrings} }, props, ${JSON.stringify(styles)});
    }
}`;
  }

  /**
   * Extracts global CSS variables and component-specific style blocks from CSS content.
   * @param {string} desContent - The content of the .component.css file.
   * @param {object} desBlocks - An object to store the extracted style blocks.
   * @private
   */
  extractStylesAndVars(desContent, desBlocks) {
    const globalMatch = desContent.match(/<@global>([\s\S]*?)<\/ ?@global>/i);
    let rawGlobalCss = '';
    if (globalMatch) {
      const inner = globalMatch[1];
      const defRegex = /@def\s+([\w-]+)\s+([^;]+);/g;
      let defMatch;
      while ((defMatch = defRegex.exec(inner)) !== null) {
        this.styleProcessor.addVariable(defMatch[1], defMatch[2].trim());
      }

      // Remove @def lines and add the rest as global CSS
      rawGlobalCss = inner.replace(/@def\s+[\w-]+\s+[^;]+;/g, '').trim();
      let compiledGlobalCss = rawGlobalCss;
      if (this.styleProcessor.options && this.styleProcessor.options.preprocessor) {
        compiledGlobalCss = this.styleProcessor.preprocessCss(rawGlobalCss, this.styleProcessor.options.preprocessor);
      }
      if (compiledGlobalCss) {
        this.styleProcessor.addGlobalCSS(compiledGlobalCss);
      }
    }

    const cssBlockMatch = desContent.match(/<@css>([\s\S]*?)<\/ ?@css>/i);
    if (cssBlockMatch) {
      const inner = stripCssComments(cssBlockMatch[1]);
      let depth = 0,
        currentName = '',
        currentBody = '',
        inBlock = false;
      let inString = null;
      for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (inString) {
          const toAppend = char;
          let nextToAppend = '';
          if (char === '\\') {
            if (i + 1 < inner.length) {
              nextToAppend = inner[i + 1];
              i++;
            }
          } else if (char === inString) {
            inString = null;
          }
          if (inBlock) {
            currentBody += toAppend + nextToAppend;
          }
        } else {
          if (char === '"' || char === "'") {
            inString = char;
            if (inBlock) {
              currentBody += char;
            }
          } else if (char === '{' && depth === 0) {
            currentName = inner.substring(0, i).trim().split('}').pop().trim();
            inBlock = true;
            depth++;
          } else if (char === '{') {
            depth++;
            currentBody += char;
          } else if (char === '}') {
            depth--;
            if (depth === 0) {
              if (currentName) {
                let finalBody = currentBody.trim();
                if (this.styleProcessor.options && this.styleProcessor.options.preprocessor) {
                  finalBody = this.styleProcessor.preprocessBlock(rawGlobalCss, finalBody, this.styleProcessor.options.preprocessor);
                }
                desBlocks[currentName] = finalBody;
              }
              currentBody = '';
              currentName = '';
              inBlock = false;
            } else {
              currentBody += char;
            }
          } else if (inBlock) {
            currentBody += char;
          }
        }
      }
    }
  }

  /**
   * Extracts the initial state from the component's <state /> tags.
   * @param {string} content - The content of the .component.js file.
   * @returns {object} The extracted state object.
   * @private
   */
  extractState(content) {
    return this.expressionParser.parseState(content);
  }

  /**
   * Extracts computed properties from the component's <computed /> tags.
   * @param {string} content - The content of the .component.js file.
   * @returns {object} A map of property names to their expression strings.
   * @private
   */
  extractComputed(content) {
    return this.expressionParser.parseComputed(content);
  }

  /**
   * Extracts actions (methods) from the component's <action /> tags.
   * @param {string} content - The content of the .component.js file.
   * @returns {Object<string, string>} A map of method names to their stringified bodies.
   * @private
   */
  extractMethods(content) {
    return this.expressionParser.parseMethods(content);
  }

  /**
   * Extracts the HTML template and processes internal styles.
   * @param {string} content - The content of the .component.js file.
   * @param {object} desBlocks - The previously extracted design blocks.
   * @param {string} name - The name of the component for style hashing.
   * @param {string} [filePath] - The component file path.
   * @param {object} [state] - The extracted state keys.
   * @param {object} [computed] - The extracted computed keys.
   * @param {object} [methods] - The extracted method keys.
   * @returns {string} The cleaned and processed HTML template.
   * @private
   */
  extractTemplate(content, desBlocks, name, filePath, state, computed, methods) {
    let template = content
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<state.*? \/>/g, '')
      .replace(/<computed.*? \/>/g, '')
      .replace(/<action.*?>[\s\S]*?<\/action>/g, '')
      .trim();
    template = this.styleProcessor.process(template, desBlocks, name);
    template = this.processBindDirectives(template);
    if (filePath && state && computed && methods) {
      this.validateTemplate(template, state, computed, methods, filePath, name);
    }
    template = this.processForLoops(template);
    template = this.processTransitionTags(template);
    return template
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');
  }

  /**
   * Performs compile-time validation on template expressions to ensure
   * all referenced variables and methods are declared.
   * @param {string} template - The template string (after data-ax-bind translation).
   * @param {object} state - The extracted state keys.
   * @param {object} computed - The extracted computed keys.
   * @param {object} methods - The extracted method keys.
   * @param {string} filePath - The component file path.
   * @param {string} [name] - The component name, used for warning messages.
   * @private
   */
  validateTemplate(template, state, computed, methods, filePath, name) {
    if (!template || template.trim() === '') {
      logger.warn(formatMessage(AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE, name));
    }

    const declared = new Set([...Object.keys(state), ...Object.keys(computed), ...Object.keys(methods)]);

    const bridges = this.findBridgeNames(filePath);
    bridges.forEach((b) => declared.add(b));

    const EXCLUDED_IDENTIFIERS = new Set([
      'true',
      'false',
      'null',
      'undefined',
      'NaN',
      'Infinity',
      'this',
      'let',
      'const',
      'var',
      'function',
      'return',
      'if',
      'else',
      'for',
      'in',
      'of',
      'new',
      'typeof',
      'instanceof',
      'class',
      'extends',
      'try',
      'catch',
      'finally',
      'throw',
      'await',
      'async',
      'import',
      'export',
      'default',
      'delete',
      'void',
      'do',
      'while',
      'switch',
      'case',
      'break',
      'continue',
      'debugger',
      'yield',
      'with',
      'arguments',
      'console',
      'Math',
      'JSON',
      'window',
      'document',
      'Array',
      'Object',
      'String',
      'Number',
      'Boolean',
      'Date',
      'Error',
      'Map',
      'Set',
      'Promise',
      'props',
      'styles',
      'event',
      'args',
    ]);

    const events = [];

    // 1. Find loop starts and ends
    const forStartRegex = /<@for\s+(\w+)\s+in\s+([^>]+?)(?:\s+key="([^"]*)")?>/gi;
    let match;
    while ((match = forStartRegex.exec(template)) !== null) {
      events.push({
        type: 'loop_start',
        index: match.index,
        length: match[0].length,
        item: match[1],
        list: match[2],
      });
    }

    const forEndRegex = /<\/ ?@for>/gi;
    while ((match = forEndRegex.exec(template)) !== null) {
      events.push({
        type: 'loop_end',
        index: match.index,
        length: match[0].length,
      });
    }

    // 2. Find interpolations
    const interpRegex = /\{\{([\s\S]*?)\}\}/g;
    while ((match = interpRegex.exec(template)) !== null) {
      events.push({
        type: 'interpolation',
        index: match.index,
        length: match[0].length,
        expr: match[1],
      });
    }

    // 3. Find event attributes in any tag
    const tagRegex = /<([a-zA-Z0-9@/!-][^>]*?)>/g;
    while ((match = tagRegex.exec(template)) !== null) {
      const tagIndex = match.index;
      const attrRegex = /@([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(match[0])) !== null) {
        events.push({
          type: 'event',
          index: tagIndex + attrMatch.index,
          length: attrMatch[0].length,
          expr: attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3],
        });
      }

      const dirRegex = /\b(data-ax-show|data-ax-class|data-ax-html)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let dirMatch;
      while ((dirMatch = dirRegex.exec(match[0])) !== null) {
        events.push({
          type: 'directive',
          index: tagIndex + dirMatch.index,
          length: dirMatch[0].length,
          expr: dirMatch[2] !== undefined ? dirMatch[2] : dirMatch[3],
        });
      }
    }

    events.sort((a, b) => a.index - b.index);

    const currentLoopVars = [];
    const filename = path.basename(filePath);

    const checkIdentifiers = (expr) => {
      const ids = this.extractRootIdentifiers(expr);
      for (const id of ids) {
        if (EXCLUDED_IDENTIFIERS.has(id)) {
          continue;
        }
        if (currentLoopVars.includes(id)) {
          continue;
        }
        if (!declared.has(id)) {
          logger.warn(
            formatMessage(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, id, filename)
          );
        }
      }
    };

    for (const ev of events) {
      if (ev.type === 'loop_start') {
        checkIdentifiers(ev.list);
        currentLoopVars.push(ev.item);
      } else if (ev.type === 'loop_end') {
        currentLoopVars.pop();
      } else if (ev.type === 'interpolation' || ev.type === 'event' || ev.type === 'directive') {
        checkIdentifiers(ev.expr);
      }
    }
  }

  /**
   * Extracts root variable and method identifiers from a JS expression string.
   * @param {string} code - The Javascript expression/statement.
   * @returns {string[]} The list of root identifiers.
   * @private
   */
  extractRootIdentifiers(code) {
    const identifiers = new Set();
    let i = 0;
    let hasQuestionMark = false;

    while (i < code.length) {
      const char = code[i];

      if (char === '/' && code[i + 1] === '/') {
        i += 2;
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }

      if (char === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
        continue;
      }

      if (char === "'") {
        i++;
        while (i < code.length && code[i] !== "'") {
          if (code[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }

      if (char === '"') {
        i++;
        while (i < code.length && code[i] !== '"') {
          if (code[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }

      if (char === '`') {
        i++;
        while (i < code.length && code[i] !== '`') {
          if (code[i] === '\\') i++;
          if (code[i] === '$' && code[i + 1] === '{') {
            let depth = 1;
            let j = i + 2;
            while (j < code.length && depth > 0) {
              if (code[j] === '{') depth++;
              else if (code[j] === '}') depth--;
              j++;
            }
            const subExpr = code.substring(i + 2, j - 1);
            this.extractRootIdentifiers(subExpr).forEach((id) => identifiers.add(id));
            i = j - 1;
          }
          i++;
        }
        i++;
        continue;
      }

      const idRegex = /^[A-Za-z_$][\w$]*/;
      const sub = code.substring(i);
      const match = sub.match(idRegex);
      if (match) {
        const name = match[0];

        let isProperty = false;
        let checkIdx = i - 1;
        while (checkIdx >= 0 && /\s/.test(code[checkIdx])) {
          checkIdx--;
        }
        if (checkIdx >= 0 && code[checkIdx] === '.') {
          isProperty = true;
        } else if (checkIdx >= 1 && code[checkIdx] === '.' && code[checkIdx - 1] === '?') {
          isProperty = true;
        }

        let nextIdx = i + name.length;
        while (nextIdx < code.length && /\s/.test(code[nextIdx])) {
          nextIdx++;
        }
        let isObjectKey = false;
        if (nextIdx < code.length && code[nextIdx] === ':') {
          if (!hasQuestionMark) {
            isObjectKey = true;
          } else {
            hasQuestionMark = false;
          }
        }

        if (!isProperty && !isObjectKey) {
          identifiers.add(name);
        }

        i += name.length;
        continue;
      }

      if (char === '?') {
        if (code[i + 1] === '.') {
          i += 2;
          continue;
        }
        hasQuestionMark = true;
      }

      if (char === ';' || char === ',' || char === '{' || char === '(' || char === '[') {
        hasQuestionMark = false;
      }

      i++;
    }

    return Array.from(identifiers);
  }

  /**
   * Resolves all bridge names in the src/global folder relative to a file.
   * @param {string} filePath - The absolute file path of the component.
   * @returns {Set<string>} The set of bridge names.
   * @private
   */
  findBridgeNames(filePath) {
    const bridgeNames = new Set();
    if (!filePath) return bridgeNames;
    try {
      let currentDir = path.resolve(path.dirname(filePath));
      while (currentDir) {
        const globalDir = path.join(currentDir, 'global');
        if (fs.existsSync(globalDir) && fs.statSync(globalDir).isDirectory()) {
          fs.readdirSync(globalDir).forEach((file) => {
            if (file.endsWith('.bridge.js')) {
              const name = path.basename(file, '.bridge.js');
              const capitalizedName =
                name
                  .split(/[-_]/)
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join('') + 'Bridge';
              bridgeNames.add(capitalizedName);
            }
          });
          break;
        }
        const srcGlobalDir = path.join(currentDir, 'src', 'global');
        if (fs.existsSync(srcGlobalDir) && fs.statSync(srcGlobalDir).isDirectory()) {
          fs.readdirSync(srcGlobalDir).forEach((file) => {
            if (file.endsWith('.bridge.js')) {
              const name = path.basename(file, '.bridge.js');
              const capitalizedName =
                name
                  .split(/[-_]/)
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join('') + 'Bridge';
              bridgeNames.add(capitalizedName);
            }
          });
          break;
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) {
          break;
        }
        currentDir = parent;
      }
    } catch {
      // Ignore directory scanning errors
    }
    return bridgeNames;
  }

  /**
   * Processes data-ax-bind attributes on input, textarea, and select elements.
   * Converts data-ax-bind="expr" to value="{{ expr }}" and event listener.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  processBindDirectives(template) {
    return processBindDirectives(template);
  }

  /**
   * Processes <@for> loops in the template, converting them to <template> tags
   * that can be handled by the runtime for efficient list rendering.
   * @param {string} template - The HTML template string.
   * @returns {string} The processed template.
   * @private
   */
  processForLoops(template) {
    let currentTemplate = template;

    while (true) {
      // Matches <@for item in list> or <@for item in list key="item.id">, or closing tag </@for> / </ @for>
      const tagRegex = /(<@for\s+(\w+)\s+in\s+([^>]+?)(?:\s+key="([^"]*)")?>)|(<\/ ?@for>)/gi;
      let match;
      const tags = [];
      while ((match = tagRegex.exec(currentTemplate)) !== null) {
        if (match[1]) {
          tags.push({
            type: 'start',
            index: match.index,
            length: match[0].length,
            item: match[2],
            list: match[3],
            key: match[4],
          });
        } else {
          tags.push({
            type: 'end',
            index: match.index,
            length: match[0].length,
          });
        }
      }

      if (tags.length === 0) {
        break;
      }

      let innerPair = null;
      const stack = [];
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        if (tag.type === 'start') {
          stack.push(tag);
        } else {
          const startTag = stack.pop();
          if (startTag) {
            innerPair = { start: startTag, end: tag };
            break; // Found innermost loop!
          }
        }
      }

      if (!innerPair) {
        logger.warn(formatMessage(AvenxErrorCodes.COMPILER_UNMATCHED_FOR_TAG));
        break;
      }

      const startIdx = innerPair.start.index;
      const endIdx = innerPair.end.index + innerPair.end.length;

      const bodyStart = startIdx + innerPair.start.length;
      const bodyEnd = innerPair.end.index;
      const body = currentTemplate.substring(bodyStart, bodyEnd);

      // Escape inner interpolation tags to prevent them from being processed
      // by the initial template render. They will be processed per-item at runtime.
      const escapedBody = body.replace(/\{\{/g, '{%').replace(/\}\}/g, '%}');
      let attrs = `data-ax-for="${innerPair.start.list.trim()}" data-ax-as="${innerPair.start.item.trim()}"`;
      if (innerPair.start.key) {
        attrs += ` data-ax-key="${innerPair.start.key.trim()}"`;
      }

      const replacement = `<template ${attrs}>${escapedBody}</template>`;
      currentTemplate = currentTemplate.substring(0, startIdx) + replacement + currentTemplate.substring(endIdx);
    }

    return currentTemplate;
  }

  /**
   * Processes component tags recursively to handle transclusion slots.
   * Maps `<CompName ...>...</CompName>` to `<div data-avenx-comp="CompName">...</div>`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  processComponentTags(template) {
    let currentTemplate = template;

    while (true) {
      // Find the first occurrence of < followed by an uppercase letter
      const match = currentTemplate.match(/<([A-Z][a-zA-Z0-9]*)\b/);
      if (!match) {
        break;
      }

      const compName = match[1];
      const startIndex = match.index;

      // Find the end of this opening/self-closing tag
      let i = startIndex + 1 + compName.length;
      let inQuote = null;
      let isSelfClosing = false;
      let tagEndIndex = -1;

      while (i < currentTemplate.length) {
        const char = currentTemplate[i];
        if (inQuote) {
          if (char === inQuote) {
            inQuote = null;
          }
        } else if (char === '"' || char === "'") {
          inQuote = char;
        } else if (char === '>') {
          const trimmedBefore = currentTemplate.substring(startIndex + 1 + compName.length, i).trim();
          if (trimmedBefore.endsWith('/')) {
            isSelfClosing = true;
          }
          tagEndIndex = i + 1;
          break;
        }
        i++;
      }

      if (tagEndIndex === -1) {
        break; // Malformed tag, stop parsing to prevent infinite loops
      }

      // Extract the attributes string
      let attrsStr = currentTemplate.substring(startIndex + 1 + compName.length, tagEndIndex - 1).trim();
      if (isSelfClosing && attrsStr.endsWith('/')) {
        attrsStr = attrsStr.slice(0, -1).trim();
      }

      let isExpr = '';
      const isDynamic = compName === 'Component';

      // Parse attributes
      const props = [];
      const others = [];
      const attrs = parseAttributes(attrsStr);
      for (const [attrName, attrVal] of Object.entries(attrs)) {
        if (isDynamic && (attrName === 'is' || attrName === ':is')) {
          if (attrVal.startsWith('{{') && attrVal.endsWith('}}')) {
            isExpr = attrVal.slice(2, -2).trim();
          } else {
            isExpr = attrVal.trim();
          }
        } else if (attrName.startsWith('@')) {
          others.push(`${attrName}="${attrVal.replace(/"/g, '&quot;')}"`);
        } else {
          let propExpr;
          if (attrVal.startsWith('{{') && attrVal.endsWith('}}')) {
            propExpr = attrVal.slice(2, -2).trim();
          } else {
            const trimmed = attrVal.trim();
            if (
              trimmed === 'true' ||
              trimmed === 'false' ||
              trimmed === 'null' ||
              (trimmed !== '' && !isNaN(trimmed))
            ) {
              propExpr = trimmed;
            } else {
              propExpr = `'${trimmed.replace(/'/g, "\\'")}'`;
            }
          }
          props.push(`data-props-${attrName}="${propExpr}"`);
        }
      }
      const propsAttr = props.length > 0 ? ` ${props.join(' ')}` : '';
      const othersAttr = others.length > 0 ? ` ${others.join(' ')}` : '';

      const replacementTag = isDynamic
        ? `data-avenx-comp-dynamic="${isExpr}"`
        : `data-avenx-comp="${compName}"`;

      if (isSelfClosing) {
        const replacement = `<div ${replacementTag}${propsAttr}${othersAttr}></div>`;
        currentTemplate =
          currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(tagEndIndex);
      } else {
        // Find matching closing tag </CompName>
        let searchIndex = tagEndIndex;
        let depth = 1;
        let closingTagIndex = -1;
        let closingTagLength = 0;

        while (searchIndex < currentTemplate.length) {
          const nextOpen = currentTemplate.substring(searchIndex).match(new RegExp(`^<${compName}\\b`));
          const nextClose = currentTemplate.substring(searchIndex).match(new RegExp(`^</\\s*${compName}\\s*>`));

          if (nextClose) {
            depth--;
            if (depth === 0) {
              closingTagIndex = searchIndex;
              closingTagLength = nextClose[0].length;
              break;
            }
            searchIndex += nextClose[0].length;
          } else if (nextOpen) {
            // Scan to end of this open tag to see if it is self-closing
            let tempIdx = searchIndex + nextOpen[0].length;
            let tempInQuote = null;
            let tempIsSelfClosing = false;
            while (tempIdx < currentTemplate.length) {
              const tc = currentTemplate[tempIdx];
              if (tempInQuote) {
                if (tc === tempInQuote) tempInQuote = null;
              } else if (tc === '"' || tc === "'") {
                tempInQuote = tc;
              } else if (tc === '>') {
                const trimmedBefore = currentTemplate.substring(searchIndex + nextOpen[0].length, tempIdx).trim();
                if (trimmedBefore.endsWith('/')) {
                  tempIsSelfClosing = true;
                }
                tempIdx++;
                break;
              }
              tempIdx++;
            }
            if (!tempIsSelfClosing) {
              depth++;
            }
            searchIndex = tempIdx;
          } else {
            searchIndex++;
          }
        }

        if (closingTagIndex === -1) {
          // No matching closing tag, treat as self-closing
          const replacement = `<div ${replacementTag}${propsAttr}${othersAttr}></div>`;
          currentTemplate =
            currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(tagEndIndex);
        } else {
          const innerContent = currentTemplate.substring(tagEndIndex, closingTagIndex);
          // Recursively process tags inside innerContent
          const processedInner = this.processComponentTags(innerContent);
          const replacement = `<div ${replacementTag}${propsAttr}${othersAttr}>${processedInner}</div>`;
          currentTemplate =
            currentTemplate.substring(0, startIndex) +
            replacement +
            currentTemplate.substring(closingTagIndex + closingTagLength);
        }
      }
    }
    return currentTemplate;
  }

  /**
   * Processes transition tags in the template, converting them to data-ax-transition attributes.
   * @param {string} template - The HTML template string.
   * @returns {string} The processed template.
   */
  processTransitionTags(template) {
    try {
      const nodes = parseHTML(template);
      const processed = this.processTransitionTagsInTree(nodes);
      return serializeHTML(processed);
    } catch (err) {
      logger.warn(formatMessage(AvenxErrorCodes.COMPILER_TRANSITION_PARSE_FAILED, err));
      return template;
    }
  }

  /**
   * Recursively processes transition tags in the node tree.
   * @param {HTMLNode[]} nodes
   * @returns {HTMLNode[]}
   */
  processTransitionTagsInTree(nodes) {
    const result = [];
    for (const node of nodes) {
      if (node.type === 'element') {
        if (node.tagName.toLowerCase() === 'transition') {
          const nameAttr = node.attrs['name'];
          let transitionValue = "'ax'";
          if (nameAttr) {
            if (nameAttr.startsWith('{{') && nameAttr.endsWith('}}')) {
              transitionValue = nameAttr.slice(2, -2).trim();
            } else {
              transitionValue = `'${nameAttr.replace(/'/g, "\\'")}'`;
            }
          }
          const processedChildren = this.processTransitionTagsInTree(node.children);
          for (const child of processedChildren) {
            if (child.type === 'element') {
              child.attrs['data-ax-transition'] = transitionValue;
            }
            result.push(child);
          }
        } else {
          node.children = this.processTransitionTagsInTree(node.children);
          result.push(node);
        }
      } else {
        result.push(node);
      }
    }
    return result;
  }

  /**
   * Identifies static elements/subtrees and marks them with data-ax-static="true".
   * @param {string} template - The compiled HTML template.
   * @returns {string} The optimized template.
   */
  optimizeStaticSubtrees(template) {
    try {
      const nodes = parseHTML(template);
      this.markStaticNodes(nodes, false);
      return serializeHTML(nodes);
    } catch (err) {
      logger.warn(formatMessage(AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED, err));
      return template;
    }
  }

  /**
   * Recursively traverses nodes to find and mark the root of static subtrees.
   * @param {HTMLNode[]} nodes
   * @param {boolean} [parentIsStatic]
   */
  markStaticNodes(nodes, parentIsStatic = false) {
    for (const node of nodes) {
      if (node.type === 'element') {
        const nodeStatic = isStaticNode(node);
        if (nodeStatic && !parentIsStatic) {
          node.attrs['data-ax-static'] = 'true';
        }
        this.markStaticNodes(node.children, nodeStatic);
      }
    }
  }
}

/**
 * A lightweight node representation for parsing HTML templates.
 */
class HTMLNode {
  /**
   * @param {'element'|'text'|'comment'} type
   * @param {string} [tagName]
   * @param {Object<string, string|null>} [attrs]
   * @param {boolean} [isSelfClosing]
   */
  constructor(type, tagName = '', attrs = {}, isSelfClosing = false) {
    this.type = type;
    this.tagName = tagName;
    this.attrs = attrs;
    this.isSelfClosing = isSelfClosing;
    /** @type {HTMLNode[]} */
    this.children = [];
    this.content = '';
  }
}

/**
 * Parses an attribute string into a key-value object.
 *
 * Handles three attribute forms:
 *  - Quoted values: `name="value"` or `name='value'`. A backslash-escaped
 *    quote (`\"` or `\'`) inside the value is preserved verbatim rather than
 *    ending the value early, so expressions containing an apostrophe or a
 *    quote character (e.g. `@click='say(\'hi\')'`) parse correctly instead
 *    of being split into several bogus attributes.
 *  - Unquoted values: `name=value`, read up to the next whitespace or `>`.
 *  - Valueless boolean attributes: `disabled`, mapped to the string `'true'`
 *    (matching the `attr="true"` / `attr="false"` convention the runtime's
 *    boolean-attribute handling already expects, rather than `null`).
 * @param {string} attrStr
 * @returns {Object<string, string>}
 */
function parseAttributes(attrStr) {
  const attrs = {};
  if (!attrStr) return attrs;

  const len = attrStr.length;
  const isWhitespace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  const isNameChar = (ch) => /[@\w:.-]/.test(ch);

  let i = 0;
  while (i < len) {
    // Skip whitespace between attributes.
    while (i < len && isWhitespace(attrStr[i])) i++;
    if (i >= len) break;

    // Read the attribute name.
    const nameStart = i;
    while (i < len && isNameChar(attrStr[i])) i++;
    if (i === nameStart) {
      // Stray character that isn't part of a valid attribute name; skip it
      // so a malformed fragment can't stall the scan in an infinite loop.
      i++;
      continue;
    }
    const name = attrStr.slice(nameStart, i);

    // Look ahead (past whitespace) for an '=' sign.
    let lookahead = i;
    while (lookahead < len && isWhitespace(attrStr[lookahead])) lookahead++;

    if (attrStr[lookahead] === '=') {
      i = lookahead + 1;
      while (i < len && isWhitespace(attrStr[i])) i++;

      const quote = attrStr[i];
      if (quote === '"' || quote === "'") {
        i++;
        let value = '';
        while (i < len) {
          const ch = attrStr[i];
          if (ch === '\\' && i + 1 < len) {
            value += ch + attrStr[i + 1];
            i += 2;
            continue;
          }
          if (ch === quote) {
            i++;
            break;
          }
          value += ch;
          i++;
        }
        attrs[name] = value;
      } else {
        // Unquoted value: read until whitespace or the tag's closing '>'.
        const valueStart = i;
        while (i < len && !isWhitespace(attrStr[i]) && attrStr[i] !== '>') i++;
        attrs[name] = attrStr.slice(valueStart, i);
      }
    } else {
      // Valueless boolean attribute, e.g. `disabled`.
      attrs[name] = 'true';
    }
  }

  return attrs;
}

/**
 * Parses an HTML string into a tree of HTMLNode elements.
 * @param {string} html
 * @returns {HTMLNode[]}
 */
function parseHTML(html) {
  const root = new HTMLNode('element', 'root');
  const stack = [root];
  let i = 0;

  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  while (i < html.length) {
    // 1. Check for comment
    if (html.startsWith('<!--', i)) {
      const endIdx = html.indexOf('-->', i + 4);
      if (endIdx === -1) {
        const node = new HTMLNode('comment');
        node.content = html.substring(i + 4);
        stack[stack.length - 1].children.push(node);
        break;
      } else {
        const node = new HTMLNode('comment');
        node.content = html.substring(i + 4, endIdx);
        stack[stack.length - 1].children.push(node);
        i = endIdx + 3;
        continue;
      }
    }

    // 2. Check for closing tag
    if (html.startsWith('</', i)) {
      const endIdx = html.indexOf('>', i + 2);
      if (endIdx === -1) {
        const textNode = new HTMLNode('text');
        textNode.content = html.substring(i);
        stack[stack.length - 1].children.push(textNode);
        break;
      } else {
        const tagName = html.substring(i + 2, endIdx).trim();
        let foundIdx = -1;
        for (let j = stack.length - 1; j > 0; j--) {
          if (stack[j].tagName.toLowerCase() === tagName.toLowerCase()) {
            foundIdx = j;
            break;
          }
        }
        if (foundIdx !== -1) {
          while (stack.length > foundIdx) {
            stack.pop();
          }
        }
        i = endIdx + 1;
        continue;
      }
    }

    // 3. Check for opening/self-closing tag
    if (html[i] === '<') {
      let tagEndIdx = -1;
      let inQuote = null;
      let tempIdx = i + 1;
      while (tempIdx < html.length) {
        const c = html[tempIdx];
        if (inQuote) {
          if (c === '\\') {
            tempIdx++;
          } else if (c === inQuote) {
            inQuote = null;
          }
        } else if (c === '"' || c === "'") {
          inQuote = c;
        } else if (c === '>') {
          tagEndIdx = tempIdx;
          break;
        }
        tempIdx++;
      }

      if (tagEndIdx !== -1) {
        const tagContent = html.substring(i + 1, tagEndIdx).trim();
        const isSelfClosing = tagContent.endsWith('/');
        const cleanContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;

        const spaceIdx = cleanContent.search(/\s/);
        const tagName = spaceIdx === -1 ? cleanContent : cleanContent.substring(0, spaceIdx);
        const attrsStr = spaceIdx === -1 ? '' : cleanContent.substring(spaceIdx).trim();

        if (/^[a-zA-Z0-9:-]+$/.test(tagName)) {
          const attrs = parseAttributes(attrsStr);
          const isVoid = voidTags.has(tagName.toLowerCase());
          const node = new HTMLNode('element', tagName, attrs, isSelfClosing || isVoid);
          stack[stack.length - 1].children.push(node);

          if (!isSelfClosing && !isVoid) {
            stack.push(node);
          }
          i = tagEndIdx + 1;
          continue;
        }
      }
    }

    // 4. Text node
    let nextTagIdx = html.indexOf('<', i + 1);
    if (nextTagIdx === -1) {
      nextTagIdx = html.length;
    }
    const text = html.substring(i, nextTagIdx);
    if (text) {
      const textNode = new HTMLNode('text');
      textNode.content = text;
      stack[stack.length - 1].children.push(textNode);
    }
    i = nextTagIdx;
  }

  return root.children;
}

/**
 * Serializes an HTMLNode tree back to an HTML string.
 * @param {HTMLNode[]} nodes
 * @returns {string}
 */
function serializeHTML(nodes) {
  let result = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.content;
    } else if (node.type === 'comment') {
      result += `<!--${node.content}-->`;
    } else if (node.type === 'element') {
      let attrsStr = '';
      for (const [name, val] of Object.entries(node.attrs)) {
        if (val === null || val === undefined) {
          attrsStr += ` ${name}`;
        } else {
          const escapedVal = String(val).replace(/"/g, '&quot;');
          attrsStr += ` ${name}="${escapedVal}"`;
        }
      }
      const voidTags = new Set([
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
      ]);
      if (voidTags.has(node.tagName.toLowerCase()) || node.isSelfClosing) {
        result += `<${node.tagName}${attrsStr} />`;
      } else {
        result += `<${node.tagName}${attrsStr}>${serializeHTML(node.children)}</${node.tagName}>`;
      }
    }
  }
  return result;
}

/**
 * Recursively checks whether a node is a <slot> tag, or has a <slot>
 * anywhere among its descendants. Used to disqualify a subtree from the
 * static-optimization pass, since slots are dynamic transclusion points
 * that DomPatcher must always be able to patch (see issue #200).
 * @param {HTMLNode} node
 * @returns {boolean}
 */
function containsSlot(node) {
  if (node.type !== 'element') {
    return false;
  }
  if (node.tagName.toLowerCase() === 'slot') {
    return true;
  }
  return node.children.some((child) => containsSlot(child));
}

/**
 * Recursively determines if a node (and all its descendants) are completely static.
 * @param {HTMLNode} node
 * @returns {boolean}
 */
function isStaticNode(node) {
  if (node.type === 'text') {
    if (node.content.includes('{{') || node.content.includes('{%')) {
      return false;
    }
    return true;
  }

  if (node.type === 'comment') {
    return true;
  }

  if (node.type === 'element') {
    const lowerTag = node.tagName.toLowerCase();
    if (lowerTag === 'template' || lowerTag === 'slot') {
      return false;
    }

    // A wrapper that contains a <slot> anywhere beneath it must never be
    // marked static: slot content is transcluded dynamically per-instance,
    // so a static-tagged ancestor would cause DomPatcher to skip patching
    // it entirely and slot updates would be silently dropped.
    if (containsSlot(node)) {
      return false;
    }

    if (/^[A-Z]/.test(node.tagName)) {
      return false;
    }

    for (const [name, val] of Object.entries(node.attrs)) {
      if (name.startsWith('@')) {
        return false;
      }
      if ((name.startsWith('data-ax-') && name !== 'data-ax-static') || name.startsWith('data-avenx-')) {
        return false;
      }
      if (val && (val.includes('{{') || val.includes('{%'))) {
        return false;
      }
    }

    for (const child of node.children) {
      if (!isStaticNode(child)) {
        return false;
      }
    }

    return true;
  }

  return false;
}

export default ComponentParser;
