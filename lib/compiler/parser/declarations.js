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

import { scanTags, stripRanges, createLineIndex } from './tokenizer.js';

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
 * Coerces a declared attribute value to a JavaScript value.
 *
 * `<state count="0" />` should produce the number `0`, not the string `"0"`,
 * and `<state items="[1,2]" />` should produce an array. The order matters:
 * literal keywords first, then numbers, then JSON, then the raw string.
 * @param {string} raw - The attribute value as written.
 * @returns {any} The coerced value.
 */
export function coerceValue(raw) {
  const trimmed = String(raw).trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed !== '' && !isNaN(trimmed)) return Number(trimmed);

  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(String(raw).replace(/'/g, '"'));
    } catch {
      return raw;
    }
  }
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
 * @property {Array<{name: string, value: any, line: number, column: number}>} state
 *   Declared state keys, in source order.
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
    template: '',
    ranges: [],
  };

  for (const tag of tags) {
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
            result.state.push({ name, value: coerceValue(value), line: at.line, column: at.column });
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
