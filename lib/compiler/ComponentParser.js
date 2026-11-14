import fs from 'fs';
import path from 'path';
import ExpressionParser, { readDeclarations } from './expressionParser.js';
import { analyzeBridgeFile, findBridgeImports } from './BridgeParser.js';
import ContractValidator from './ContractValidator.js';
import { logger, consoleTransport } from '../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { RESERVED_INSTANCE_METHOD_KEYS } from '../core/runtime/AvenxComponent.js';
import { TemplateValidationError, BuildError } from './errors/index.js';
import { reportWarning } from './utils/warningReporter.js';
import { replaceEnvVariables } from '../env.js';
import { tokenizeMarkup, applyEdits } from '../core/utils/markupLexer.js';
import loadConfig, { resolvePathAlias } from '../config.js';
import { collectLocations } from './sourceMapTrace.js';
import { loadAvenxConfig, getCustomVoidTags } from './parser/projectConfig.js';
import { optimizeStaticSubtrees, markStaticNodes } from './parser/staticSubtrees.js';
import * as validate from './parser/validate.js';
import { EXCLUDED_IDENTIFIERS, extractRootIdentifiers } from './parser/identifiers.js';
import * as directives from './parser/directives/index.js';
import { addCachedComponentUnit } from './atlas/cache.js';
import { createEnvironmentFingerprint, createUnitKey, getCachedUnit, setCachedUnit } from './incrementalCache.js';
import { collectTemplateEvents } from './templateEvents.js';
import { parseHTML } from './parser/htmlTree.js';
import { buildTemplateIR } from './ir/build.js';
import { lowerToProgram } from './ir/lower.js';
import { validateComponentExpressions } from './validateExpressions.js';
import { collectImportStatements } from './modules.js';
import { extractTemplateLocations } from './templateLocations.js';

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
 * The component class name a file compiles to: `user-profile.component.js`
 * becomes `UserProfile`.
 * @param {string} filePath - The component or page path.
 * @returns {string} The class name.
 */
function classNameFromPath(filePath) {
  return path
    .basename(filePath)
    .replace(/\.(component|page)?\.(js|html|avx)$/i, '')
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Removes HTML comments from a template by lexer span.
 *
 * Only real comments are removed. `title="<!-- x -->"` is an attribute value,
 * and an unterminated `<!--` is left for {@link ComponentParser#assertWellFormedTemplate}
 * to report rather than silently deleting the rest of the template.
 * @param {string} template - The template.
 * @returns {string} The template without comments.
 */
function stripTemplateComments(template) {
  if (typeof template !== 'string' || !template.includes('<!--')) return template;
  const edits = tokenizeMarkup(template)
    .filter((token) => token.type === 'comment' && !token.unterminated)
    .map((token) => ({ start: token.start, end: token.end, text: '' }));
  return applyEdits(template, edits);
}

const NESTING_AT_RULES = new Set(['@media', '@supports', '@container', '@document']);

/**
 * The at-rule token at the start of a selector, or '' when it is a block name.
 * @param {string} selector - Text before a `{`.
 * @returns {string} Lowercase `@media`-style name.
 */
function atRuleName(selector) {
  const match = String(selector).match(/^@[A-Za-z-]+/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Index of the first `;` that is not inside a string, or -1.
 * @param {string} text - A possible at-rule statement.
 * @returns {number} The semicolon index.
 */
function statementSemicolon(text) {
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ';') return index;
  }
  return -1;
}

/**
 * Splits `@import "x"; box` into the statement and the real block name.
 * A prelude such as `@media (max-width: 600px)` has no semicolon, so it stays whole.
 * @param {string} namePart - Text between the previous block and `{`.
 * @returns {{statements: string[], name: string}} Peeled statements and the block name.
 */
function peelBracelessAtRules(namePart) {
  const statements = [];
  let rest = namePart.trim();
  while (rest.startsWith('@')) {
    const end = statementSemicolon(rest);
    if (end === -1) break;
    const after = rest.slice(end + 1).trim();
    if (!after) break;
    statements.push(rest.slice(0, end + 1).trim());
    rest = after;
  }
  return { statements, name: rest };
}

/**
 * Joins two CSS bodies and inserts `;` when the first declaration would touch the next rule.
 * @param {string} previous - The body already stored for this block.
 * @param {string} next - The body to append.
 * @returns {string} The combined body.
 */
function joinCssBodies(previous, next) {
  const trimmed = previous.trimEnd();
  const needsSemicolon = trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('}');
  const head = needsSemicolon ? `${trimmed};` : previous;
  return `${head}\n${next}`;
}


/**
 * Nests `body` inside each prelude, innermost last.
 * @param {string} body - CSS to wrap.
 * @param {string[]} preludes - At-rule headers, outer first.
 * @returns {string} The wrapped CSS.
 */
function wrapWithAtRules(body, preludes) {
  let wrapped = body.trim();
  for (let index = preludes.length - 1; index >= 0; index--) {
    wrapped = `${preludes[index]} {\n${wrapped}\n}`;
  }
  return wrapped;
}

/**
 * Splits a `<@css>` body into `{ name, body, lineOffset }` blocks.
 *
 * The name is whatever sits before `{`. A top-level `@media` therefore arrives
 * here with that whole prelude as its name; the caller decides it is an
 * at-rule rather than a style block.
 * @param {string} inner - Stylesheet text inside `<@css>`.
 * @returns {{name: string, body: string, lineOffset: number}[]} The blocks.
 */
function scanCssBlocks(inner) {
  const blocks = [];
  let depth = 0;
  let currentName = '';
  let currentBody = '';
  let inBlock = false;
  let inString = null;
  let inComment = false;
  let blockStartLineOffset = 0;
  let currentLineOffset = 0;
  let lastTopLevelEnd = 0;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '\n') {
      currentLineOffset++;
    }

    if (inComment) {
      if (char === '*' && inner[i + 1] === '/') {
        inComment = false;
        i++;
      }
      continue;
    }

    if (char === '/' && inner[i + 1] === '*') {
      inComment = true;
      i++;
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
    } else if (char === '"' || char === "'") {
      inString = char;
      if (inBlock) currentBody += char;
    } else if (char === '{' && depth === 0) {
      const namePart = inner
        .slice(lastTopLevelEnd, i)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      const peeled = peelBracelessAtRules(namePart);
      for (const statement of peeled.statements) {
        blocks.push({ name: statement, body: '', braceless: true, lineOffset: currentLineOffset });
      }
      currentName = peeled.name;
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
          blocks.push({ name: currentName, body: currentBody.trim(), lineOffset: blockStartLineOffset });
        }
        currentBody = '';
        currentName = '';
        inBlock = false;
        lastTopLevelEnd = i + 1;
      } else {
        currentBody += char;
      }
    } else if (inBlock) {
      currentBody += char;
    }
  }

  const tail = inner
    .slice(lastTopLevelEnd)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (tail.startsWith('@')) {
    const tailLine = inner.slice(0, lastTopLevelEnd).split('\n').length - 1;
    blocks.push({ name: tail, body: '', braceless: true, lineOffset: tailLine });
  }

  return blocks;
}

