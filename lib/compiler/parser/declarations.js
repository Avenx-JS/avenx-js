/**
 * @file declarations.js
 * @description Extracts Avenx declaration tags from a component source.
 *
 * This is the single place that decides what a component declares. Both the
 * reader (what `<state>` says) and the remover (what leaves the template) come
 * from one scan over one set of source ranges, so the two can no longer
 * disagree — which is the class of bug that let a multi-line `<state>` tag be
 * parsed correctly and stripped incorrectly at the same time.
 *
 * The declarations recognised here are the component's *header*: `<state>`,
 * `<computed>`, `<action>`, `<resource>` and `<contract>`. Structural
 * directives (`<@for>`, `<@suspense>`, `<@deadlock>`, `<@css />`) stay in the
 * template and are handled by the template pipeline; they describe rendering,
 * not declaration.
 * @module lib/compiler/parser/declarations
 */

import { parseExpressionAt } from 'acorn';
AFSSTGSTGSGSGSGSG

/**
 * The declaration tags that are lifted out of the template.
 * @type {Set<string>}
 */
const DECLARATION_TAGS = new Set(['state', 'computed', 'action', 'resource', 'contract', '@contract']);

/**
 * Contract names the compiler understands.
 * @type {string[]}
 */
export const VALID_CONTRACTS = ['static', 'pure', 'deterministic', 'isolated'];

/**
 * Object keys a state initialiser may not define.
 *
 * The state object is emitted into the bundle as an object literal, where
 * `__proto__` would set the prototype rather than define a key.
 * @type {Set<string>}
 */
const UNSAFE_LITERAL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Raised while evaluating an initialiser that is not a constant literal.
 */
class NotConstantLiteral extends Error {}

/**
 * Describes a node that is not a constant, for a diagnostic.
 * @param {object} node - An acorn expression node.
 * @returns {string} A short description.
 */
function describeNonConstant(node) {
  switch (node.type) {
    case 'Identifier':
      return `a reference to "${node.name}"`;
    case 'CallExpression':
    case 'NewExpression':
      return 'a function call';
    case 'MemberExpression':
      return 'a property access';
    case 'SpreadElement':
      return 'a spread';
    case 'TemplateLiteral':
      return 'a template literal with substitutions';
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return 'a function';
    default:
      return `an expression (${node.type})`;
  }
}

/**
 * Evaluates an acorn node that must consist only of constant literals.
 * @param {object} node - The node.
 * @returns {any} The value.
 * @throws {NotConstantLiteral} When any part is not a constant literal.
 */
function evaluateConstantLiteral(node) {
  switch (node.type) {
    case 'Literal':
      if (node.regex) throw new NotConstantLiteral('a regular expression');
      if (node.bigint !== undefined) throw new NotConstantLiteral('a BigInt');
      return node.value;

    case 'TemplateLiteral':
      if (node.expressions.length > 0) throw new NotConstantLiteral(describeNonConstant(node));
      return node.quasis[0].value.cooked;

    case 'UnaryExpression':
      if ((node.operator === '-' || node.operator === '+') && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
        return node.operator === '-' ? -node.argument.value : node.argument.value;
      }
      throw new NotConstantLiteral(`an expression (${node.operator} operator)`);

    case 'ArrayExpression':
      return node.elements.map((element) => {
        if (element === null) return null;
        if (element.type === 'SpreadElement') throw new NotConstantLiteral(describeNonConstant(element));
        return evaluateConstantLiteral(element);
      });

    case 'ObjectExpression': {
      const out = {};
      for (const property of node.properties) {
        if (property.type === 'SpreadElement') throw new NotConstantLiteral(describeNonConstant(property));
        if (property.shorthand) throw new NotConstantLiteral(describeNonConstant(property.value));
        if (property.computed) throw new NotConstantLiteral('a computed key');
        if (property.kind !== 'init' || property.method) throw new NotConstantLiteral('a method or accessor');
        const key = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
        if (UNSAFE_LITERAL_KEYS.has(key)) throw new NotConstantLiteral(`the key "${key}"`);
        out[key] = evaluateConstantLiteral(property.value);
      }
      return out;
    }

    default:
      throw new NotConstantLiteral(describeNonConstant(node));
  }
}

