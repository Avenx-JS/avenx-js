import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { TemplateValidationError } from './errors/TemplateValidationError.js';
import { reportWarning } from './utils/warningReporter.js';

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
    const state = {};
    const stateTags = content.match(/<state\s+[\s\S]*?\s*\/>/g) || [];
    if (stateTags.length > 1) {
      const secondIdx = content.indexOf(stateTags[1]);
      const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_MULTIPLE_STATE_TAGS);
      if (secondIdx >= 0) {
        err.setLocation({ source: content, index: secondIdx });
      }
      reportWarning(
        AvenxErrorCodes.COMPILER_MULTIPLE_STATE_TAGS,
        err,
        activeConfig,
      );
    }
    const match = content.match(/<state\s+([\s\S]*?)\s*\/>/);
    if (match) {
      const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let m;
      while ((m = attrRegex.exec(match[1])) !== null) {
        const k = m[1];
        const val = m[2] !== undefined ? m[2] : m[3];
        state[k] = this.#coerceValue(val);
      }
    }
    return state;
  }

  /**
   * Coerces a string value to its proper JavaScript type.
   * @param {string} val - The raw string value.
   * @returns {any} The coerced value.
   * @private
   */
  #coerceValue(val) {
    const trimmed = val.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed !== '' && !isNaN(trimmed)) return Number(trimmed);

    try {
      return JSON.parse(val);
    } catch {
      try {
        return JSON.parse(val.replace(/'/g, '"'));
      } catch {
        return val;
      }
    }
  }

  /**
   * Extracts computed property definitions from <computed /> tags.
   * @param {string} content - The component source code.
   * @returns {object} A map of computed property names to their expressions.
   */
  parseComputed(content) {
    const computed = {};
    const regex = /<computed\s+([\s\S]*?)\s*\/>/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrMatch;
      let name = null;
      let value = null;
      while ((attrMatch = attrRegex.exec(m[1])) !== null) {
        const k = attrMatch[1];
        const val = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
        if (k === 'name') name = val;
        if (k === 'value') value = val;
      }
      if (name && value !== null) {
        computed[name] = value;
      }
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
    const actionRegex = /<action\s+([\s\S]*?)>([\s\S]*?)<\/action>/g;
    let m;
    while ((m = actionRegex.exec(content)) !== null) {
      const attrs = m[1];
      const body = m[2];
      const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrMatch;
      let name = null;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        const k = attrMatch[1];
        const val = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
        if (k === 'name') {
          name = val;
          break;
        }
      }
      if (name) {
        methods[name] = body.trim();
      }
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
    const actionRegex = /<action\s+([\s\S]*?)>([\s\S]*?)<\/action>/g;
    let m;
    while ((m = actionRegex.exec(content)) !== null) {
      const attrs = m[1];
      const attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch;
      let name = null;
      let atomic = false;
      let onConflict;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        const key = attrMatch[1];
        const value =
          attrMatch[2] !== undefined
            ? attrMatch[2]
            : attrMatch[3] !== undefined
              ? attrMatch[3]
              : attrMatch[4];
        if (key === 'name') {
          name = value;
        } else if (key === 'atomic') {
          atomic = value === undefined || value === '' || value === 'true';
        } else if (key === 'onConflict') {
          onConflict = value;
        }
      }
      if (!name || !atomic) continue;

      if (onConflict !== undefined && !CONFLICT_POLICIES.includes(onConflict)) {
        const err = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_CONTRACT_INVALID_DECLARATION,
          `onConflict="${onConflict}"`,
          `<action name="${name}" atomic>`,
          `expected one of ${CONFLICT_POLICIES.map((policy) => `"${policy}"`).join(', ')}`,
        );
        const idx = content.indexOf(m[0]);
        if (idx >= 0) {
          err.setLocation({ source: content, index: idx });
        }
        throw err;
      }

      modifiers[name] = onConflict === undefined ? { atomic: true } : { atomic: true, onConflict };
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

    // 1. Block syntax: <resource name="xxx" pollInterval="5000">body</resource>
    const blockRegex = /<resource\s+([\s\S]*?)>([\s\S]*?)<\/resource>/g;
    let bm;
    while ((bm = blockRegex.exec(content)) !== null) {
      const attrs = bm[1];
      const body = bm[2];
      const attrRegex = /(?::)?(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrMatch;
      let name = null;
      let pollInterval = null;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        const k = attrMatch[1];
        const val = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
        if (k === 'name') {
          name = val;
        } else if (k === 'pollInterval') {
          pollInterval = Number(val);
        }
      }
      if (name) {
        let cleanBody = body.trim();
        if (!cleanBody.startsWith('return') && !cleanBody.includes(';')) {
          cleanBody = `return ${cleanBody};`;
        }
        if (pollInterval !== null && !isNaN(pollInterval) && pollInterval > 0) {
          resources[name] = { handler: cleanBody, pollInterval };
        } else {
          resources[name] = cleanBody;
        }
      }
    }

    // 2. Self-closing syntax: <resource name="xxx" handler="..." pollInterval="5000" />
    const selfClosingRegex = /<resource\s+([\s\S]*?)\s*\/>/g;
    let sm;
    while ((sm = selfClosingRegex.exec(content)) !== null) {
      const attrRegex = /(?::)?(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrMatch;
      let name = null;
      let handler = null;
      let pollInterval = null;
      while ((attrMatch = attrRegex.exec(sm[1])) !== null) {
        const k = attrMatch[1];
        const val = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
        if (k === 'name') name = val;
        if (k === 'handler') handler = val;
        if (k === 'pollInterval') pollInterval = Number(val);
      }
      if (name && handler !== null) {
        if (pollInterval !== null && !isNaN(pollInterval) && pollInterval > 0) {
          resources[name] = { handler, pollInterval };
        } else {
          resources[name] = handler;
        }
      }
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
    const contracts = new Set();
    const regex = /<(?:contract|@contract)\s+([\s\S]*?)\s*\/>/gi;
    let match;
    const validContracts = ['static', 'pure', 'deterministic', 'isolated'];
    while ((match = regex.exec(content)) !== null) {
      const attrsStr = match[1];
      const attrRegex = /([@\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        const name = attrMatch[1].toLowerCase();
        const val = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] !== undefined ? attrMatch[3] : attrMatch[4]);
        if (validContracts.includes(name)) {
          if (val === undefined || val === 'true' || val === '') {
            contracts.add(name);
          }
        }
      }
    }
    return contracts;
  }
}

export default ExpressionParser;

