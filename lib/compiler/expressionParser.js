import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { TemplateValidationError } from './errors/TemplateValidationError.js';
import { reportWarning } from './utils/warningReporter.js';
import { parseDeclarations } from './parser/declarations.js';
import { LruCache } from '../core/utils/LruCache.js';

/**
 * Declaration sets keyed by source text.
 *
 * Every `parseX` method needs the same scan, and `ComponentParser` calls six of
 * them per file. Scanning once per unique source keeps that a single pass
 * without changing any method's signature.
 * @type {LruCache}
 */
const declarationCache = new LruCache(64);

/**
 * Returns the declaration set for a source, scanning it at most once.
 * @param {string} content - The component source.
 * @returns {import('./parser/declarations.js').DeclarationSet} The declarations.
 */
export function readDeclarations(content) {
  const source = typeof content === 'string' ? content : '';
  let parsed = declarationCache.get(source);
  if (!parsed) {
    parsed = parseDeclarations(source);
    declarationCache.set(source, parsed);
  }
  return parsed;
}

/**
 * Conflict policies an `<action atomic>` may select.
 *
 * Mirrors `rewind.onConflict` in avenx.config.json, which supplies the default
 * when an action does not name one.
 * @type {string[]}
 */
export const CONFLICT_POLICIES = ['safe', 'force', 'abort'];

/**
 * ExpressionParser is responsible for extracting state, computed properties,
 * and methods from Avenx component source code.
 */
class ExpressionParser {
  /**
   * @param {object} [config] - Project configuration object.
   */
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Extracts the initial state from <state /> tags.
   * @param {string} content - The component source code.
   * @param {object} [config] - Optional override configuration object.
   * @returns {object} The extracted state object.
   */
  parseState(content, config = null) {
    const activeConfig = config || this.config;
    const declarations = readDeclarations(content);

    if (declarations.stateTagCount > 1) {
      const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_MULTIPLE_STATE_TAGS);
      if (declarations.secondStateTagOffset >= 0) {
        err.setLocation({ source: content, index: declarations.secondStateTagOffset });
      }
      reportWarning(AvenxErrorCodes.COMPILER_MULTIPLE_STATE_TAGS, err, activeConfig);
    }

    const state = {};
    for (const entry of declarations.state) {
      state[entry.name] = entry.value;
    }
    return state;
  }

  /**
   * Extracts computed property definitions from <computed /> tags.
   * @param {string} content - The component source code.
   * @returns {object} A map of computed property names to their expressions.
   */
  parseComputed(content) {
    const computed = {};
    for (const entry of readDeclarations(content).computed) {
      computed[entry.name] = entry.expression;
    }
    return computed;
  }

  /**
   * Extracts method definitions from <action /> tags.
   * @param {string} content - The component source code.
   * @returns {object} A map of method names to their source code.
   */
  parseMethods(content) {
    const methods = {};
    for (const action of readDeclarations(content).actions) {
      methods[action.name] = action.body;
    }
    return methods;
  }

  /**
   * Extracts Avenx Rewind modifiers from `<action>` tags.
   *
   * Deliberately a second pass rather than a wider return type on
   * {@link ExpressionParser#parseMethods}: that method's `{name: body}` shape
   * is consumed by the code generator, by Atlas and by a dozen tests, and
   * widening it to carry attributes would ripple through all of them for the
   * sake of two optional flags.
   *
   * `atomic` is a bare boolean in the same style as `<contract static pure />`.
   * `onConflict` selects what a rewind does when it finds a value the
   * transaction did not write; omitting it falls back to the project's
   * `rewind.onConflict`, which is why an absent value is left undefined here
   * rather than defaulted.
   * @param {string} content - The component source code.
   * @returns {Object<string, {atomic: boolean, onConflict: string=}>} Modifiers
   *   by action name. Only actions that declare one appear.
   * @throws {TemplateValidationError} When `onConflict` names an unknown policy.
   */
  parseActionModifiers(content) {
    /** @type {Object<string, {atomic: boolean, onConflict: string=}>} */
    const modifiers = {};

    for (const action of readDeclarations(content).actions) {
      if (!action.atomic) continue;

      if (action.onConflict !== undefined && !CONFLICT_POLICIES.includes(action.onConflict)) {
        const err = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_CONTRACT_INVALID_DECLARATION,
          `onConflict="${action.onConflict}"`,
          `<action name="${action.name}" atomic>`,
          `expected one of ${CONFLICT_POLICIES.map((policy) => `"${policy}"`).join(', ')}`,
        );
        err.setLocation({ source: content, index: action.tagOffset });
        throw err;
      }

      modifiers[action.name] =
        action.onConflict === undefined ? { atomic: true } : { atomic: true, onConflict: action.onConflict };
    }

    return modifiers;
  }

  /**
   * Extracts resource definitions from <resource /> tags.
   * @param {string} content - The component source code.
   * @returns {object} A map of resource names to their handler expressions.
   */
  parseResources(content) {
    const resources = {};
    for (const entry of readDeclarations(content).resources) {
      resources[entry.name] =
        entry.pollInterval !== null ? { handler: entry.handler, pollInterval: entry.pollInterval } : entry.handler;
    }
    return resources;
  }

  /**
   * Parses dynamic attribute name binding expressions matching ^:\[(.*)\]$.
   * @param {string} attrName - The attribute name (e.g. ":[dynamicAttr]").
   * @param {string} [attrValue] - The attribute value expression.
   * @returns {object|null} Metadata object containing expression details or null if not a dynamic attribute.
   */
  parseDynamicAttribute(attrName, attrValue = '') {
    if (!attrName) return null;
    const match = attrName.match(/^:\[(.*)\]$/);
    if (!match) return null;
    return {
      isDynamicName: true,
      nameExpr: match[1],
      valueExpr: attrValue,
    };
  }

  /**
   * Extracts declared component-level compiler contracts from <contract /> tags.
   * Supports attributes: static, pure, deterministic, isolated (boolean or valueless).
   * @param {string} content - The component source code.
   * @returns {Set<string>} The set of active contracts for the component.
   */
  parseContracts(content) {
    return new Set(readDeclarations(content).contracts);
  }
}

export default ExpressionParser;