/**
 * Reads a declared state value, reporting when it looks like an initialiser the
 * compiler cannot evaluate.
 *
 * In order:
 *
 * 1. `true`, `false`, `null` and numbers;
 * 2. strict JSON;
 * 3. a value starting with `[` or `{` that parses as a JavaScript expression:
 *    evaluated when it is made only of constant literals (objects, arrays,
 *    strings, numbers, booleans, `null`, signed numbers, template literals
 *    without substitutions), so `{ id: 1, name: 'Ada' }` is an object as
 *    state-management.md describes. When it is not constant -- `{ items: list }`,
 *    `[Date.now()]` -- the value stays the string it has always been and
 *    `notLiteral` says why, for the compiler to report;
 * 4. single quotes swapped for double quotes and read as JSON again, which is how
 *    `'Alice'` becomes `Alice`;
 * 5. the value as written.
 *
 * Plain text is never diagnosed, including bracketed prose such as
 * `[beta] feature`, which does not parse as an expression.
 * @param {string} raw - The attribute value as written.
 * @returns {{value: any, notLiteral: (string|null)}} The value, and why a
 *   bracketed initialiser was kept as a string, if it was.
 */
export function readStateValue(raw) {
  const trimmed = String(raw).trim();
  if (trimmed === 'true') return { value: true, notLiteral: null };
  if (trimmed === 'false') return { value: false, notLiteral: null };
  if (trimmed === 'null') return { value: null, notLiteral: null };
  if (trimmed !== '' && !isNaN(trimmed)) return { value: Number(trimmed), notLiteral: null };

  try {
    return { value: JSON.parse(raw), notLiteral: null };
  } catch {
    // not strict JSON
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let node;
    try {
      node = parseExpressionAt(trimmed, 0, { ecmaVersion: 'latest' });
    } catch {
      node = null;
    }
    if (node && node.end === trimmed.length) {
      try {
        return { value: evaluateConstantLiteral(node), notLiteral: null };
      } catch (error) {
        if (!(error instanceof NotConstantLiteral)) throw error;
        return { value: raw, notLiteral: error.message };
      }
    }
  }

  try {
    return { value: JSON.parse(String(raw).replace(/'/g, '"')), notLiteral: null };
  } catch {
    return { value: raw, notLiteral: null };
  }
}

/**
 * Coerces a declared attribute value to a JavaScript value.
 *
 * `<state count="0" />` should produce the number `0`, not the string `"0"`,
 * and `<state items="[1,2]" />` should produce an array. See
 * {@link readStateValue} for the full order.
 * @param {string} raw - The attribute value as written.
 * @returns {any} The coerced value.
 */
export function coerceValue(raw) {
  return readStateValue(raw).value;
}

/**
 * Reads an attribute that may carry Vue-style `:` binding syntax.
 *
 * `<resource :handler="x" :pollInterval="5000" />` and the unprefixed form mean
 * the same thing to Avenx; the colon is accepted because developers arriving
 * from Vue write it out of habit.
 * @param {Object<string,string>} attrs - The parsed attribute map.
 * @param {string} name - The attribute name without a prefix.
 * @returns {string|undefined} The value, or undefined when absent.
 */
function readBindable(attrs, name) {
  if (attrs[name] !== undefined) return attrs[name];
  return attrs[`:${name}`];
}

/**
 * @typedef {object} DeclarationSet
 * @property {Array<{name: string, value: any, notLiteral: (string|null), line: number, column: number}>} state
 *   Declared state keys, in source order. `notLiteral` explains why a bracketed
 *   initialiser was kept as a string.
 * @property {number} stateTagCount - How many `<state>` tags were written.
 * @property {number} secondStateTagOffset - Source offset of a duplicate
 *   `<state>` tag, or -1.
 * @property {Array<{name: string, expression: string, line: number, column: number}>} computed
 *   Declared computed values.
 * @property {Array<{name: string, body: string, atomic: boolean, onConflict: (string|undefined),
 *   line: number, column: number, tagOffset: number, bodyOffset: number}>} actions
 *   Declared actions with their modifiers.
 * @property {Array<{name: string, handler: string, pollInterval: (number|null),
 *   line: number, column: number}>} resources - Declared resources.
 * @property {Set<string>} contracts - Declared compiler contracts.
 * @property {Array<{name: string, offset: number}>} unterminated - Raw-text
 *   declarations (`<action>`, `<resource>`) opened and never closed, in source
 *   order. Their bodies are not read.
 * @property {string} template - The source with every declaration removed.
 * @property {Array<{start: number, end: number}>} ranges - Removed source ranges.
 */

/**
 * Reads every declaration in a component source.
 * @param {string} source - The component source text.
 * @returns {DeclarationSet} The declarations and the remaining template.
 */
export function parseDeclarations(source) {
  const tags = scanTags(source, DECLARATION_TAGS);
  const lines = createLineIndex(source);

  /** @type {DeclarationSet} */
  const result = {
    state: [],
    stateTagCount: 0,
    secondStateTagOffset: -1,
    computed: [],
    actions: [],
    resources: [],
    contracts: new Set(),
    unterminated: [],
    template: '',
    ranges: [],
  };

  for (const tag of tags) {
    if (tag.unterminated) {
      result.unterminated.push({ name: tag.lowerName, offset: tag.start });
    }
    const pos = lines.at(tag.start);
    result.ranges.push({ start: tag.start, end: tag.end });

    switch (tag.lowerName) {
      case 'state':
        result.stateTagCount++;
        if (result.stateTagCount === 2) {
          result.secondStateTagOffset = tag.start;
        }
        // Only the first <state> tag contributes keys, matching the documented
        // "one state declaration per component" rule. Later tags are still
        // removed from the template so a duplicate cannot leak into the DOM,
        // and the caller reports AVX_W28 for them.
        if (result.stateTagCount === 1) {
          for (const [name, value] of Object.entries(tag.attrs)) {
            const offset = tag.attrOffsets[name];
            const at = lines.at(offset ? offset.start : tag.start);
            const read = readStateValue(value);
            result.state.push({ name, value: read.value, notLiteral: read.notLiteral, line: at.line, column: at.column });
          }
        }
        break;

      case 'computed': {
        const name = tag.attrs.name;
        const expression = tag.attrs.value;
        if (name && expression !== undefined) {
          const offset = tag.attrOffsets.value;
          const at = offset ? lines.at(offset.valueStart) : pos;
          result.computed.push({ name, expression, line: at.line, column: at.column });
        }
        break;
      }

      case 'action': {
        const name = tag.attrs.name;
        if (name) {
          const atomic =
            tag.attrs.atomic !== undefined &&
            (tag.valueless.has('atomic') || tag.attrs.atomic === '' || tag.attrs.atomic === 'true');
          const bodyStart = tag.bodyStart >= 0 ? tag.bodyStart : tag.openEnd;
          result.actions.push({
            name,
            body: (tag.body || '').trim(),
            atomic,
            onConflict: tag.attrs.onConflict,
            line: pos.line,
            column: pos.column,
            tagOffset: tag.start,
            bodyOffset: bodyStart,
          });
        }
        break;
      }

      case 'resource': {
        const name = readBindable(tag.attrs, 'name');
        if (!name) break;
        const rawPoll = readBindable(tag.attrs, 'pollInterval');
        const pollInterval = rawPoll === undefined ? null : Number(rawPoll);

        let handler;
        if (tag.body !== null) {
          handler = tag.body.trim();
          // A single-expression body is the common shorthand. `return` is added
          // only when the body is unambiguously one expression.
          if (!handler.startsWith('return') && !handler.includes(';')) {
            handler = `return ${handler};`;
          }
        } else if (readBindable(tag.attrs, 'handler') !== undefined) {
          handler = readBindable(tag.attrs, 'handler');
        } else {
          break;
        }

        result.resources.push({
          name,
          handler,
          pollInterval: pollInterval !== null && !isNaN(pollInterval) && pollInterval > 0 ? pollInterval : null,
          line: pos.line,
          column: pos.column,
        });
        break;
      }

      case 'contract':
      case '@contract':
        for (const [rawName, value] of Object.entries(tag.attrs)) {
          const name = rawName.toLowerCase();
          if (!VALID_CONTRACTS.includes(name)) continue;
          if (tag.valueless.has(rawName) || value === 'true' || value === '') {
            result.contracts.add(name);
          }
        }
        break;

      default:
        break;
    }
  }

  result.template = stripRanges(source, result.ranges);
  return result;
}
