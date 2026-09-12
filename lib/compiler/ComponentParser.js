import fs from 'fs';
import path from 'path';
import ExpressionParser, { readDeclarations } from './expressionParser.js';
import { analyzeBridgeFile, findBridgeImports } from './BridgeParser.js';
import ContractValidator from './ContractValidator.js';
import { logger } from '../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { RESERVED_INSTANCE_KEYS } from '../core/runtime/AvenxComponent.js';
import { TemplateValidationError, BuildError } from './errors/index.js';
import { reportWarning } from './utils/warningReporter.js';
import { replaceEnvVariables } from '../env.js';
import { processBindDirectives, escapeTemplateMarkers } from '../core/utils/templateUtils.js';
import loadConfig, { resolvePathAlias, getClosestKey } from '../config.js';
import { collectLocations } from './sourceMapTrace.js';
import { addCachedComponentUnit } from './atlas/cache.js';
import { collectTemplateEvents } from './templateEvents.js';
import { getLineAndColumn, parseAttributes, parseHTML, serializeHTML } from './parser/htmlTree.js';
import { buildTemplateIR } from './ir/build.js';
import { lowerToProgram } from './ir/lower.js';
import { validateComponentExpressions } from './validateExpressions.js';
import { collectImportStatements } from './modules.js';

/**
 * The executable source of each declared resource, keyed by name.
 *
 * A resource is emitted either as a bare handler string or as
 * `{ handler, pollInterval }`, and the runtime prefixes a bare expression with
 * `return`. Both shapes are normalised here so the generator sees exactly the
 * text the runtime will execute -- otherwise a polling resource would compile
 * against a string that is not what runs, and quietly miss.
 * @param {object} resources - The parsed resource declarations.
 * @returns {Object<string, string>} Handler sources by resource name.
 */
function resourceBodies(resources) {
  const bodies = {};
  for (const [name, definition] of Object.entries(resources || {})) {
    const handler = definition && typeof definition === 'object' ? definition.handler : definition;
    if (typeof handler !== 'string' || handler.trim() === '') continue;
    bodies[name] = handler.trim().startsWith('return') ? handler : `return ${handler}`;
  }
  return bodies;
}
import { collectExpressions } from './codegen/collect.js';
import { buildExpressionTable, buildProgramTables } from './codegen/table.js';



/**
 * Framework tags the compiler understands directly. These are never real
 * components, so a reference to one must not be reported as an unresolved
 * component (see {@link ComponentParser#validateComponentTags} / AVX_W46).
 *
 * The `@`-prefixed directives (`@for`, `@if`, `@suspense`, …) are handled
 * separately: any tag beginning with `@` is skipped unconditionally, so it is
 * enough to list the non-prefixed framework tags here.
 * @type {Set<string>}
 */
const BUILTIN_TAGS = new Set([
  'slot',
  'resource',
  'state',
  'action',
  'transition',
  'template',
  'component',
  'script',
  'style',
]);

/**
 * A conservative set of known HTML and SVG element names. Element names are
 * lowercase, so a PascalCase tag can practically never collide with one; this
 * set exists only as a defensive net for an element written with an unusual
 * case. It is deliberately not exhaustive — anything lowercase is treated as an
 * ordinary element regardless of membership (see {@link ComponentParser#validateComponentTags}).
 * @type {Set<string>}
 */
const KNOWN_ELEMENTS = new Set([
  // Common HTML
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo',
  'blockquote', 'body', 'button', 'canvas', 'caption', 'cite', 'code',
  'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog',
  'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup',
  'html', 'i', 'iframe', 'ins', 'kbd', 'label', 'legend', 'li', 'main', 'map',
  'mark', 'menu', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup',
  'option', 'output', 'p', 'picture', 'pre', 'progress', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'section', 'select', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead',
  'time', 'tr', 'u', 'ul', 'var', 'video',
  // SVG
  'svg', 'circle', 'clippath', 'defs', 'ellipse', 'foreignobject', 'g',
  'image', 'line', 'lineargradient', 'marker', 'mask', 'path', 'pattern',
  'polygon', 'polyline', 'radialgradient', 'rect', 'stop', 'symbol', 'text',
  'tspan', 'use',
]);

