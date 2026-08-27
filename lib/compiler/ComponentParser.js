import fs from 'fs';
import path from 'path';
import ExpressionParser from './expressionParser.js';
import { analyzeBridgeFile, findBridgeImports } from './BridgeParser.js';
import ContractValidator from './ContractValidator.js';
import { logger } from '../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { RESERVED_INSTANCE_KEYS } from '../core/runtime/AvenxComponent.js';
import { TemplateValidationError, BuildError } from './errors/index.js';
import { reportWarning } from './utils/warningReporter.js';
import { replaceEnvVariables } from '../env.js';
import { processBindDirectives } from '../core/utils/templateUtils.js';
import loadConfig, { resolvePathAlias } from '../config.js';

/**
 * The set of HTML tags that are void (self-closing / no children) by
 * default. Custom tags can be added on top of this list on a per-project
 * basis via the `voidTags` array in `avenx.config.json` (see
 * {@link getCustomVoidTags} and issue #198).
 * @type {string[]}
 */
const DEFAULT_VOID_TAGS = [
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
];

/**
 * Builds the effective set of void tags for a parse/serialize pass by
 * combining {@link DEFAULT_VOID_TAGS} with any project-specific tags.
 * @param {string[]} [customVoidTags] - Additional void tag names (lowercase).
 * @returns {Set<string>}
 */
function buildVoidTagsSet(customVoidTags = []) {
  return new Set([...DEFAULT_VOID_TAGS, ...customVoidTags]);
}

/**
 * Cache of resolved `avenx.config.json` contents, keyed by the directory
 * the search started from, so each component file doesn't re-read and
 * re-parse the config from disk.
 * @type {Map<string, object|null>}
 */
const configCache = new Map();

/**
 * Walks up the directory tree from `startDir` looking for an
 * `avenx.config.json` file, and returns its parsed contents (or `null` if
 * none is found, or if it fails to parse).
 * @param {string} startDir - Absolute directory to start searching from.
 * @returns {object|null}
 */