/**
 * Stores named blocks and keeps at-rules out of the block map.
 *
 * A nesting at-rule (`@media`, `@supports`, `@container`, `@document`) is
 * folded into the named blocks in its body, which is how a nested at-rule
 * already reaches `StyleProcessor`. Anything else that starts with `@`
 * (`@keyframes`, `@font-face`, `@layer`) is emitted as global CSS, unscoped.
 * A braceless statement such as `@import` is copied on its own line.
 * @param {object} styleProcessor - The stylesheet builder.
 * @param {Array<{name: string, body: string, lineOffset: number}>} blocks - Blocks from {@link scanCssBlocks}.
 * @param {object} desBlocks - Named style blocks for the component.
 * @param {string} desPath - Stylesheet path.
 * @param {number} baseLine - Line where `blocks` begin.
 * @param {string} rawGlobalCss - `<@global>` text a preprocessor may need.
 * @param {string[]} preludes - At-rule headers already wrapped around `blocks`.
 * @returns {void}
 */
function absorbCssBlocks(styleProcessor, blocks, desBlocks, desPath, baseLine, rawGlobalCss, preludes) {
  for (const block of blocks) {
    if (block.braceless) {
      const rule = preludes.length > 0 ? wrapWithAtRules(block.name, preludes) : block.name;
      styleProcessor.addGlobalCSS(rule, desPath, baseLine + block.lineOffset);
      continue;
    }

    const head = atRuleName(block.name);
    if (head && NESTING_AT_RULES.has(head)) {
      const inner = scanCssBlocks(block.body);
      const next = preludes.concat(block.name);
      if (inner.length === 0) {
        styleProcessor.addGlobalCSS(wrapWithAtRules(block.body, next), desPath, baseLine + block.lineOffset);
      } else {
        absorbCssBlocks(styleProcessor, inner, desBlocks, desPath, baseLine + block.lineOffset, rawGlobalCss, next);
      }
      continue;
    }

    if (head) {
      const rule = wrapWithAtRules(`${block.name} {\n${block.body}\n}`, preludes);
      styleProcessor.addGlobalCSS(rule, desPath, baseLine + block.lineOffset);
      continue;
    }

    let finalBody = block.body;
    if (styleProcessor.options && styleProcessor.options.preprocessor) {
      finalBody = styleProcessor.preprocessBlock(rawGlobalCss, finalBody, styleProcessor.options.preprocessor);
    }
    if (preludes.length > 0) {
      finalBody = wrapWithAtRules(finalBody, preludes);
    }

    if (desBlocks[block.name]) {
      desBlocks[block.name] = joinCssBodies(desBlocks[block.name], finalBody);
      continue;
    }

    desBlocks[block.name] = finalBody;
    if (!desBlocks._sourceMapInfo) {
      Object.defineProperty(desBlocks, '_sourceMapInfo', {
        value: {},
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    desBlocks._sourceMapInfo[block.name] = {
      startLine: baseLine + block.lineOffset,
      sourceFile: desPath,
    };
  }
}

/**
 * ComponentParser handles the parsing of Avenx component files (.js and .css).
 * It extracts component state, computed properties, methods, and templates,
 * and coordinates with the StyleProcessor to handle styles.
 */
class ComponentParser {
  /**
   * Fails the build when a refused template uses a compiled-only construct.
   *
   * Falling back is safe for a construct both renderers implement: the template
   * renders, more slowly, and the build says so. `<@if>` is not such a
   * construct. It only ever existed on the compiled path, so the string
   * renderer has no rewrite for it -- a refused template containing one would
   * render `<@if cond>` into the document as a literal element, wrapping the
   * branch it was supposed to choose between.
   *
   * That is exactly the silent miscompile the compile-or-refuse rule exists to
   * prevent, so it is an error with a location rather than a warning. The fix
   * is always the same: get the template compiling, by moving the construct
   * that refused into a child component.
   * @param {string} name - The component class name.
   * @param {string} filePath - The component's path.
   * @param {string} template - The semantic template.
   * @param {{reason: string, detail: string}} refusal - Why it refused.
   * @throws {TemplateValidationError} When the template cannot fall back safely.
   */
  assertNoCompiledOnlyConstruct(name, filePath, template, refusal) {
    const match = template.match(/<@(if|elseif|elif|else)\b/i);
    if (!match) return;

    const error = new TemplateValidationError(
      AvenxErrorCodes.COMPILER_COMPILED_ONLY_CONSTRUCT,
      name,
      match[1],
      `${refusal.reason} (${refusal.detail})`,
    );
    error.setLocation({ source: template, index: match.index, filePath });
    throw error;
  }

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
   * @param {object|null} [exprLocations] - Template source location mappings.
   * @returns {{program: object|null, expressions: string[], statements: string[]}}
   *   The program and the sources its indices address.
   */
  compileRenderProgram(name, filePath, voidTags, exprLocations = null) {
    const source = this.lastSemanticTemplate;
    if (typeof source !== 'string' || source.trim() === '') {
      return { program: null, expressions: [], statements: [] };
    }

    // Static marking runs on the semantic template rather than on the rewritten
    // one, because the IR is built from the semantic template and a mark
    // applied after it would never be seen.
    const marked = this.optimizeStaticSubtrees(source, filePath);

    const built = buildTemplateIR(marked, { voidTags, exprLocations });
    if (built.refusal) {
      this.assertNoCompiledOnlyConstruct(name, filePath, source, built.refusal);
      this.renderFallbacks.push({ name, reason: built.refusal.reason, detail: built.refusal.detail });
      return { program: null, expressions: [], statements: [] };
    }

    const lowered = lowerToProgram(built.ir, { voidTags, production: this.production === true });
    if (lowered.refusal) {
      this.assertNoCompiledOnlyConstruct(name, filePath, source, lowered.refusal);
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
     * The compilation-cache session fingerprint, or null when this parser must
     * compile every unit from scratch.
     *
     * Null is the default and the only value `avenx build` ever sees: the cache
     * is opt-in, and a production artifact never depends on cache state.
     * @type {string|null}
     */
    this.__sessionFingerprint = null;

    /**
     * Digest of the cross-unit state `parse()` resolves against, computed on
     * the first parse of a build and dropped whenever that state is replaced.
     * @type {string|null}
     */
    this.__environmentFingerprint = null;

    /**
     * What the last parse handed to Atlas, so a cache hit can hand over the
     * same thing.
     *
     * Atlas keeps a model per build, so a unit replayed from the cache still
     * has to be added to the model this build is assembling -- the fragment
     * itself comes from `atlas/cache.js`, which is keyed on a subset of what
     * keys this cache.
     * @type {object|null}
     */
    this.__lastAtlasInput = null;

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
    this.__environmentFingerprint = null;
  }

  /**
   * Turns the compilation cache on for this parser, under one session identity.
   *
   * Opt-in, and off unless a caller asks: the watch paths pass a fingerprint
   * from `createSessionFingerprint()`, while `avenx build`, the Vite plugin and
   * a standalone parse never call this and so always compile cold.
   * @param {string|null} sessionFingerprint - The session identity, or null to disable.
   * @returns {void}
   */
  setIncrementalSession(sessionFingerprint) {
    this.__sessionFingerprint = sessionFingerprint || null;
    this.__environmentFingerprint = null;
  }

  /**
   * Supplies the route parameters each page can receive.
   *
   * The router assigns every route parameter into the page's state before it
   * renders, so `{{ id }}` on a page routed as `'/profile/:id'` is a read of
   * declared state -- but the validator only ever saw `<state>`, so it reported
   * it as undeclared (AVX_W03). Since `avenx check` exits 1 on a warning, the
   * documented route-parameter feature failed CI on correct code.
   * @param {Map<string, Set<string>>} byPage - Parameter names by page name.
   * @returns {void}
   */
  setRouteParams(byPage) {
    this.__routeParams = byPage instanceof Map ? byPage : new Map();
    this.__environmentFingerprint = null;
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
    this.__environmentFingerprint = null;
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
   *
   * Reuses a previous compilation when the cache is enabled and nothing this
   * unit was derived from has changed; see `incrementalCache.js` for what
   * "nothing" has to cover. With the cache off -- the default, and always for
   * `avenx build` -- this is {@link ComponentParser#compileUnit} directly.
   * @param {string} filePath - The absolute path to the file.
   * @param {'component'|'page'} [type] - The type of file being parsed.
   * @returns {string} The generated JavaScript class.
   */
  parse(filePath, type = 'component') {
    if (!this.__sessionFingerprint) {
      return this.compileUnit(filePath, type);
    }

    const key = this.unitCacheKey(filePath, type);
    if (!key) {
      // The unit's inputs could not be read -- a path alias that resolves
      // nowhere, most often. `compileUnit` reads the same file and produces the
      // real diagnostic, which is better than one invented here.
      return this.compileUnit(filePath, type);
    }

    const hit = getCachedUnit(key);
    if (hit && this.canReplayUnit(hit)) {
      return this.replayUnit(hit);
    }

    const before = this.captureBaseline();
    const warnings = [];
    const output = this.recordWarnings(warnings, () => this.compileUnit(filePath, type));
    setCachedUnit(key, this.captureUnit(before, output, warnings));
    return output;
  }

  /**
   * Runs `compile` with every warning it emits collected as well as reported.
   *
   * A warning is part of what compiling a unit produces. Skipping the
   * compilation on a cache hit would otherwise skip the warning too, so the
   * second save of a file with a typo'd component tag would report less than the
   * first, and `check --watch` -- which exits non-zero on a warning -- would
   * disagree with itself between passes.
   *
   * Collected through a temporary transport rather than by replacing a method:
   * the logger already treats transports as its extension point, the extra one
   * sits alongside the real ones so the warning is still reported normally, and
   * the compiler is synchronous, so the window closes before anything else can
   * log through it.
   * @param {Array<any[]>} sink - Receives the arguments of each warning.
   * @param {Function} compile - The work to run.
   * @returns {*} Whatever `compile` returned.
   * @private
   */
  recordWarnings(sink, compile) {
    const previous = logger.config.transports;
    logger.configure({
      transports: [
        ...(Array.isArray(previous) ? previous : [consoleTransport]),
        (level, formatted, args) => {
          if (level === 'warn') sink.push(args);
        },
      ],
    });

    try {
      return compile();
    } finally {
      logger.configure({ transports: previous });
    }
  }

  /**
   * Computes this unit's compilation-cache key, or null when it cannot be read.
   *
   * The path and both file reads repeat what {@link ComponentParser#compileUnit}
   * does, because the key has to name the file that will actually be read and
   * the text that will actually be compiled. Two reads of a file the OS has
   * cached is not a cost worth restructuring the compiler around, and on a hit
   * they are the only reads that happen.
   * @param {string} filePath - The path as the caller gave it.
   * @param {'component'|'page'} type - Which kind of unit it is.
   * @returns {string|null} The key, or null when the source is unreadable.
   * @private
   */
  unitCacheKey(filePath, type) {
    const config = this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    const rootDir = this.rootDir || (filePath ? loadConfig.findProjectRoot(path.dirname(filePath)) : process.cwd());
    const resolved = resolvePathAlias(filePath, config, rootDir);

    let source;
    try {
      source = replaceEnvVariables(fs.readFileSync(resolved, 'utf-8'));
    } catch {
      return null;
    }

    const isPage = type === 'page';
    const stylePath = resolved.replace(/\.(component|page)?\.(js|html|avx)$/i, isPage ? '.page.css' : '.component.css');
    let styleSource = null;
    try {
      styleSource = fs.readFileSync(stylePath, 'utf-8');
    } catch {
      // A unit without a stylesheet. Distinguished from an empty one by
      // `createUnitKey`, so adding an empty stylesheet still invalidates.
    }

    if (!this.__environmentFingerprint) {
      this.__environmentFingerprint = createEnvironmentFingerprint({
        bridges: this.bridges,
        componentNames: this.__componentNames,
        routeParams: this.__routeParams,
        production: this.production === true,
        customVoidTags: this.customVoidTags || [],
      });
    }

    return createUnitKey({
      filePath: resolved,
      kind: isPage ? 'page' : 'component',
      source,
      styleSource,
      sessionFingerprint: this.__sessionFingerprint,
      environmentFingerprint: this.__environmentFingerprint,
    });
  }

  /**
   * Records how large each of `compileUnit`'s output channels is before it runs.
   *
   * `compileUnit` reports most of its work by appending to parser-wide
   * collections rather than by returning it. Measuring them before and after is
   * how one unit's contribution is separated from the build's, without
   * `compileUnit` having to know that a cache exists.
   * @returns {object} The baseline.
   * @private
   */
  captureBaseline() {
    return {
      style: this.styleProcessor ? this.styleProcessor.captureUnitBaseline() : null,
      referencedBefore: new Set(this.referencedComponents),
      locationKeys: new Set(this.locations.keys()),
      moduleMetaKeys: new Set(this.moduleMeta.keys()),
      atlasUnits: this.__atlasUnits ? this.__atlasUnits.length : 0,
      renderFallbacks: this.renderFallbacks.length,
      expressionGaps: this.expressionGaps.length,
    };
  }

  /**
   * Collects everything one `compileUnit` call produced.
   *
   * Paired with {@link ComponentParser#replayUnit}: every channel captured here
   * must be replayed there, and the two are adjacent so that a channel added to
   * one and not the other is visible rather than latent.
   *
   * `this.bridges` is deliberately not among them. `resolveBridgeBindings` does
   * populate it lazily, but only for a bridge the compiler did not discover, and
   * a project build refuses such an import outright (AVX_C07) before any unit is
   * parsed. The cache is only ever on during a project build, so the delta there
   * is always empty -- and carrying a channel that cannot fire would suggest a
   * guarantee this does not have.
   * @param {object} before - From {@link ComponentParser#captureBaseline}.
   * @param {string} output - What `compileUnit` returned.
   * @param {Array<any[]>} warnings - The warnings it emitted, in order.
   * @returns {object} The unit's product.
   * @private
   */
  captureUnit(before, output, warnings) {
    const added = (map, seen) => [...map.entries()].filter(([key]) => !seen.has(key));

    return {
      output,
      warnings,
      style: this.styleProcessor && before.style ? this.styleProcessor.sliceUnitContribution(before.style) : null,
      referencedComponents: [...this.referencedComponents].filter((name) => !before.referencedBefore.has(name)),
      locations: added(this.locations, before.locationKeys),
      moduleMeta: added(this.moduleMeta, before.moduleMetaKeys),
      atlasUnits: this.__atlasUnits ? this.__atlasUnits.slice(before.atlasUnits) : [],
      renderFallbacks: this.renderFallbacks.slice(before.renderFallbacks),
      expressionGaps: this.expressionGaps.slice(before.expressionGaps),
      atlasInput: this.__lastAtlasInput,
    };
  }

  /**
   * Whether a stored product can be replayed faithfully right now.
   *
   * Only the stylesheet half can refuse: its scope hashes are de-duplicated
   * across the build, so a contribution whose hash is already present would
   * append rules a cold build would have skipped. Refusing costs one
   * recompilation; replaying anyway would cost a wrong stylesheet.
   * @param {object} unit - A stored product.
   * @returns {boolean} True when {@link ComponentParser#replayUnit} is safe.
   * @private
   */
  canReplayUnit(unit) {
    if (!unit.style) return true;
    return !this.styleProcessor || this.styleProcessor.canApplyUnitContribution(unit.style);
  }

  /**
   * Replays a cached unit's product onto this parser and this build's model.
   *
   * The inverse of {@link ComponentParser#captureUnit}. The Atlas model is the
   * one channel that is not simply copied: the model belongs to this build, so
   * the unit is added to it through `atlas/cache.js`, which is keyed on a
   * subset of what keyed this entry and therefore hits alongside it.
   * @param {object} unit - A stored product.
   * @returns {string} The class body `compileUnit` had returned.
   * @private
   */
  replayUnit(unit) {
    if (unit.style && this.styleProcessor) {
      this.styleProcessor.applyUnitContribution(unit.style);
    }
    for (const args of unit.warnings) {
      logger.warn(...args);
    }
    for (const name of unit.referencedComponents) {
      this.referencedComponents.add(name);
    }
    for (const [name, value] of unit.locations) {
      this.locations.set(name, value);
    }
    for (const [file, value] of unit.moduleMeta) {
      this.moduleMeta.set(file, value);
    }
    for (const entry of unit.renderFallbacks) {
      this.renderFallbacks.push(entry);
    }
    for (const entry of unit.expressionGaps) {
      this.expressionGaps.push(entry);
    }
    if (this.model && unit.atlasInput) {
      addCachedComponentUnit(this.model, { ...unit.atlasInput, bridges: this.bridges });
    }
    if (this.__atlasUnits) {
      for (const entry of unit.atlasUnits) {
        this.__atlasUnits.push(entry);
      }
    }

    return unit.output;
  }

  /**
   * Compiles a .component.js or .page.js file and its corresponding CSS file.
   * @param {string} filePath - The absolute path to the file.
   * @param {'component'|'page'} [type] - The type of file being parsed.
   * @returns {string} The generated JavaScript class.
   */
  compileUnit(filePath, type = 'component') {
    const config = this.config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
    const rootDir = this.rootDir || (filePath ? loadConfig.findProjectRoot(path.dirname(filePath)) : process.cwd());
    filePath = resolvePathAlias(filePath, config, rootDir);

    const isPage = type === 'page';
    const content = replaceEnvVariables(fs.readFileSync(filePath, 'utf-8'), path.relative(rootDir, filePath), config);
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

    this.assertDeclarationsTerminated(content, filePath, name);
    const contracts = this.extractContracts(content);
    const bridgeBindings = this.resolveBridgeBindings(filePath, content, name, contracts);
    // Everything else the file imports. Bridges are excluded because they reach
    // the template through the bridges argument already, and the runtime entry
    // is excluded because those names are the base class the module extends.
    const importedLocals = collectImportBindings(
      content,
      bridgeBindings.map((entry) => entry.local),
    );
    const state = this.extractState(content, filePath, config);
    const computed = this.extractComputed(content);
    const methods = this.extractMethods(content, name, filePath, config);
    const actionModifiers = this.extractActionModifiers(content);
    const resources = this.expressionParser.parseResources(content);
    let template = this.extractTemplate(content, desBlocks, name, filePath, state, computed, methods, resources, [
      ...bridgeBindings.map((entry) => entry.local),
      ...importedLocals,
    ]);

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

    this.locations.set(
      name,
      collectLocations({
        name,
        filePath,
        rootDir,
        content,
        computed,
        methods,
        resources,
        contracts,
      }),
    );

    // Atlas is retention, not a second pass: everything it needs was produced
    // above on the way to generating this class, and is handed over rather
    // than recomputed. The original `content` goes with it because the
    // template below has already been rewritten past the point where its
    // offsets point at anything a developer can open.
    //
    // Named rather than passed inline so a unit replayed from the compilation
    // cache can be handed to Atlas on the same terms. `bridges` is deliberately
    // left off: it is the build's live descriptor map, supplied at the call.
    const atlasInput = {
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
    };
    this.__lastAtlasInput = atlasInput;

    if (this.model) {
      const atlasUnit = addCachedComponentUnit(this.model, { ...atlasInput, bridges: this.bridges });
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
    const displayPath = filePath ? path.relative(rootDir, filePath) || path.basename(filePath) : '';
    const exprLocations = !this.production ? extractTemplateLocations(content, displayPath) : null;
    const customVoidTagsForProgram = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
    const rendered = this.compileRenderProgram(name, filePath, customVoidTagsForProgram, exprLocations);

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
    const templateDeps = this.extractTemplateDependencies(this.lastSemanticTemplate || template);
    if (templateDeps !== undefined) {
      optionParts.push(`templateDeps: ${JSON.stringify(templateDeps)}`);
    }
    if (!this.production && exprLocations) {
      optionParts.push(`exprLocations: ${JSON.stringify(exprLocations)}`);
      optionParts.push(`__filename: ${JSON.stringify(displayPath || '')}`);
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
        // Development-only debug tables. Trace names a woken binding by the
        // expression it evaluates and an event node by the handler that fired,
        // and both of those are source. A production bundle cannot start a
        // recording at all, so carrying the source there would be weight
        // nothing can read.
        let debugStatic = '';
        if (!this.production) {
          if (rendered.expressions.length > 0) {
            debugStatic += `${name}.__axProgramExprSrc = ${JSON.stringify(rendered.expressions)};\n`;
          }
          if (rendered.statements.length > 0) {
            debugStatic += `${name}.__axProgramStmtSrc = ${JSON.stringify(rendered.statements)};\n`;
          }
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
      // The line is where the expression's text first appears in the file. The
      // table is keyed by source text, so this is exact for every expression
      // written once and names the first use of one written more than once.
      const lineOf = (source) => {
        const index = typeof source === 'string' ? content.indexOf(source) : -1;
        return index >= 0 ? content.slice(0, index).split('\n').length : null;
      };
      this.expressionGaps.push({
        name,
        filePath,
        refusals: table.refusals,
        gaps: table.gaps.map((gap) => ({ ...gap, line: lineOf(gap.source) })),
      });
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

    let devStatics = '';
    if (!this.production) {
      if (exprLocations) {
        devStatics += `\n${name}.__axExprLocations = ${JSON.stringify(exprLocations)};`;
      }
      devStatics += `\n${name}.__source = ${JSON.stringify(content)};`;
    }

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
${programStatic}${expressionStatic}${devStatics}`;
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
${programStatic}${expressionStatic}${devStatics}`;
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
      absorbCssBlocks(
        this.styleProcessor,
        scanCssBlocks(inner),
        desBlocks,
        desPath,
        cssStartLine,
        rawGlobalCss,
        [],
      );
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
    return this.expressionParser.parseState(content, activeConfig, {
      name: filePath ? classNameFromPath(filePath) : undefined,
      filePath,
    });
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
        if (RESERVED_INSTANCE_METHOD_KEYS.includes(methodName)) {
          const actionMatchIdx = content.search(new RegExp(`<action\\s+[^>]*name=["']${methodName}["']`));
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION,
            methodName,
            name || (filePath ? path.basename(filePath) : 'Component'),
          );
          if (actionMatchIdx >= 0) {
            err.setLocation({ source: content, index: actionMatchIdx, filename: filePath });
          }
          reportWarning(AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION, err, activeConfig);
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
          new BuildError(
            AvenxErrorCodes.COMPILER_INVALID_CONFIG,
            filePath || 'template',
            `Preprocessor execution error: ${err.message}`,
          ),
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
    template = template.replace(/^[ \t]*import\s+(?:[\s\w$,{}*]*?\s+from\s+)?['"][^'"]*['"];?[ \t]*\r?\n?/gm, '');
    // Comments are removed by the spans the markup lexer reports, so text that
    // merely looks like a comment inside an attribute value survives. An
    // unterminated comment is left in place for the malformed-template check.
    template = stripTemplateComments(template).trim();

    template = this.preprocessTemplate(template, filePath);
    this.assertWellFormedTemplate(template, content, filePath, name);

    const isPage = filePath && filePath.endsWith('.page.js');

    const desPath = filePath
      ? filePath.replace(isPage ? '.page.js' : '.component.js', isPage ? '.page.css' : '.component.css')
      : '';

    const voidTags = [...(this.customVoidTags || []), ...getCustomVoidTags(filePath)];
    template = this.styleProcessor.process(template, desBlocks, name, desPath, voidTags);
    this.reportFrontEndDiagnostics(this.styleProcessor.lastDiagnostics, template, content, filePath);

    // Validated as written, before `data-ax-bind` is expanded. The expansion
    // turns one attribute into `value="{{ x }}"` plus `@input="x = ..."`, so
    // validating its output reported every undeclared bind twice, each time
    // with a code frame quoting attributes that appear nowhere in the file.
    // The template-events walk already reads `data-ax-bind` as one expression.
    const authoredTemplate = template;
    template = this.processBindDirectives(template);
    this.assertFrontEndComplete(template, content, filePath, name);

    if (filePath && state && computed && methods) {
      this.validateTemplate(authoredTemplate, state, computed, methods, resources, filePath, name, bridgeLocals);
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
    this.validateEventHandlerAttributes(template, content, filePath, name);
    this.validateDynamicAttributeBindings(template, content, filePath, name);

    // The structural directives, in the order `parser/directives/index.js`
    // states. Component tags are rewritten later, by `compileUnit`.
    template = directives.desugarStructuralDirectives(template, {
      filePath,
      componentName: name,
      config: this.config,
      customVoidTags: this.customVoidTags,
    });

    return template
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');
  }

  /**
   * Fails the build when an `<action>` or `<resource>` is never closed.
   * See `parser/validate.js`.
   * @param {string} content - The component source.
   * @param {string} filePath - The component path.
   * @param {string} name - The component class name.
   * @throws {TemplateValidationError} AVX_C26 for the first unclosed declaration.
   */
  assertDeclarationsTerminated(content, filePath, name) {
    return validate.assertDeclarationsTerminated(content, filePath, name);
  }

  /**
   * Refuses a bound inline event handler, and warns on a static one.
   * See `parser/validate.js`.
   * @param {string} template - The semantic template (component tags intact).
   * @param {string} content - The component source, for locations.
   * @param {string} filePath - The component path.
   * @param {string} name - The component class name.
   * @throws {TemplateValidationError} AVX_C28 for a bound handler.
   */
  validateEventHandlerAttributes(template, content, filePath, name) {
    return validate.validateEventHandlerAttributes(template, content, filePath, name, { config: this.config });
  }

  /**
   * Refuses a dynamic attribute binding whose slots are written as
   * interpolations. See `parser/validate.js`.
   * @param {string} template - The semantic template.
   * @param {string} content - The component source, for locations.
   * @param {string} filePath - The component path.
   * @param {string} name - The component class name.
   * @throws {TemplateValidationError} AVX_C29 for an interpolated slot.
   */
  validateDynamicAttributeBindings(template, content, filePath, name) {
    return validate.validateDynamicAttributeBindings(template, content, filePath, name);
  }

  /**
   * Fails the build when the template contains a tag or comment that never ends.
   * See `parser/validate.js`.
   * @param {string} template - The template, after preprocessing.
   * @param {string} content - The component source, for locations.
   * @param {string} filePath - The component path.
   * @param {string} name - The component class name.
   * @throws {TemplateValidationError} AVX_C26 when a construct is unterminated.
   */
  assertWellFormedTemplate(template, content, filePath, name) {
    return validate.assertWellFormedTemplate(template, content, filePath, name);
  }

  /**
   * Reports the diagnostics the style front-end recorded, with locations.
   * See `parser/validate.js`.
   * @param {Array<{severity: string, code: string, args: string[], offset: number, snippet: string}>} diagnostics
   *   What {@link StyleProcessor#process} recorded.
   * @param {string} template - The template those offsets refer to.
   * @param {string} content - The component source.
   * @param {string} filePath - The component path.
   * @throws {TemplateValidationError} For an error-severity diagnostic, or a
   *   warning escalated to an error in avenx.config.json.
   */
  reportFrontEndDiagnostics(diagnostics, template, content, filePath) {
    return validate.reportFrontEndDiagnostics(diagnostics, template, content, filePath, { config: this.config });
  }

  /**
   * Fails the build if a directive the front-end rewrites is still present.
   * See `parser/validate.js`.
   * @param {string} template - The rewritten template.
   * @param {string} content - The component source.
   * @param {string} filePath - The component path.
   * @param {string} name - The component class name.
   * @throws {TemplateValidationError} AVX_C25 when a directive survived.
   */
  assertFrontEndComplete(template, content, filePath, name) {
    return validate.assertFrontEndComplete(template, content, filePath, name);
  }

  /**
   * Maps a template offset back to the component file where possible.
   * See `parser/validate.js`.
   * @param {string} content - The component source.
   * @param {string} template - The template the offset refers to.
   * @param {number} offset - Offset into the template.
   * @param {string} snippet - The text at that offset.
   * @param {string} filePath - The component path.
   * @returns {{source: string, index: number, filename: string}} A location.
   */
  frontEndLocation(content, template, offset, snippet, filePath) {
    return validate.frontEndLocation(content, template, offset, snippet, filePath);
  }

  /**
   * Folds common `@event` handlers into one `data-ax-event` attribute.
   * See `parser/directives/eventDelegation.js`.
   * @param {string} template - The HTML template string.
   * @param {string} filePath - The component file path.
   * @returns {string} The transformed template string.
   */
  processEventDelegation(template, filePath) {
    return directives.processEventDelegation(template, filePath, { customVoidTags: this.customVoidTags });
  }

  /**
   * Rewrites `:prop` on `<slot>` tags to `data-props-*`. See `parser/directives/slotProps.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  processSlotProps(template) {
    return directives.processSlotProps(template);
  }

  /**
   * Escapes interpolations inside scoped-slot and row templates.
   * See `parser/directives/scopedSlots.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  escapeScopedSlots(template) {
    return directives.escapeScopedSlots(template);
  }

  /**
   * Performs compile-time validation on template expressions to ensure
   * all referenced variables and methods are declared. See `parser/validate.js`.
   * @param {string} template - The template string, before data-ax-bind is expanded.
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
    return validate.validateTemplate(template, state, computed, methods, resources, filePath, name, bridgeLocals, {
      config: this.config,
      customVoidTags: this.customVoidTags,
      routeParams: this.__routeParams,
      componentNames: this.__componentNames,
    });
  }

  /**
   * Reports an interpolation that is opened and never closed (AVX_W54).
   * See `parser/validate.js`.
   * @param {string} template - The template being validated.
   * @param {string} filePath - Absolute path of the file being compiled.
   * @param {string} name - The component or page name, for the diagnostic.
   * @param {object|null} config - Resolved project configuration.
   * @returns {void}
   * @private
   */
  reportUnterminatedInterpolations(template, filePath, name, config) {
    return validate.reportUnterminatedInterpolations(template, filePath, name, config);
  }

  /**
   * Reports PascalCase template tags that resolve to no registered component,
   * built-in tag, or known HTML/SVG element (AVX_W46). See `parser/validate.js`.
   * @param {string} template - The processed template HTML.
   * @param {string} filePath - Absolute path of the file being compiled.
   * @param {string} name - The component/page name, for the diagnostic.
   * @param {object|null} config - Resolved project configuration.
   * @returns {void}
   * @private
   */
  validateComponentTags(template, filePath, name, config) {
    return validate.validateComponentTags(template, filePath, name, config, {
      componentNames: this.__componentNames,
      customVoidTags: this.customVoidTags,
    });
  }

  /**
   * Validates template against static accessibility rules (AVX_W65 - AVX_W70).
   * See `parser/validate.js`.
   * @param {string} template - Authored template string.
   * @param {string} filePath - Path to component file.
   * @param {string} name - Component name.
   * @param {object} [config] - Application configuration.
   */
  validateAccessibility(template, filePath, name, config) {
    return validate.validateAccessibility(template, filePath, name, config || this.config);
  }

  /**
   * Extracts root variable and method identifiers from a JS expression string.
   * See `parser/identifiers.js`.
   * @param {string} code - The Javascript expression/statement.
   * @returns {string[]} The list of root identifiers.
   * @private
   */
  extractRootIdentifiers(code) {
    return extractRootIdentifiers(code);
  }

  /**
   * Extracts the root state identifiers referenced by the template for rendering.
   * Returns null if the template contains constructs that defeat static analysis.
   * @param {string} template - Authored template string.
   * @returns {string[]|null}
   */
  extractTemplateDependencies(template) {
    if (typeof template !== 'string' || !template.trim()) {
      return [];
    }

    // 1. Constructs that defeat static analysis:
    // Dynamic attribute-name binding :[attr]="value"
    if (/:\[[^\]]+\]/.test(template)) {
      return null;
    }

    // data-ax-html with a non-empty expression
    if (/data-ax-html\s*=\s*["'][^"']+["']/.test(template)) {
      return null;
    }

    // Spread-like access or dynamic bracket indexing on state in template expressions
    if (/state\s*\[/.test(template)) {
      return null;
    }

    const deps = new Set();
    const events = collectTemplateEvents(template);

    for (const ev of events) {
      if (ev.type === 'event') {
        // Event handlers (@click="inc()") do not affect template DOM rendering.
        continue;
      }

      if (ev.type === 'loop_start') {
        const ids = this.extractRootIdentifiers(ev.list);
        for (const id of ids) {
          if (!EXCLUDED_IDENTIFIERS.has(id)) deps.add(id);
        }
        continue;
      }

      if (ev.expr) {
        const ids = this.extractRootIdentifiers(ev.expr);
        for (const id of ids) {
          if (!EXCLUDED_IDENTIFIERS.has(id)) deps.add(id);
        }
        const statePropRegex = /state\.([A-Za-z_$][\w$]*)/g;
        let m;
        while ((m = statePropRegex.exec(ev.expr)) !== null) {
          deps.add(m[1]);
        }
      }
    }

    // Also scan dynamic attribute bindings :attr="expr"
    const dynamicAttrRegex = /:([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = dynamicAttrRegex.exec(template)) !== null) {
      const expr = attrMatch[2];
      if (expr) {
        const ids = this.extractRootIdentifiers(expr);
        for (const id of ids) {
          if (!EXCLUDED_IDENTIFIERS.has(id)) deps.add(id);
        }
        const statePropRegex = /state\.([A-Za-z_$][\w$]*)/g;
        let m;
        while ((m = statePropRegex.exec(expr)) !== null) {
          deps.add(m[1]);
        }
      }
    }

    return Array.from(deps).sort();
  }

  /**
   * Expands `data-ax-bind` two-way bindings. See `parser/directives/bindDirectives.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  processBindDirectives(template) {
    return directives.processBindDirectives(template);
  }

  /**
   * Desugars `<@for>` loops. See `parser/directives/forLoops.js`.
   * @param {string} template - The HTML template string.
   * @returns {string} The processed template.
   * @private
   */
  processForLoops(template) {
    return directives.processForLoops(template);
  }

  /**
   * Desugars `<@suspense>`. See `parser/directives/suspense.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   * @private
   */
  processSuspense(template) {
    return directives.processSuspense(template);
  }

  /**
   * Desugars `<@errorBoundary>`. See `parser/directives/errorBoundary.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   * @private
   */
  processErrorBoundary(template) {
    return directives.processErrorBoundary(template);
  }

  /**
   * Desugars `<@deadlock>` boundaries. See `parser/directives/deadlock.js`.
   * @param {string} template - The template string.
   * @param {string} [filePath] - The component file path for source location tracking.
   * @param {string} [componentName] - The component name for diagnostics.
   * @returns {string} The processed template.
   * @private
   */
  processDeadlock(template, filePath = '', componentName = '') {
    return directives.processDeadlock(template, filePath, componentName, { config: this.config });
  }

  /**
   * Desugars `<@defer>`. See `parser/directives/defer.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   * @private
   */
  processDefer(template) {
    return directives.processDefer(template);
  }

  /**
   * Rewrites component tags to `data-avenx-comp` hosts, running the slot-prop
   * and scoped-slot passes first. See `parser/directives/componentTags.js`.
   * @param {string} template - The template string.
   * @returns {string} The processed template.
   */
  processComponentTags(template) {
    return directives.processComponentTags(template);
  }

  /**
   * Desugars `<transition>` wrappers. See `parser/directives/transitions.js`.
   * @param {string} template - The HTML template string.
   * @param {string} [filePath] - The component file path, used to resolve project-specific
   *   void tags from `avenx.config.json`.
   * @returns {string} The processed template.
   */
  processTransitionTags(template, filePath) {
    return directives.processTransitionTags(template, filePath, { customVoidTags: this.customVoidTags });
  }

  /**
   * Recursively processes transition tags in the node tree.
   * @param {HTMLNode[]} nodes - The nodes to rewrite.
   * @returns {HTMLNode[]} The rewritten nodes.
   */
  processTransitionTagsInTree(nodes) {
    return directives.processTransitionTagsInTree(nodes);
  }

  /**
   * Identifies static elements/subtrees and marks them with data-ax-static="true".
   * See `parser/staticSubtrees.js`.
   * @param {string} template - The compiled HTML template.
   * @param {string} [filePath] - The component file path, used to resolve project-specific
   *   void tags from `avenx.config.json`.
   * @returns {string} The optimized template.
   */
  optimizeStaticSubtrees(template, filePath) {
    return optimizeStaticSubtrees(template, filePath, {
      customVoidTags: this.customVoidTags,
      markStaticNodes: (nodes, parentIsStatic) => this.markStaticNodes(nodes, parentIsStatic),
    });
  }

  /**
   * Recursively traverses nodes to find and mark the root of static subtrees.
   * See `parser/staticSubtrees.js`. Descends through this method, so an
   * instance override sees every level of the walk.
   * @param {HTMLNode[]} nodes - The nodes to mark, in place.
   * @param {boolean} [parentIsStatic] - Whether the parent is already marked static.
   * @param {boolean} [inSlot] - Indicates if the current node is inside a slot or component transclusion boundary.
   * @returns {void}
   */
  markStaticNodes(nodes, parentIsStatic = false, inSlot = false) {
    return markStaticNodes(nodes, parentIsStatic, inSlot, (children, childStatic, childInSlot) =>
      this.markStaticNodes(children, childStatic, childInSlot),
    );
  }
}

ComponentParser.parseHTML = parseHTML;

export default ComponentParser;