/**
 * The local names a component's own imports bind, excluding bridges and the
 * runtime entry.
 *
 * A bridge already reaches the template through the bridges argument, and the
 * runtime import binds the base class the generated module extends. Everything
 * else -- an npm package, a local helper -- is a value the developer expects to
 * be able to name, so it becomes part of the component's evaluation scope.
 * @param {string} source - The component source.
 * @param {string[]} bridgeLocals - Local names already bound as bridges.
 * @returns {string[]} Local binding names, in source order.
 */
function collectImportBindings(source, bridgeLocals) {
  const bridges = new Set(bridgeLocals);
  const names = [];

  for (const statement of collectImportStatements(source)) {
    const match = statement.match(/^import\s+([\s\S]*?)\s+from\s*['"]([^'"]*)['"]/);
    if (!match) continue;
    if (/^(avenx-core(\/(runtime|core))?)$/.test(match[2])) continue;

    const clause = match[1].trim();
    const braceStart = clause.indexOf('{');
    const head = (braceStart === -1 ? clause : clause.slice(0, braceStart)).replace(/,\s*$/, '').trim();

    const star = head.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (star) {
      if (star[1]) names.push(star[1]);
      names.push(star[2]);
    } else if (/^[A-Za-z_$][\w$]*$/.test(head)) {
      names.push(head);
    }

    if (braceStart !== -1) {
      const close = clause.indexOf('}', braceStart);
      const inner = close === -1 ? clause.slice(braceStart + 1) : clause.slice(braceStart + 1, close);
      for (const part of inner.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const aliased = trimmed.split(/\s+as\s+/);
        const local = (aliased[1] || aliased[0]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
      }
    }
  }

  return names.filter((name) => !bridges.has(name) && !names.includes(name, names.indexOf(name) + 1));
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
 * Builds the atomic descriptor the generated constructor carries.
 *
 * Only the runtime-relevant half of a modifier reaches the bundle. The write
 * set, the boundedness flag and the irreversible-effect list are compile-time
 * findings: they exist to be reported before the application ships, and the
 * journal does not need them because it observes the reactive proxies rather
 * than a prediction of what they will do.
 *
 * A modifier naming an action the component does not declare is dropped. The
 * generated code would otherwise reference a method that is not there, and a
 * typo in `name=` is already reported by the action itself being missing.
 * @param {Object<string, {atomic: boolean, onConflict: string=}>} modifiers - Parsed modifiers.
 * @param {Object<string, string>} methods - The component's action bodies.
 * @returns {Object<string, object>|null} The descriptor, or null when there is nothing to emit.
 */
function buildAtomicSpec(modifiers, methods) {
  if (!modifiers) return null;
  /** @type {Object<string, object>} */
  const spec = {};
  let found = false;
  for (const name of Object.keys(modifiers).sort()) {
    if (!Object.prototype.hasOwnProperty.call(methods || {}, name)) continue;
    const modifier = modifiers[name];
    if (!modifier || !modifier.atomic) continue;
    spec[name] = modifier.onConflict ? { onConflict: modifier.onConflict } : {};
    found = true;
  }
  return found ? spec : null;
}

/**
 * ComponentParser handles the parsing of Avenx component files (.js and .css).
 * It extracts component state, computed properties, methods, and templates,
 * and coordinates with the StyleProcessor to handle styles.
 */
class ComponentParser {
  /**
   * Compiles this component's template to a render program.
   *
   * Runs on {@link ComponentParser#lastSemanticTemplate} -- the template after
   * styles and two-way bindings and before any directive rewrite -- so the IR
   * reads `<@for>` and `<@if>` as the constructs they are rather than as the
   * markup they used to be turned into.
   *
   * Either half may refuse. The IR refuses a construct it does not model yet;
   * the lowering refuses an IR node it cannot emit. Either way the component
   * keeps the string renderer and the reason is recorded for the build to
   * report, which is the same compile-or-refuse rule that has always applied.
   * @param {string} name - The component class name.
   * @param {string} filePath - The component's path, for diagnostics.
   * @param {string[]} voidTags - The effective void tag set.
   * @returns {{program: object|null, expressions: string[], statements: string[]}}
   *   The program and the sources its indices address.
   */
  compileRenderProgram(name, filePath, voidTags) {
    const source = this.lastSemanticTemplate;
    if (typeof source !== 'string' || source.trim() === '') {
      return { program: null, expressions: [], statements: [] };
    }

    // Static marking runs on the semantic template rather than on the rewritten
    // one, because the IR is built from the semantic template and a mark
    // applied after it would never be seen.
    const marked = this.optimizeStaticSubtrees(source, filePath);

    const built = buildTemplateIR(marked, { voidTags });
    if (built.refusal) {
      this.renderFallbacks.push({ name, reason: built.refusal.reason, detail: built.refusal.detail });
      return { program: null, expressions: [], statements: [] };
    }

    const lowered = lowerToProgram(built.ir, { voidTags });
    if (lowered.refusal) {
      this.renderFallbacks.push({ name, reason: lowered.refusal.reason, detail: lowered.refusal.detail });
      return { program: null, expressions: [], statements: [] };
    }

    return { program: lowered.program, expressions: lowered.expressions, statements: lowered.statements };
  }


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

    /**
     * Source locations of every declaration parsed so far, keyed by class name.
     *
     * Collected as a by-product of parsing and written beside the bundle rather
     * than into it, so `avenx trace view` can turn a recorded action name into
     * a file and a line without an application paying for the mapping.
     * @type {Map<string, object>}
     */
    this.locations = new Map();

    /**
     * The Atlas model being populated, or null when Atlas is not being built.
     *
     * Set by AvenxCompiler. When it is null, `parse` does no Atlas work at
     * all, so a caller that only wants a compiled class — the Vite plugin, a
     * unit test, `loadComponent` — pays nothing for it.
     * @type {AppModel|null}
     */
    this.model = null;

    /**
     * The units handed to Atlas so far, so render edges can be resolved once
     * every component name is known.
     * @type {Array<{name: string, filePath: string, content: string, kind: string}>}
     */
    this.__atlasUnits = [];

    /**
     * Every registered component and page name in the project, supplied by the
     * compiler through {@link ComponentParser#setComponentNames} before any
     * file is parsed. Used by the unresolved-component check (AVX_W46). Empty
     * when a component is parsed standalone, which disables that check.
     * @type {Set<string>}
     */
    this.__componentNames = new Set();

    /**
     * Components whose template could not be compiled to a render program, and
     * why.
     *
     * A component without a program renders through the string path: correct,
     * and proportional to the whole template on every update. That is a real
     * cost, so it is reported rather than absorbed silently -- the same house
     * rule Atlas follows when its analysis is incomplete.
     * @type {Array<{name: string, reason: string, detail: string}>}
     */
    /**
     * Per-unit information the module generator needs, keyed by absolute
     * source path. Filled by {@link ComponentParser#parse}.
     * @type {Map<string, object>}
     */
    this.moduleMeta = new Map();
    this.renderFallbacks = [];

    /**
     * Component tag names referenced by any template in this build.
     *
     * Populated as templates compile, so by the time the entry module is built
     * the answer is exact rather than a guess from the source text.
     * @type {Set<string>}
     */
    this.referencedComponents = new Set();
    /**
     * What the expression generator could not compile, per unit.
     *
     * A security refusal fails the build; a language gap is reported as a
     * warning and leaves that one expression on the runtime path. Recorded
     * here rather than thrown at the point of generation so a build reports
     * every unit's problems at once instead of the first one's.
     * @type {Array<{name: string, refusals: object[], gaps: object[]}>}
     */
    this.expressionGaps = [];

    /**
     * The project root, when the compiler has told the parser what it is.
     *
     * `findProjectRoot` walks up from a component looking for a project
     * marker, which lands somewhere arbitrary in a directory that has none —
     * a scratch project in a temp directory, for instance — and every reported
     * path is then relative to the wrong place. The compiler resolved the root
     * once and authoritatively, so it is preferred when available.
     * @type {string|null}
     */
    this.rootDir = null;
  }

  /**
   * Tells the parser which directory reported paths are relative to.
   * @param {string} rootDir - The project root.
   * @returns {void}
   */
  setRootDir(rootDir) {
    this.rootDir = rootDir || null;
  }

  /**
   * Attaches an Atlas model for `parse` to populate.
   * @param {AppModel|null} model - The model.
   * @returns {void}
   */
  setModel(model) {
    this.model = model || null;
    this.__atlasUnits = [];
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
   * Supplies the full set of registered component and page names, so a template
   * tag can be validated against every name in the project rather than only the
   * ones parsed so far.
   *
   * The compiler discovers all names by filename before it parses any file, and
   * hands them over here. When it is never called — a component parsed
   * standalone in a test or the Vite plugin — the set stays empty and the
   * unresolved-component check does nothing, so a lone component is never
   * flagged for referencing a sibling the parser could not see.
   * @param {Iterable<string>} names - Registered component and page names.
   * @returns {void}
   */
  setComponentNames(names) {
    this.__componentNames = names ? new Set(names) : new Set();
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
    const rootDir = this.rootDir || (filePath ? loadConfig.findProjectRoot(path.dirname(filePath)) : process.cwd());
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
    // Everything else the file imports. Bridges are excluded because they reach
    // the template through the bridges argument already, and the runtime entry
    // is excluded because those names are the base class the module extends.
    const importedLocals = collectImportBindings(content, bridgeBindings.map((entry) => entry.local));
    const state = this.extractState(content, filePath, config);
    const computed = this.extractComputed(content);
    const methods = this.extractMethods(content, name, filePath, config);
    const actionModifiers = this.extractActionModifiers(content);
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
      [...bridgeBindings.map((entry) => entry.local), ...importedLocals],
    );

    // Handle declarative tags: <MyComponent /> or <MyComponent>...</MyComponent> -> <div data-avenx-comp="MyComponent">...</div>
    // Only if it looks like a component (starts with uppercase)
    template = this.processComponentTags(template);

    // Which components this build actually references. The compiler uses it to
    // decide whether a built-in's registering module joins the graph, so an
    // application that never writes `<VirtualList>` does not carry it.
    for (const match of template.matchAll(/data-avenx-comp="([A-Za-z0-9_]+)"/g)) {
      this.referencedComponents.add(match[1]);
    }

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

    this.locations.set(name, collectLocations({
      name,
      filePath,
      rootDir,
      content,
      computed,
      methods,
      resources,
      contracts,
    }));

    // Atlas is retention, not a second pass: everything it needs was produced
    // above on the way to generating this class, and is handed over rather
    // than recomputed. The original `content` goes with it because the
    // template below has already been rewritten past the point where its
    // offsets point at anything a developer can open.
    if (this.model) {
      const atlasUnit = addCachedComponentUnit(this.model, {
        name,
        kind: isPage ? 'page' : 'component',
        filePath,
        rootDir,
        content,
        state,
        computed,
        methods,
        resources,
        contracts,
        actionModifiers,
        bridgeBindings,
        bridges: this.bridges,
      });
      this.__atlasUnits.push({
        name,
        filePath,
        content,
        kind: isPage ? 'page' : 'component',
        // The mask is the expensive half of reading a template; the render
        // pass reuses the one the relationship pass already built.
        masked: atlasUnit.masked,
        starts: atlasUnit.starts,
      });
    }

    // Template expressions are evaluated by Avenx's expression evaluator, which
    // refuses anything outside the expression language. Checking here means an
    // unsupported expression fails the build with a file and a line, rather
    // than becoming an AVX_R32 the first time that component renders.
    const expressionErrors = validateComponentExpressions({
      name,
      filePath,
      content,
      template,
      computed,
    });
    if (expressionErrors.length > 0) {
      throw expressionErrors[0];
    }

    // Identify and mark static subtrees for patcher performance optimization
    template = this.optimizeStaticSubtrees(template, filePath);

    // The render program is compiled from the *semantic* template -- the one
    // the author wrote, before any directive was rewritten into markup. That
    // ordering is the point of the IR: `<@for item in items>` still says what
    // it means at that stage, and after the rewrites above it does not.
    const customVoidTagsForProgram = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
    const rendered = this.compileRenderProgram(name, filePath, customVoidTagsForProgram);

    // Templates and method bodies are emitted as JSON string literals rather
    // than backtick-wrapped template literals: a `${...}` sequence in component
    // HTML (or a legitimate template literal inside an <action> body) would
    // otherwise be interpolated by the generated bundle instead of being
    // preserved verbatim.
    let optionImports = '';
    // A compiled component does not render from the template, so a production
    // build does not carry it. That is the larger half of what the previous
    // design shipped twice: the whole template travelled beside the program,
    // with its `{{ }}` and its JSON-encoded handlers still in it, for a runtime
    // that never looked at it.
    //
    // Development keeps it. `__getTemplate()` is the seam renderer benchmarks
    // and the render-path parity test use to drive the same class through both
    // renderers, and a suspense or error-boundary fallback is still read out of
    // the template by regex -- neither of which a compiled component can have,
    // because both refuse to compile, but both of which a *fallback* component
    // in the same build still needs.
    const shipTemplate = !rendered.program || !this.production;
    const templateLiteral = JSON.stringify(shipTemplate ? template : '');

    // The options argument stays absent unless something needs it, so a
    // component that declares neither contracts nor atomic actions compiles to
    // exactly the same constructor call it did before either feature existed.
    if (importedLocals.length > 0) {
      // Emitted as shorthand properties, so the object references the module's
      // own bindings and the bundler sees them used.
      optionImports = `imports: { ${importedLocals.join(', ')} }`;
    }

    const contractsList = Array.from(contracts || []);
    const atomicSpec = buildAtomicSpec(actionModifiers, methods);
    const optionParts = [];
    if (optionImports) {
      optionParts.push(optionImports);
    }
    if (contractsList.length > 0) {
      optionParts.push(`contracts: ${JSON.stringify(contractsList)}`);
    }
    if (atomicSpec) {
      optionParts.push(`atomic: ${JSON.stringify(atomicSpec)}`);
    }
    // The program travels in the options object rather than as another
    // positional argument. The constructor already takes nine, and the options
    // argument is the extension point that exists precisely so it does not have
    // to take ten. A component compiled before render programs existed simply
    // has no `program` key and takes the string path.
    //
    // It is referenced as a static rather than written inline, because the
    // runtime caches one parsed skeleton per program *object*. An object
    // literal inside the constructor is a fresh object on every `new`, so the
    // cache would never hit and every instance would reparse the template --
    // which is most of the cost this whole mechanism exists to remove.
    let programStatic = '';
    if (rendered.program) {
      // The expression and statement closures the program's indices address.
      // Built here rather than in the source-keyed table below because an
      // indexed entry that will not compile leaves nothing behind for the
      // runtime to fall back to, so the whole program has to be withdrawn.
      const programTables = buildProgramTables(name, rendered.expressions, rendered.statements);
      if (programTables.failure) {
        this.renderFallbacks.push({
          name,
          reason: 'an expression the code generator could not compile',
          detail: `${programTables.failure.source} (${programTables.failure.reason})`,
        });
        rendered.program = null;
      } else {
        optionParts.push(`program: ${name}.__axProgram`);
        // The handler sources, for Trace only, and only in a development
        // build. A causal tree reads better with "@click=\"inc()\"" on the
        // event node than with "handler #2", and Trace is a development
        // feature -- the recorder is not reachable from a production bundle at
        // all. Gating it here is what keeps the source out of shipped output
        // while leaving the tool that wants it fully served.
        let debugStatic = '';
        if (!this.production && rendered.statements.length > 0) {
          debugStatic = `${name}.__axProgramStmtSrc = ${JSON.stringify(rendered.statements)};\n`;
        }
        programStatic = `\n${name}.__axProgram = ${JSON.stringify(rendered.program)};\n${programTables.source}${debugStatic}`;
      }
    }

    // Every expression this unit will evaluate, compiled to a closure the
    // engine itself will parse. The table is attached as a static beside the
    // program so the runtime can find it from the class, and so it is created
    // once per class rather than once per instance.
    const collected = collectExpressions({
      template,
      computed,
      program: rendered.program,
      voidTags: customVoidTagsForProgram,
    });
    // Actions and resources are addressed by name at run time, so they are
    // compiled into their own tables rather than into the source-keyed one.
    collected.actions = methods;
    collected.resources = resourceBodies(resources);
    const table = buildExpressionTable(name, collected);
    if (table.refusals.length > 0 || table.gaps.length > 0) {
      this.expressionGaps.push({ name, refusals: table.refusals, gaps: table.gaps });
    }
    const expressionStatic = table.source;

    // An action whose body compiled is reached through `__axActions`, keyed by
    // name, so the body text is no longer needed to *run* it. It is still
    // emitted in a development build because Trace records it and
    // `avenx trace view` prints it; a production bundle cannot start a
    // recording, so carrying the text there is weight nothing can read. The
    // name still has to be emitted -- it is what tells the runtime the action
    // exists.
    const keepBodies = !this.production;
    const methodStrings = Object.entries(methods)
      .map(([key, body]) => {
        const drop = !keepBodies && table.compiledActions && table.compiledActions.has(key);
        return `${JSON.stringify(key)}: ${JSON.stringify(drop ? '' : body)}`;
      })
      .join(',\n        ');
    const contractsParam = optionParts.length > 0 ? `, { ${optionParts.join(', ')} }` : '';

    // What the compiler needs in order to frame this class as an ES module: the
    // class name, the import statements the developer wrote, and the bridge
    // bindings the class body refers to. Recorded on the parser rather than
    // returned, so `parse()` keeps the bare-class output shape that
    // avenx-core/testing, the Vite plugin and the render-path tests consume.
    this.moduleMeta.set(path.resolve(filePath), {
      importedLocals,
      className: name,
      isPage,
      imports: collectImportStatements(content),
      bridgeBindings,
    });

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
}
${programStatic}${expressionStatic}`;
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
}
${programStatic}${expressionStatic}`;
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
   * Extracts Avenx Rewind modifiers declared on the component's `<action>` tags.
   * @param {string} content - The content of the .component.js file.
   * @returns {Object<string, {atomic: boolean, onConflict: string=}>} Modifiers by action name.
   * @private
   */
  extractActionModifiers(content) {
    return this.expressionParser.parseActionModifiers(content);
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
    // Declarations are removed by the exact source ranges the scanner
    // reported, not by re-matching them with a second pattern. The old code
    // read a declaration with one regex and stripped it with another, and the
    // two disagreed about multi-line tags: `/<state.*? \/>/` cannot match
    // across a newline, so a JSDoc-annotated `<state>` survived into the
    // template and was rendered as a literal element. One scan now decides
    // both, so the reader and the remover cannot drift apart again.
    let template = readDeclarations(content).template;

    // ES imports are declarations, not markup. They resolve child components
    // and bridges at compile time and must not survive into the template,
    // where they would render as a stray text node.
    template = template
      .replace(/^[ \t]*import\s+(?:[\s\w$,{}*]*?\s+from\s+)?['"][^'"]*['"];?[ \t]*\r?\n?/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '')
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

    // The template as the author wrote it, with styles resolved and two-way
    // bindings expanded but no directive rewritten. This is what the IR is
    // built from: `<@for item in items>` still says what it means here, and
    // one line further down it will not.
    //
    // Recorded on the parser rather than returned, because `extractTemplate`
    // has nine parameters already and every caller of it wants the rewritten
    // string. The one caller that wants both reads this immediately after.
    this.lastSemanticTemplate = template;

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
      // Names a plugin puts into every component's scope through app.mixin().
      // The compiler cannot see a runtime installation, so the project declares
      // them once in avenx.config.json — `@avenx/i18n`, for instance, publishes
      // t, tHtml, n, d, rel, locale and $i18n.
      ...((config && config.templateGlobals) || []),
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

    const events = collectTemplateEvents(template);

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

    this.validateComponentTags(template, filePath, name, config);
  }

  /**
   * Reports PascalCase template tags that resolve to no registered component,
   * built-in tag, or known HTML/SVG element (AVX_W46).
   *
   * A misspelled or unimported component name is the most common template
   * mistake and, unlike an undeclared identifier, it currently escapes every
   * compile-time check — it surfaces only at runtime as AVX_R03 (or AVX_W13
   * inside a page). This walks the parsed node tree the other passes use, so no
   * new parse is added, and reports each unresolved tag with the file, the
   * line, the tag and the closest registered name when one is near enough.
   *
   * It is a warning, not an error: a component may legitimately be registered
   * at runtime through `app.register()`, which the compiler cannot see. The
   * check is skipped entirely when the registry is empty (a component parsed
   * standalone), so it never fires on a project the compiler did not scan whole.
   * @param {string} template - The processed template HTML.
   * @param {string} filePath - Absolute path of the file being compiled.
   * @param {string} name - The component/page name, for the diagnostic.
   * @param {object|null} config - Resolved project configuration.
   * @returns {void}
   * @private
   */
  validateComponentTags(template, filePath, name, config) {
    if (!this.__componentNames || this.__componentNames.size === 0) {
      return;
    }
    if (!template || template.trim() === '') {
      return;
    }

    const filename = filePath ? path.basename(filePath) : (name || 'template');

    // The project's void tags share the identifier check's escape hatch: a tag
    // the project has declared as its own element is never reported as an
    // unresolved component, whatever its casing.
    const customVoidTags = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
    const voidTagSet = new Set(customVoidTags.map((t) => String(t).toLowerCase()));

    let nodes;
    try {
      nodes = parseHTML(template, customVoidTags);
    } catch {
      // A template that will not even parse is a different problem, reported by
      // the passes that transform it. This check simply steps aside.
      return;
    }

    const isPascalCase = (tag) => /^[A-Z][A-Za-z0-9]*$/.test(tag);

    const walk = (list) => {
      for (const node of list) {
        if (node && node.type === 'element' && typeof node.tagName === 'string') {
          const tag = node.tagName;

          // A dash marks a Web Component custom element; the framework never
          // owns it, so it is never flagged (matches the identifier check's
          // escape hatch).
          const isCustomElement = tag.includes('-');
          // `<Component is="...">` is the dynamic-component built-in.
          const isDynamic = tag === 'Component';

          if (
            isPascalCase(tag) &&
            !isCustomElement &&
            !isDynamic &&
            !tag.startsWith('@') &&
            !BUILTIN_TAGS.has(tag.toLowerCase()) &&
            !KNOWN_ELEMENTS.has(tag.toLowerCase()) &&
            !voidTagSet.has(tag.toLowerCase()) &&
            !this.__componentNames.has(tag)
          ) {
            const suggestion = getClosestKey(tag, [...this.__componentNames]);
            const hint = suggestion ? `\n\nDid you mean "<${suggestion}>"?` : '';
            const err = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_UNRESOLVED_COMPONENT_REFERENCE,
              tag,
              filename,
              hint,
            );
            if (node.line) {
              err.setLocation({
                source: template,
                line: node.line,
                column: node.column || 1,
                filename,
                length: tag.length,
              });
            }
            reportWarning(
              AvenxErrorCodes.COMPILER_UNRESOLVED_COMPONENT_REFERENCE,
              err,
              config,
            );
          }
        }

        if (node && Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children);
        }
      }
    };

    walk(nodes);
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
      const escapedBody = escapeTemplateMarkers(body);
      let attrs = `data-ax-for="${innerPair.start.list.trim()}" data-ax-as="${innerPair.start.item.trim()}"`;
      if (innerPair.start.key) {
        attrs += ` data-ax-key="${innerPair.start.key.trim()}"`;
      }

      let replacement = `<template ${attrs}>${escapedBody}</template>`;
      if (innerEmpty) {
        const escapedEmptyBody = escapeTemplateMarkers(emptyBody);
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
        fallbackContent = escapeTemplateMarkers(fallbackMatch[1]); // Escape fallback template logic
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
        fallbackContent = escapeTemplateMarkers(fallbackMatch[2]); // Escape fallback logic
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
        fallbackContent = escapeTemplateMarkers(fallbackMatch[2]);
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
        placeholderContent = escapeTemplateMarkers(placeholderMatch[1]).trim();
        deferredContent = deferredContent.replace(placeholderMatch[0], '');
      }

      const loadingMatch = inner.match(/<@loading>([\s\S]*?)<\/ ?@loading>/i);
      if (loadingMatch) {
        loadingContent = escapeTemplateMarkers(loadingMatch[1]).trim();
        deferredContent = deferredContent.replace(loadingMatch[0], '');
      }

      deferredContent = escapeTemplateMarkers(deferredContent).trim();

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

    // A directive is control flow, and control flow is never static however
    // little its body interpolates. `<@defer>` with literal content reads as
    // static to every other test here -- no `{{ }}`, no component tag, no
    // bound attribute -- and marking it so told the render compiler to emit
    // the subtree verbatim, which would have rendered the deferred content
    // immediately and dropped the trigger.
    if (lowerTag.startsWith('@')) {
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