function loadAvenxConfig(startDir) {
  if (configCache.has(startDir)) {
    return configCache.get(startDir);
  }

  let config = null;
  let currentDir = startDir;
  while (currentDir) {
    const configPath = path.join(currentDir, 'avenx.config.json');
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (err) {
        reportWarning(AvenxErrorCodes.COMPILER_INVALID_CONFIG, new BuildError(AvenxErrorCodes.COMPILER_INVALID_CONFIG, configPath, err.message));
        config = null;
      }
      break;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  configCache.set(startDir, config);
  return config;
}

/**
 * Resolves the list of project-specific void tags declared in
 * `avenx.config.json` (via a `voidTags` array) for the given component
 * file, e.g.:
 * ```json
 * { "voidTags": ["my-video", "my-icon"] }
 * ```
 * @param {string} [filePath] - Absolute path of the component file being compiled.
 * @returns {string[]} Lowercased, trimmed custom void tag names. Empty if none configured.
 */
function getCustomVoidTags(filePath) {
  if (!filePath) {
    return [];
  }
  const startDir = path.resolve(path.dirname(filePath));
  const config = loadAvenxConfig(startDir);
  if (!config || !Array.isArray(config.voidTags)) {
    return [];
  }
  return config.voidTags
    .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
    .map((tag) => tag.trim().toLowerCase());
}



/**
 * ComponentParser handles the parsing of Avenx component files (.js and .css).
 * It extracts component state, computed properties, methods, and templates,
 * and coordinates with the StyleProcessor to handle styles.
 */
class ComponentParser {
  /**
   * @param {StyleProcessor} styleProcessor - An instance of StyleProcessor to handle styles.
   * @param {string[]} [customVoidTags] - Additional void tag names (lowercase).
   * @param {object} [config] - Project configuration object.
   */
  constructor(styleProcessor, customVoidTags = [], config = null) {
    /** @type {StyleProcessor} */
    this.styleProcessor = styleProcessor;
    /** @type {object|null} */
    this.config = config;
    /** @type {ExpressionParser} */
    this.expressionParser = new ExpressionParser(config);
    /** @type {string[]} */
    this.customVoidTags = customVoidTags || [];
    /**
     * Bridges discovered by the compiler, keyed by absolute path. Set by
     * AvenxCompiler before components are parsed; when a component is parsed
     * standalone (tests, the Vite plugin) bridges are analysed on demand.
     * @type {Map<string, object>}
     */
    this.bridges = new Map();
  }

  /**
   * Supplies the project's bridge descriptors, so imports can be resolved
   * without re-reading each bridge module for every component.
   * @param {Map<string, object>} bridges - Descriptors keyed by absolute path.
   */
  setBridges(bridges) {
    this.bridges = bridges instanceof Map ? bridges : new Map();
  }

  /**
   * Resolves the bridges a component imports into template scope bindings.
   *
   * The import is the declaration: a component sees exactly the bridges it
   * imported, under the local name it chose. Nothing is ambient, so the
   * compiler knows every consumer of every bridge.
   * @param {string} filePath - Absolute path to the component file.
   * @param {string} content - The component source.
   * @param {string} name - The component class name, for diagnostics.
   * @param {Set<string>} contracts - The component's declared contracts.
   * @returns {Array<{local: string, binding: string, bridge: string}>} The bindings.
   * @private
   */
  resolveBridgeBindings(filePath, content, name, contracts) {
    const bindings = [];
    for (const entry of findBridgeImports(filePath, content)) {
      const key = path.resolve(entry.resolved);
      let descriptor = this.bridges.get(key);
      if (!descriptor) {
        descriptor = analyzeBridgeFile(key, replaceEnvVariables);
        if (!descriptor) {
          continue;
        }
        this.bridges.set(key, descriptor);
      }

      if (contracts && contracts.has('isolated')) {
        throw new BuildError(AvenxErrorCodes.COMPILER_BRIDGE_ISOLATED_IMPORT, name, descriptor.name);
      }

      bindings.push({ local: entry.local, binding: descriptor.binding, bridge: descriptor.name });
    }
    return bindings;
  }

  /**
   * Parses a .component.js or .page.js file and its corresponding CSS file.
   * @param {string} filePath - The absolute path to the file.
   * @param {'component'|'page'} [type] - The type of file being parsed.
   * @returns {string} The generated JavaScript class.
   */
  parse(filePath, type = 'component') {
    const config = this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    const rootDir = filePath ? loadConfig.findProjectRoot(path.dirname(filePath)) : process.cwd();
    filePath = resolvePathAlias(filePath, config, rootDir);

    const isPage = type === 'page';
    const content = replaceEnvVariables(fs.readFileSync(filePath, 'utf-8'));
    const fileName = path.basename(filePath).replace(/\.(component|page)?\.(js|html|avx)$/i, '');

    // Convert user-profile or user_profile to UserProfile
    const name = fileName
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    const desPath = filePath.replace(/\.(component|page)?\.(js|html|avx)$/i, isPage ? '.page.css' : '.component.css');
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
      this.styleProcessor.registerSourceFile(desPath, desContent);
      this.extractStylesAndVars(desContent, desBlocks, desPath);
    }

    const contracts = this.extractContracts(content);
    const bridgeBindings = this.resolveBridgeBindings(filePath, content, name, contracts);
    const state = this.extractState(content, filePath, config);
    const computed = this.extractComputed(content);
    const methods = this.extractMethods(content, name, filePath, config);
    const resources = this.expressionParser.parseResources(content);
    let template = this.extractTemplate(
      content,
      desBlocks,
      name,
      filePath,
      state,
      computed,
      methods,
      resources,
      bridgeBindings.map((entry) => entry.local),
    );

    // Handle declarative tags: <MyComponent /> or <MyComponent>...</MyComponent> -> <div data-avenx-comp="MyComponent">...</div>
    // Only if it looks like a component (starts with uppercase)
    template = this.processComponentTags(template);

    // Validate compiler contracts (static, pure, deterministic, isolated)
    const customVoidTags = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
    const astNodes = parseHTML(template, customVoidTags);
    const validation = ContractValidator.validate(astNodes, {
      name,
      filePath,
      contracts,
      state,
      computed,
      methods,
      resources,
      config,
    });
    if (!validation.valid && validation.errors.length > 0) {
      throw validation.errors[0];
    }

    // Identify and mark static subtrees for patcher performance optimization
    template = this.optimizeStaticSubtrees(template, filePath);

    // Templates and method bodies are emitted as JSON string literals rather
    // than backtick-wrapped template literals: a `${...}` sequence in component
    // HTML (or a legitimate template literal inside an <action> body) would
    // otherwise be interpolated by the generated bundle instead of being
    // preserved verbatim.
    const methodStrings = Object.entries(methods)
      .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(',\n        ');
    const templateLiteral = JSON.stringify(template);

    const contractsList = Array.from(contracts || []);
    const contractsParam = contractsList.length > 0 ? `, { contracts: ${JSON.stringify(contractsList)} }` : '';

    // Imported bridges join the component's template scope under their local
    // name, on top of the bridges the app registered.
    const bridgesExpr =
      bridgeBindings.length > 0
        ? `{ ...bridges, ${bridgeBindings.map((entry) => `${JSON.stringify(entry.local)}: ${entry.binding}`).join(', ')} }`
        : 'bridges';

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
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, ${bridgesExpr}, ${templateLiteral}, { ${methodStrings} }, componentRegistry, props, ${JSON.stringify(styles)}, ${JSON.stringify(resources)}${contractsParam});
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
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, ${bridgesExpr}, ${templateLiteral}, { ${methodStrings} }, props, ${JSON.stringify(styles)}, ${JSON.stringify(resources)}${contractsParam});
    }
}`;
  }

  /**
   * Extracts global CSS variables and component-specific style blocks from CSS content.
   * @param {string} desContent - The content of the .component.css file.
   * @param {object} desBlocks - An object to store the extracted style blocks.
   * @param {string} [desPath] - The original CSS file path.
   * @private
   */
  extractStylesAndVars(desContent, desBlocks, desPath = '') {
    const globalMatch = desContent.match(/<@global>([\s\S]*?)<\/ ?@global>/i);
    let rawGlobalCss = '';
    if (globalMatch) {
      const idx = desContent.indexOf(globalMatch[0]);
      const globalStartLine = desContent.substring(0, idx).split('\n').length;

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
        this.styleProcessor.addGlobalCSS(compiledGlobalCss, desPath, globalStartLine);
      }
    }

    const cssBlockMatch = desContent.match(/<@css>([\s\S]*?)<\/ ?@css>/i);
    if (cssBlockMatch) {
      const cssContentOffset = desContent.indexOf(cssBlockMatch[0]);
      const cssStartLine = desContent.substring(0, cssContentOffset).split('\n').length;

      const inner = cssBlockMatch[1];
      let depth = 0,
        currentName = '',
        currentBody = '',
        inBlock = false;
      let inString = null;
      let inComment = false;

      let blockStartLineOffset = 0;
      let currentLineOffset = 0;

      for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (char === '\n') {
          currentLineOffset++;
        }

        if (inComment) {
          if (char === '*' && inner[i + 1] === '/') {
            inComment = false;
            i++; // skip '/'
          }
          continue;
        }

        if (char === '/' && inner[i + 1] === '*') {
          inComment = true;
          i++; // skip '*'
          continue;
        }

        if (inString) {
          const toAppend = char;
          let nextToAppend = '';
          if (char === '\\') {
            if (i + 1 < inner.length) {
              nextToAppend = inner[i + 1];
              if (inner[i + 1] === '\n') currentLineOffset++;
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
            const namePart = inner.substring(0, i).trim().split('}').pop().trim();
            currentName = namePart.replace(/\/\*[\s\S]*?\*\//g, '').trim();

            blockStartLineOffset = currentLineOffset;
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
                  finalBody = this.styleProcessor.preprocessBlock(
                    rawGlobalCss,
                    finalBody,
                    this.styleProcessor.options.preprocessor,
                  );
                }
                desBlocks[currentName] = finalBody;
                if (!desBlocks._sourceMapInfo) {
                  Object.defineProperty(desBlocks, '_sourceMapInfo', {
                    value: {},
                    writable: true,
                    enumerable: false,
                    configurable: true,
                  });
                }
                desBlocks._sourceMapInfo[currentName] = {
                  startLine: cssStartLine + blockStartLineOffset,
                  sourceFile: desPath,
                };
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
   * Extracts compiler contracts from the component's <contract /> tags.
   * @param {string} content - The content of the .component.js file.
   * @returns {Set<string>} The set of declared contracts.
   * @private
   */
  extractContracts(content) {
    return this.expressionParser.parseContracts(content);
  }

  /**
   * Extracts the initial state from the component's <state /> tags.
   * @param {string} content - The content of the .component.js file.
   * @param {string} [filePath] - The component file path.
   * @param {object} [config] - Project configuration object.
   * @returns {object} The extracted state object.
   * @private
   */
  extractState(content, filePath = '', config = null) {
    const activeConfig = config || this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    return this.expressionParser.parseState(content, activeConfig);
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
   * Extracts actions (methods) from the component's <action /> tags and validates method names.
   * @param {string} content - The content of the .component.js file.
   * @param {string} [name] - Component name.
   * @param {string} [filePath] - Component file path.
   * @param {object} [config] - Project configuration object.
   * @returns {Object<string, string>} A map of method names to their stringified bodies.
   * @private
   */
  extractMethods(content, name = '', filePath = '', config = null) {
    const methods = this.expressionParser.parseMethods(content);
    const activeConfig = config || this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    if (methods && typeof methods === 'object') {
      for (const methodName of Object.keys(methods)) {
        if (RESERVED_INSTANCE_KEYS.includes(methodName)) {
          const actionMatchIdx = content.search(new RegExp(`<action\\s+[^>]*name=["']${methodName}["']`));
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION,
            methodName,
            name || (filePath ? path.basename(filePath) : 'Component'),
          );
          if (actionMatchIdx >= 0) {
            err.setLocation({ source: content, index: actionMatchIdx, filename: filePath });
          }
          reportWarning(
            AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION,
            err,
            activeConfig,
          );
        }
      }
    }
    return methods;
  }

  /**
   * Preprocesses a raw template string using configured template preprocessor hooks.
   * Supports custom filter functions (e.g. Pug -> HTML) before ComponentParser parses HTML.
   * @param {string} rawTemplate - The raw template content.
   * @param {string} [filePath] - Absolute path to component file.
   * @returns {string} Preprocessed template string.
   */
  preprocessTemplate(rawTemplate, filePath = '') {
    if (!rawTemplate || typeof rawTemplate !== 'string') return rawTemplate;

    const config = this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    if (!config || !config.preprocessors) {
      return rawTemplate;
    }

    const preprocessors = config.preprocessors;
    let templateContent = rawTemplate;
    let lang = null;

    // Check if the template is wrapped in <template lang="...">...</template> or <template>...</template>
    const templateTagMatch = rawTemplate.match(/^<template(?:\s+lang=['"]?([\w-]+)['"]?)?\s*>([\s\S]*?)<\/template>$/i);
    if (templateTagMatch) {
      lang = templateTagMatch[1] ? templateTagMatch[1].toLowerCase() : null;
      templateContent = templateTagMatch[2];
    }

    let filterFn = null;

    if (typeof preprocessors === 'function') {
      filterFn = preprocessors;
    } else if (typeof preprocessors === 'object' && preprocessors !== null) {
      if (lang) {
        filterFn = preprocessors[lang] || preprocessors['.' + lang];
      }
      if (!filterFn) {
        filterFn = preprocessors.template || preprocessors.html || preprocessors.default;
      }
      if (!filterFn && Object.keys(preprocessors).length === 1) {
        filterFn = Object.values(preprocessors)[0];
      }
    }

    if (typeof filterFn === 'function') {
      try {
        const meta = { filePath, lang };
        const result = filterFn(templateContent, meta);
        if (typeof result === 'string') {
          return result;
        }
      } catch (err) {
        reportWarning(
          AvenxErrorCodes.COMPILER_INVALID_CONFIG,
          new BuildError(AvenxErrorCodes.COMPILER_INVALID_CONFIG, filePath || 'template', `Preprocessor execution error: ${err.message}`)
        );
      }
    }

    return templateContent;
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
   * @param {object} [resources] - The extracted resources.
   * @param {string[]} [bridgeLocals] - Local names of imported bridges, which are in template scope.
   * @returns {string} The cleaned and processed HTML template.
   * @private
   */
  extractTemplate(content, desBlocks, name, filePath, state, computed, methods, resources = {}, bridgeLocals = []) {
    let template = content
      // ES imports are declarations, not markup. They resolve child components
      // and bridges at compile time and must not survive into the template,
      // where they would render as a stray text node.
      .replace(/^[ \t]*import\s+(?:[\s\w$,{}*]*?\s+from\s+)?['"][^'"]*['"];?[ \t]*\r?\n?/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<state.*? \/>/g, '')
      .replace(/<computed.*? \/>/g, '')
      .replace(/<action.*?>[\s\S]*?<\/action>/g, '')
      .replace(/<resource.*?>[\s\S]*?<\/resource>/g, '')
      .replace(/<resource\s+[\s\S]*?\/>/gi, '')
      .replace(/<contract.*? \/>/gi, '')
      .replace(/<@contract.*? \/>/gi, '')
      .trim();

    template = this.preprocessTemplate(template, filePath);

    const isPage = filePath && filePath.endsWith('.page.js');

    const desPath = filePath
      ? filePath.replace(
        isPage ? '.page.js' : '.component.js',
        isPage ? '.page.css' : '.component.css'
      )
      : '';

    template = this.styleProcessor.process(
      template,
      desBlocks,
      name,
      desPath
    );

    template = this.processBindDirectives(template);

    if (filePath && state && computed && methods) {
      this.validateTemplate(
        template,
        state,
        computed,
        methods,
        resources,
        filePath,
        name,
        bridgeLocals
      );
    }

    template = this.processForLoops(template);
    template = this.processSuspense(template);
    template = this.processErrorBoundary(template);
    template = this.processDeadlock(template, filePath);
    template = this.processDefer(template);
    template = this.processTransitionTags(template, filePath);
    template = this.processEventDelegation(template, filePath);

    return template
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');
  }


  /**
   * Translates common event handler attributes (@click, @input, etc.)
   * to a single data-ax-event JSON-encoded attribute for centralized delegation.
   * @param {string} template - The HTML template string.
   * @param {string} filePath - The component file path.
   * @returns {string} The transformed template string.
   */
  processEventDelegation(template, filePath) {
    if (!template) return template;
    const customVoidTags = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
    const nodes = parseHTML(template, customVoidTags);
    const COMMON_EVENTS = ['click', 'input', 'change', 'keydown'];

    const transformNode = (node) => {
      if (node.type === 'element') {
        const eventMap = {};
        for (const [name, val] of Object.entries(node.attrs)) {
          if (name.startsWith('@')) {
            const fullEventName = name.substring(1);
            const baseEventName = fullEventName.split('.')[0];
            if (COMMON_EVENTS.includes(baseEventName)) {
              delete node.attrs[name];
              eventMap[fullEventName] = val;
            }
          }
        }
        if (Object.keys(eventMap).length > 0) {
          node.attrs['data-ax-event'] = JSON.stringify(eventMap);
        }
        if (node.children) {
          node.children.forEach(transformNode);
        }
      }
    };

    nodes.forEach(transformNode);
    return serializeHTML(nodes, customVoidTags);
  }

  /**
   * Processes slot elements in the template, converting dynamic props starting
   * with `:` to `data-props-` attributes.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  processSlotProps(template) {
    if (!template) return template;
    const slotRegex = /<slot\b([^>]*?)>/gi;
    return template.replace(slotRegex, (match, attrsStr) => {
      const replacedAttrs = attrsStr.replace(/\s+:([\w\d.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (m, name, dquote, squote) => {
        const val = dquote !== undefined ? dquote : squote;
        return ` data-props-${name}="${val}"`;
      });
      return `<slot${replacedAttrs}>`;
    });
  }

  /**
   * Encodes interpolations inside `<template data-slot-props="...">` tags
   * to avoid premature evaluation by the parent component.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  escapeScopedSlots(template) {
    if (!template) return template;
    let currentTemplate = template;
    const startRegex = /<template\s+[^>]*\bdata-slot-props="([^"]*)"[^>]*>/gi;
    let match;

    while ((match = startRegex.exec(currentTemplate)) !== null) {
      const startIndex = match.index;
      const tagOpenLength = match[0].length;

      // Find the matching </template> tag by tracking depth
      let searchIndex = startIndex + tagOpenLength;
      let depth = 1;
      let closingIndex = -1;

      while (searchIndex < currentTemplate.length) {
        const nextOpen = currentTemplate.substring(searchIndex).match(/^<template\b/i);
        const nextClose = currentTemplate.substring(searchIndex).match(/^<\/template>/i);

        if (nextClose) {
          depth--;
          if (depth === 0) {
            closingIndex = searchIndex;
            break;
          }
          searchIndex += nextClose[0].length;
        } else if (nextOpen) {
          depth++;
          searchIndex += nextOpen[0].length;
        } else {
          searchIndex++;
        }
      }

      if (closingIndex !== -1) {
        const contentStart = startIndex + tagOpenLength;
        const content = currentTemplate.substring(contentStart, closingIndex);

        // Escape interpolations in the content
        // [\s\S] rather than . so a multi-line expression inside a scoped slot
        // is escaped as a whole instead of being left half-encoded.
        const escapedContent = content
          .replace(/\{\{\{\s*([\s\S]*?)\s*\}\}\}/g, (m, g) => `_AX_LBRACE3_${g}_AX_RBRACE3_`)
          .replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (m, g) => `_AX_LBRACE_${g}_AX_RBRACE_`);

        currentTemplate = currentTemplate.substring(0, contentStart) + escapedContent + currentTemplate.substring(closingIndex);

        // Advance regex lastIndex past the modified template block
        startRegex.lastIndex = contentStart + escapedContent.length + 11; // 11 is length of </template>
      }
    }
    return currentTemplate;
  }


  /**
   * Performs compile-time validation on template expressions to ensure
   * all referenced variables and methods are declared.
   * @param {string} template - The template string (after data-ax-bind translation).
   * @param {object} state - The extracted state keys.
   * @param {object} computed - The extracted computed keys.
   * @param {object} methods - The extracted method keys.
   * @param {object} [resources] - The extracted resources.
   * @param {string} filePath - The component file path.
   * @param {string} [name] - The component name, used for warning messages.
   * @param {string[]} [bridgeLocals] - Local names of imported bridges, which are in template scope.
   * @private
   */
  validateTemplate(template, state, computed, methods, resources, filePath, name, bridgeLocals = []) {
    const config = this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    if (!template || template.trim() === '') {
      reportWarning(
        AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE,
        new TemplateValidationError(AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE, name),
        config,
      );
    }

    const declared = new Set([
      ...Object.keys(state),
      ...Object.keys(computed),
      ...Object.keys(methods),
      ...Object.keys(resources || {}),
      ...bridgeLocals,
    ]);

    // Extract loop item variables from <@for item in list>
    const forLoopRegex = /<@for\s+(\w+)\s+in\s+([^>]+?)>/gi;
    let forMatch;
    while ((forMatch = forLoopRegex.exec(template)) !== null) {
      declared.add(forMatch[1].trim());
    }

    const slotPropsRegex = /data-slot-props="([^"]*)"/gi;
    let slotPropsMatch;
    while ((slotPropsMatch = slotPropsRegex.exec(template)) !== null) {
      declared.add(slotPropsMatch[1].trim());
    }

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

      const dirRegex = /\b(data-ax-[a-zA-Z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let dirMatch;
      while ((dirMatch = dirRegex.exec(match[0])) !== null) {
        events.push({
          type: 'directive',
          index: tagIndex + dirMatch.index,
          length: dirMatch[0].length,
          expr: dirMatch[2] !== undefined ? dirMatch[2] : dirMatch[3],
        });
      }

      const idAttrRegex = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let idMatch;
      while ((idMatch = idAttrRegex.exec(match[0])) !== null) {
        const idVal = idMatch[1] !== undefined ? idMatch[1] : idMatch[2];
        if (idVal && !idVal.includes('{{')) {
          events.push({
            type: 'id_attribute',
            index: tagIndex + idMatch.index,
            length: idMatch[0].length,
            idValue: idVal,
          });
        }
      }
    }

    events.sort((a, b) => a.index - b.index);

    const currentLoopVars = [];
    const seenIds = new Set();
    let loopDepth = 0;
    const filename = path.basename(filePath);

    const checkIdentifiers = (expr, eventIndex = -1) => {
      const ids = this.extractRootIdentifiers(expr);
      for (const id of ids) {
        if (EXCLUDED_IDENTIFIERS.has(id)) {
          continue;
        }
        if (currentLoopVars.includes(id)) {
          continue;
        }
        if (!declared.has(id)) {
          const idx = eventIndex >= 0 ? eventIndex : template.indexOf(expr);
          const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, id, filename);
          if (idx >= 0) {
            err.setLocation({ source: template, index: idx, filename, length: id.length });
          }
          reportWarning(
            AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE,
            err,
            config,
          );
        }
      }
    };

    for (const ev of events) {
      if (ev.type === 'loop_start') {
        checkIdentifiers(ev.list, ev.index);
        currentLoopVars.push(ev.item);
        loopDepth++;
      } else if (ev.type === 'loop_end') {
        currentLoopVars.pop();
        loopDepth = Math.max(0, loopDepth - 1);
      } else if (ev.type === 'id_attribute') {
        if (seenIds.has(ev.idValue) || loopDepth > 0) {
          const idx = ev.index >= 0 ? ev.index : template.indexOf(`id="${ev.idValue}"`);
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_DUPLICATE_ID_ATTRIBUTE,
            ev.idValue,
            name || filename,
          );
          if (idx >= 0) {
            err.setLocation({ source: template, index: idx, filename });
          }
          reportWarning(
            AvenxErrorCodes.COMPILER_DUPLICATE_ID_ATTRIBUTE,
            err,
            config,
          );
        }
        seenIds.add(ev.idValue);
      } else if (ev.type === 'interpolation' || ev.type === 'event' || ev.type === 'directive') {
        checkIdentifiers(ev.expr, ev.index);
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
      // Matches <@for item in list> or <@for item in list key="item.id">, or closing tag </@for> / </ @for>, or <@empty>
      const tagRegex = /(<@for\s+(?:(\w+)|\[\s*(\w+)(?:\s*,\s*(\w+))?\s*\])\s+in\s+([^>]+?)(?:\s+key="([^"]*)")?>)|(<\/ ?@for>)|(<@empty>)/gi;
      let match;
      const tags = [];
      while ((match = tagRegex.exec(currentTemplate)) !== null) {
        if (match[1]) {
          tags.push({
            type: 'start',
            index: match.index,
            length: match[0].length,
            item: match[2] || `[${match[3]}${match[4] ? ', ' + match[4] : ''}]`,
            list: match[5],
            key: match[6],
          });
        } else if (match[7]) {
          tags.push({
            type: 'end',
            index: match.index,
            length: match[0].length,
          });
        } else if (match[8]) {
          tags.push({
            type: 'empty',
            index: match.index,
            length: match[0].length,
          });
        }
      }

      if (tags.length === 0) {
        break;
      }

      let innerPair = null;
      let innerEmpty = null;
      const stack = [];
      const emptyStack = [];
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        if (tag.type === 'start') {
          stack.push(tag);
          emptyStack.push(null);
        } else if (tag.type === 'empty') {
          if (emptyStack.length > 0) {
            emptyStack[emptyStack.length - 1] = tag;
          }
        } else {
          const startTag = stack.pop();
          const emptyTag = emptyStack.pop();
          if (startTag) {
            innerPair = { start: startTag, end: tag };
            innerEmpty = emptyTag;
            break; // Found innermost loop!
          }
        }
      }

      if (!innerPair) {
        const unmatchedIdx = (stack.length > 0 && stack[0].index !== undefined) ? stack[0].index : currentTemplate.indexOf('<@for');
        const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_UNMATCHED_FOR_TAG);
        if (unmatchedIdx >= 0) {
          err.setLocation({ source: currentTemplate, index: unmatchedIdx });
        }
        logger.warn(err.message);
        break;
      }

      const startIdx = innerPair.start.index;
      const endIdx = innerPair.end.index + innerPair.end.length;

      let body, emptyBody = '';
      const bodyStart = startIdx + innerPair.start.length;
      const bodyEnd = innerPair.end.index;

      if (innerEmpty) {
        body = currentTemplate.substring(bodyStart, innerEmpty.index);
        emptyBody = currentTemplate.substring(innerEmpty.index + innerEmpty.length, bodyEnd);
      } else {
        body = currentTemplate.substring(bodyStart, bodyEnd);
      }

      // Escape inner interpolation tags to prevent them from being processed
      // by the initial template render. They will be processed per-item at runtime.
      const escapedBody = body.replace(/\{\{/g, '{%').replace(/\}\}/g, '%}');
      let attrs = `data-ax-for="${innerPair.start.list.trim()}" data-ax-as="${innerPair.start.item.trim()}"`;
      if (innerPair.start.key) {
        attrs += ` data-ax-key="${innerPair.start.key.trim()}"`;
      }

      let replacement = `<template ${attrs}>${escapedBody}</template>`;
      if (innerEmpty) {
        const escapedEmptyBody = emptyBody.replace(/\{\{/g, '{%').replace(/\}\}/g, '%}');
        replacement += `<template data-ax-empty>${escapedEmptyBody}</template>`;
      }
      currentTemplate = currentTemplate.substring(0, startIdx) + replacement + currentTemplate.substring(endIdx);
    }

    return currentTemplate;
  }

  /**
   * Processes <@suspense> tags, converting them to DOM markers.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   * @private
   */
  processSuspense(template) {
    let currentTemplate = template;
    while (true) {
      const match = currentTemplate.match(/<@suspense>([\s\S]*?)<\/ ?@suspense>/i);
      if (!match) break;

      const fullMatch = match[0];
      const inner = match[1];

      // Extract <@fallback>
      let fallbackContent = '';
      let suspenseContent = inner;
      const fallbackMatch = inner.match(/<@fallback>([\s\S]*?)<\/ ?@fallback>/i);
      if (fallbackMatch) {
        fallbackContent = fallbackMatch[1].replace(/\{\{/g, '{%').replace(/\}\}/g, '%}'); // Escape fallback template logic
        suspenseContent = inner.replace(fallbackMatch[0], '');
      }

      const replacement = `<div data-ax-suspense="true"><template data-ax-fallback>${fallbackContent}</template>${suspenseContent}</div>`;
      currentTemplate = currentTemplate.replace(fullMatch, replacement);
    }
    return currentTemplate;
  }

  /**
   * Processes <@errorBoundary> tags, converting them to DOM markers.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   * @private
   */
  processErrorBoundary(template) {
    let currentTemplate = template;
    while (true) {
      const match = currentTemplate.match(/<@errorBoundary>([\s\S]*?)<\/ ?@errorBoundary>/i);
      if (!match) break;

      const fullMatch = match[0];
      const inner = match[1];

      // Extract <@fallback as="...">
      let fallbackContent = '';
      let errorAs = 'error';
      let boundaryContent = inner;
      const fallbackMatch = inner.match(/<@fallback(?:\s+as="([^"]*)")?>([\s\S]*?)<\/ ?@fallback>/i);
      if (fallbackMatch) {
        errorAs = fallbackMatch[1] || 'error';
        fallbackContent = fallbackMatch[2].replace(/\{\{/g, '{%').replace(/\}\}/g, '%}'); // Escape fallback logic
        boundaryContent = inner.replace(fallbackMatch[0], '');
      }

      const replacement = `<div data-ax-error-boundary="true" data-ax-error-as="${errorAs}"><template data-ax-error-fallback><div class="ax-error-boundary">${fallbackContent}</div></template>${boundaryContent}</div>`;
      currentTemplate = currentTemplate.replace(fullMatch, replacement);
    }
    return currentTemplate;
  }

  /**
   * Processes <@deadlock> tags, converting them to DOM boundary markers.
   * Supports attributes: name="...", maxDepth="...", action="abort|fallback|throw", isolated="true|false",
   * and optional inner <@fallback as="..."> tags for error recovery.
   * @param {string} template - The template string.
   * @param {string} [filePath] - The component file path for source location tracking.
   * @returns {string} The processed template.
   * @private
   */
  processDeadlock(template, filePath = '') {
    let currentTemplate = template;
    const deadlockRegex = /<@deadlock\b([^>]*)>((?:(?!<@deadlock\b)[\s\S])*?)<\/ ?@deadlock>/i;

    while (true) {
      const match = currentTemplate.match(deadlockRegex);
      if (!match) break;

      const fullMatch = match[0];
      const attrsStr = match[1] || '';
      const inner = match[2];

      const nameMatch = attrsStr.match(/\bname=["']([^"']*)["']/i);
      const name = nameMatch ? nameMatch[1].trim() : 'anonymous';

      const depthMatch = attrsStr.match(/\bmaxDepth=["']([^"']*)["']/i);
      const depthAttr = depthMatch ? ` data-ax-deadlock-depth="${depthMatch[1].trim()}"` : '';

      const actionMatch = attrsStr.match(/\baction=["']([^"']*)["']/i);
      const actionAttr = actionMatch ? ` data-ax-deadlock-action="${actionMatch[1].trim().toLowerCase()}"` : '';

      const isolatedMatch = attrsStr.match(/\bisolated=["']([^"']*)["']/i);
      const isolatedAttr = isolatedMatch ? ` data-ax-deadlock-isolated="${isolatedMatch[1].trim().toLowerCase()}"` : '';

      // Compute location if possible
      let locAttr = '';
      if (filePath) {
        const matchIdx = currentTemplate.indexOf(fullMatch);
        if (matchIdx !== -1) {
          const pos = getLineAndColumn(currentTemplate, matchIdx);
          locAttr = ` data-ax-deadlock-loc="${filePath}:${pos.line}:${pos.column}"`;
        }
      }

      // Extract <@fallback as="...">
      let fallbackContent = '';
      let errorAs = 'error';
      let boundaryContent = inner;
      const fallbackMatch = inner.match(/<@fallback(?:\s+as="([^"]*)")?>([\s\S]*?)<\/ ?@fallback>/i);
      if (fallbackMatch) {
        errorAs = fallbackMatch[1] || 'error';
        fallbackContent = fallbackMatch[2].replace(/\{\{/g, '{%').replace(/\}\}/g, '%}');
        boundaryContent = inner.replace(fallbackMatch[0], '');
      }

      const fallbackTpl = fallbackMatch
        ? `<template data-ax-deadlock-fallback="true" data-ax-error-as="${errorAs}"><div class="ax-deadlock-fallback">${fallbackContent}</div></template>`
        : '';

      const replacement = `<div data-ax-deadlock="true" data-ax-deadlock-name="${name}"${depthAttr}${actionAttr}${isolatedAttr}${locAttr}>${fallbackTpl}${boundaryContent}</div>`;
      currentTemplate = currentTemplate.replace(fullMatch, replacement);
    }
    return currentTemplate;
  }

  /**
   * Processes <@defer> tags, converting them to DOM markers with templates for deferred loading.
   * Supports triggers via when="<trigger>" (idle, visible, interaction, timer, expression)
   * and optional <@placeholder> and <@loading> sub-tags.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   * @private
   */
  processDefer(template) {
    let currentTemplate = template;
    while (true) {
      const match = currentTemplate.match(/<@defer(?:\s+when=["']([^"']*)["'])?\s*>([\s\S]*?)<\/ ?@defer>/i);
      if (!match) break;

      const fullMatch = match[0];
      const whenCondition = (match[1] || 'idle').trim();
      const inner = match[2];

      let placeholderContent = '';
      let loadingContent = '';
      let deferredContent = inner;

      const placeholderMatch = inner.match(/<@placeholder>([\s\S]*?)<\/ ?@placeholder>/i);
      if (placeholderMatch) {
        placeholderContent = placeholderMatch[1].replace(/\{\{/g, '{%').replace(/\}\}/g, '%}').trim();
        deferredContent = deferredContent.replace(placeholderMatch[0], '');
      }

      const loadingMatch = inner.match(/<@loading>([\s\S]*?)<\/ ?@loading>/i);
      if (loadingMatch) {
        loadingContent = loadingMatch[1].replace(/\{\{/g, '{%').replace(/\}\}/g, '%}').trim();
        deferredContent = deferredContent.replace(loadingMatch[0], '');
      }

      deferredContent = deferredContent.replace(/\{\{/g, '{%').replace(/\}\}/g, '%}').trim();

      const placeholderTpl = placeholderContent ? `<template data-ax-defer-placeholder>${placeholderContent}</template>` : '';
      const loadingTpl = loadingContent ? `<template data-ax-defer-loading>${loadingContent}</template>` : '';
      const contentTpl = `<template data-ax-defer-content>${deferredContent}</template>`;

      const replacement = `<div data-ax-defer="true" data-ax-defer-when="${whenCondition}">${placeholderTpl}${loadingTpl}${contentTpl}</div>`;
      currentTemplate = currentTemplate.replace(fullMatch, replacement);
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
    currentTemplate = this.processSlotProps(currentTemplate);
    currentTemplate = this.escapeScopedSlots(currentTemplate);

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

      const replacementTag = isDynamic ? `data-avenx-comp-dynamic="${isExpr}"` : `data-avenx-comp="${compName}"`;

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
   * @param {string} [filePath] - The component file path, used to resolve project-specific
   *   void tags from `avenx.config.json` (see {@link getCustomVoidTags}).
   * @returns {string} The processed template.
   */
  processTransitionTags(template, filePath) {
    try {
      const customVoidTags = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
      const nodes = parseHTML(template, customVoidTags);
      const processed = this.processTransitionTagsInTree(nodes);
      return serializeHTML(processed, customVoidTags);
    } catch (err) {
      logger.warn(new TemplateValidationError(AvenxErrorCodes.COMPILER_TRANSITION_PARSE_FAILED, err).message);
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
   * @param {string} [filePath] - The component file path, used to resolve project-specific
   *   void tags from `avenx.config.json` (see {@link getCustomVoidTags}).
   * @returns {string} The optimized template.
   */
  optimizeStaticSubtrees(template, filePath) {
    try {
      const customVoidTags = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
      const nodes = parseHTML(template, customVoidTags);
      this.markStaticNodes(nodes, false);
      return serializeHTML(nodes, customVoidTags);
    } catch (err) {
      logger.warn(new TemplateValidationError(AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED, err).message);
      return template;
    }
  }

  /**
   * Recursively traverses nodes to find and mark the root of static subtrees.
   * @param {HTMLNode[]} nodes
   * @param {boolean} [parentIsStatic]
   * @param {boolean} [inSlot] - Indicates if the current node is inside a slot or component transclusion boundary.
   */
  markStaticNodes(nodes, parentIsStatic = false, inSlot = false) {
    for (const node of nodes) {
      if (node.type === 'element') {
        const lowerTag = node.tagName.toLowerCase();
        const isSlot = lowerTag === 'slot';
        const isComponent = Boolean(
          node.attrs['data-avenx-comp'] || node.attrs['data-ax-comp'] || /^[A-Z]/.test(node.tagName)
        );
        const currentInSlot = inSlot || isSlot || isComponent;
        const hasStaticContract = node.contracts && node.contracts.has('static');
        const nodeStatic = !currentInSlot && (hasStaticContract || isStaticNode(node));

        // Convert contract block directives to div wrappers with respective data attributes
        if (lowerTag === '@static') {
          node.tagName = 'div';
          node.attrs['data-ax-static'] = 'true';
        } else if (lowerTag === '@isolated') {
          node.tagName = 'div';
          node.attrs['data-ax-isolated'] = 'true';
        } else if (lowerTag === '@pure') {
          node.tagName = 'div';
          node.attrs['data-ax-pure'] = 'true';
        } else if (lowerTag === '@deterministic') {
          node.tagName = 'div';
          node.attrs['data-ax-deterministic'] = 'true';
        }

        // Clean up raw contract attributes from DOM element output
        if (node.attrs) {
          if (node.attrs['static'] !== undefined) delete node.attrs['static'];
          if (node.attrs['pure'] !== undefined) delete node.attrs['pure'];
          if (node.attrs['deterministic'] !== undefined) delete node.attrs['deterministic'];
          if (node.attrs['isolated'] !== undefined) delete node.attrs['isolated'];
        }

        if (node.contracts && node.contracts.has('pure') && node.contracts.has('deterministic') && !nodeStatic) {
          node.attrs['data-ax-memo'] = 'true';
        }

        if (nodeStatic && !parentIsStatic) {
          node.attrs['data-ax-static'] = 'true';
        }
        this.markStaticNodes(node.children, nodeStatic, currentInSlot);
      }
    }
  }
}

/**
 * A lightweight node representation for parsing HTML templates.
 */
class HTMLNode {
  /**
   * Creates an instance of HTMLNode.
   * @param {string} type - The node type.
   * @param {string} [tagName] - The tag name.
   * @param {Object} [attrs] - The attribute map.
   * @param {boolean} [isSelfClosing] - Whether the tag is self-closing.
   */
  constructor(type, tagName = '', attrs = {}, isSelfClosing = false) {
    this.type = type;
    this.tagName = tagName;
    this.attrs = attrs;
    this.isSelfClosing = isSelfClosing;
    this.line = null;
    this.column = null;
    /** @type {HTMLNode[]} */
    this.children = [];
    this.content = '';
    /** @type {Set<string>} */
    this.contracts = new Set();
    this.initContracts();
  }

  /**
   * Initializes contracts attached to this node via tag names or attributes.
   */
  initContracts() {
    const valid = ['static', 'pure', 'deterministic', 'isolated'];
    if (this.tagName && this.tagName.startsWith('@')) {
      const contractTag = this.tagName.slice(1).toLowerCase();
      if (valid.includes(contractTag)) {
        this.contracts.add(contractTag);
      }
    }
    if (this.attrs && typeof this.attrs === 'object') {
      for (const c of valid) {
        if (this.attrs[c] !== undefined && this.attrs[c] !== 'false') {
          this.contracts.add(c);
        }
      }
      if (this.attrs['data-ax-contract']) {
        const list = this.attrs['data-ax-contract'].split(/\s+/).filter(Boolean);
        for (const item of list) {
          const lower = item.toLowerCase();
          if (valid.includes(lower)) {
            this.contracts.add(lower);
          }
        }
      }
    }
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
  const isNameChar = (ch) => /[@\w:.\-[\]]/.test(ch);

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
 * @param {string[]} [customVoidTags] - Additional project-specific void tag
 *   names (lowercase), loaded from `avenx.config.json`. Merged on top of
 *   {@link DEFAULT_VOID_TAGS}. Regardless of this list, any tag that is
 *   written with a self-closing slash (e.g. `<my-video />`) is always
 *   treated as void so it never requires a matching closing tag.
 * @returns {HTMLNode[]}
 */
/**
 * Calculates 1-based line and column numbers for a character offset in a source string.
 * @param {string} source - The original source code string.
 * @param {number} offset - The zero-based character index.
 * @returns {{ line: number, column: number }}
 */
function getLineAndColumn(source, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  const column = offset - lastNewline;
  return { line, column };
}

/**
 * Parses an HTML string into a tree of HTMLNode elements with positional metadata.
 * @param {string} html
 * @param {string[]} [customVoidTags]
 * @returns {HTMLNode[]}
 */
function parseHTML(html, customVoidTags = []) {
  const root = new HTMLNode('element', 'root');
  const stack = [root];
  let i = 0;

  const voidTags = buildVoidTagsSet(customVoidTags);

  while (i < html.length) {
    // 1. Check for comment
    if (html.startsWith('<!--', i)) {
      const pos = getLineAndColumn(html, i);
      const endIdx = html.indexOf('-->', i + 4);
      if (endIdx === -1) {
        const node = new HTMLNode('comment');
        node.content = html.substring(i + 4);
        node.line = pos.line;
        node.column = pos.column;
        stack[stack.length - 1].children.push(node);
        break;
      } else {
        const node = new HTMLNode('comment');
        node.content = html.substring(i + 4, endIdx);
        node.line = pos.line;
        node.column = pos.column;
        stack[stack.length - 1].children.push(node);
        i = endIdx + 3;
        continue;
      }
    }

    // 2. Check for closing tag
    if (html.startsWith('</', i)) {
      const pos = getLineAndColumn(html, i);
      const endIdx = html.indexOf('>', i + 2);
      if (endIdx === -1) {
        const textNode = new HTMLNode('text');
        textNode.content = html.substring(i);
        textNode.line = pos.line;
        textNode.column = pos.column;
        stack[stack.length - 1].children.push(textNode);
        break;
      } else {
        const rawTagName = html.substring(i + 2, endIdx).trim();
        const tagName = rawTagName.replace(/\s+/g, '');
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
        // If foundIdx === -1, silently skip unmatched closing tag
        // to maintain backward compatibility with permissive template transforms
        i = endIdx + 1;
        continue;
      }
    }

    // 3. Check for opening/self-closing tag
    if (html[i] === '<') {
      const pos = getLineAndColumn(html, i);
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

        if (/^[a-zA-Z0-9@:._-]+$/.test(tagName)) {
          const attrs = parseAttributes(attrsStr);
          const isVoid = voidTags.has(tagName.toLowerCase());
          const node = new HTMLNode('element', tagName, attrs, isSelfClosing || isVoid);
          node.line = pos.line;
          node.column = pos.column;

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
    const textPos = getLineAndColumn(html, i);
    let nextTagIdx = html.indexOf('<', i + 1);
    if (nextTagIdx === -1) {
      nextTagIdx = html.length;
    }
    const text = html.substring(i, nextTagIdx);
    if (text) {
      const parentNode = stack[stack.length - 1];
      const parts = text.split(/(\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g);
      for (const part of parts) {
        if (!part) continue;
        const isDynamic = part.includes('{{') || part.includes('{%');
        const lastChild = parentNode.children[parentNode.children.length - 1];
        if (
          lastChild &&
          lastChild.type === 'text' &&
          !isDynamic &&
          !(lastChild.content.includes('{{') || lastChild.content.includes('{%'))
        ) {
          lastChild.content += part;
        } else {
          const textNode = new HTMLNode('text');
          textNode.content = part;
          textNode.line = textPos.line;
          textNode.column = textPos.column;
          parentNode.children.push(textNode);
        }
      }
    }
    i = nextTagIdx;
  }

  return root.children;
}

/**
 * Serializes an HTMLNode tree back to an HTML string.
 * @param {HTMLNode[]} nodes
 * @param {string[]} [customVoidTags] - Additional project-specific void tag
 *   names (lowercase), loaded from `avenx.config.json`. Should match what
 *   was passed to {@link parseHTML} for the same template so a custom void
 *   tag round-trips consistently.
 * @returns {string}
 */
function serializeHTML(nodes, customVoidTags = []) {
  let result = '';
  const voidTags = buildVoidTagsSet(customVoidTags);
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
      if (voidTags.has(node.tagName.toLowerCase()) || node.isSelfClosing) {
        result += `<${node.tagName}${attrsStr} />`;
      } else {
        result += `<${node.tagName}${attrsStr}>${serializeHTML(node.children, customVoidTags)}</${node.tagName}>`;
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
      if (name.startsWith('@') || name.startsWith(':[')) {
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

ComponentParser.parseHTML = parseHTML;

export default ComponentParser;
