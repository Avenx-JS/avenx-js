/**
 * @file collect.js
 * @description Finds every expression a component will evaluate at runtime.
 *
 * ## Why this is a scan rather than a list of call sites
 *
 * Expressions reach the runtime from more places than the render program: the
 * list manager reads `data-ax-for` and `data-ax-key` off the DOM, the defer
 * manager reads `data-ax-defer-when`, computed values arrive as declarations,
 * and event handlers travel inside a JSON attribute. Enumerating those call
 * sites in the compiler would mean two lists that have to stay in step, and the
 * failure mode of them drifting is silent: an expression that is not in the
 * table simply falls back to being interpreted, which is exactly the thing this
 * work exists to remove.
 *
 * So the collector reads the *finished* template — the one the runtime is
 * handed — and takes every expression-bearing position in it. A construct the
 * compiler learns to emit later is picked up without changing this file, as
 * long as it puts its expression where the others put theirs.
 *
 * ## Over-collecting is safe, under-collecting is not
 *
 * The table is keyed by exact source text and consulted only when the runtime
 * actually evaluates that text. An entry nothing ever looks up costs a few
 * bytes; a missing entry costs an interpreter in the bundle. The scan therefore
 * errs towards including a candidate, and anything that does not parse as an
 * expression is dropped rather than reported.
 * @module lib/compiler/codegen/collect
 */

import { parseHTML } from '../parser/htmlTree.js';
import { createInterpolationRegex } from '../../core/utils/templateUtils.js';

/**
 * Attributes whose whole value is one expression the runtime evaluates.
 * @type {string[]}
 */
const EXPRESSION_ATTRIBUTES = [
  'data-ax-for',
  'data-ax-key',
  'data-ax-show',
  'data-ax-class',
  'data-ax-html',
  'data-ax-defer-when',
  'data-ax-bind',
  'data-ax-dyn-attrs',
  'data-ax-style',
  'data-avenx-style',
];

/**
 * Interpolations inside a `<@for>` body, which the compiler escapes to `{% %}`
 * so the outer template's own interpolation pass leaves them alone. The list
 * manager restores them to `{{ }}` before evaluating, so the expression text
 * the runtime sees is what sits between the delimiters here.
 * @returns {RegExp} A fresh regex, because it is stateful.
 */
function listInterpolationRegex() {
  return /\{%\s*([\s\S]*?)\s*%\}/g;
}

/**
 * Decodes the entities an attribute value carries.
 *
 * The template parser keeps attribute values exactly as written, so a
 * `data-ax-event` payload arrives as `{&quot;click&quot;:&quot;save()&quot;}`.
 * The browser decodes it before the runtime reads it; this does the same so
 * both see the same handler source.
 * @param {string} value - The raw attribute value.
 * @returns {string} The decoded value.
 */
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Adds a candidate expression to a set, ignoring blanks.
 * @param {Set<string>} into - The collecting set.
 * @param {any} source - The candidate text.
 */
function add(into, source) {
  if (typeof source !== 'string') return;
  const trimmed = source.trim();
  if (trimmed === '') return;
  into.add(trimmed);
}

/**
 * Collects the interpolations in a piece of text.
 * @param {Set<string>} into - The collecting set.
 * @param {string} text - Text that may contain `{{ }}` or `{{{ }}}`.
 */
function addInterpolations(into, text) {
  if (typeof text !== 'string' || !text.includes('{{')) return;
  const regex = createInterpolationRegex();
  let match;
  while ((match = regex.exec(text)) !== null) {
    add(into, match[1] !== undefined ? match[1] : match[2]);
  }
}

/**
 * Collects the escaped interpolations in a `<@for>` body.
 * @param {Set<string>} into - The collecting set.
 * @param {string} text - Text that may contain `{% %}`.
 */
function addListInterpolations(into, text) {
  if (typeof text !== 'string' || !text.includes('{%')) return;
  const regex = listInterpolationRegex();
  let match;
  while ((match = regex.exec(text)) !== null) {
    add(into, match[1]);
  }
}

/**
 * Collects the handler bodies out of a `data-ax-event` attribute.
 *
 * The attribute is a JSON object of event name to handler source, written by
 * {@link module:lib/compiler/templateEvents}. A malformed one is skipped: the
 * template validator already reports it, and guessing here would put a wrong
 * key in the table.
 * @param {Set<string>} into - The collecting set.
 * @param {string} value - The attribute value.
 */
function addEventHandlers(into, value) {
  if (typeof value !== 'string' || value.trim() === '') return;
  let parsed;
  try {
    parsed = JSON.parse(decodeEntities(value));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  for (const handler of Object.values(parsed)) {
    add(into, handler);
  }
}

/**
 * Walks a parsed template, collecting expressions and handler statements.
 * @param {object[]} nodes - Parsed template nodes.
 * @param {Set<string>} expressions - Collects value expressions.
 * @param {Set<string>} statements - Collects handler bodies.
 */
function walk(nodes, expressions, statements) {
  for (const node of nodes) {
    if (!node) continue;

    if (node.type === 'text') {
      addInterpolations(expressions, node.content);
      addListInterpolations(expressions, node.content);
      continue;
    }
    if (node.type === 'comment') {
      continue;
    }

    const attrs = node.attrs || {};
    for (const name of EXPRESSION_ATTRIBUTES) {
      if (attrs[name] !== undefined) {
        add(expressions, attrs[name]);
      }
    }
    if (attrs['data-ax-event'] !== undefined) {
      addEventHandlers(statements, attrs['data-ax-event']);
    }

    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('data-props-')) {
        add(expressions, value);
        continue;
      }
      // Any remaining attribute may carry interpolations in its value, and an
      // interpolated attribute *name* is a construct the string renderer
      // resolves, so both sides are scanned.
      addInterpolations(expressions, name);
      addInterpolations(expressions, value);
      addListInterpolations(expressions, value);
    }

    walk(node.children || [], expressions, statements);
  }
}

/**
 * Every expression and handler body a compiled unit will evaluate.
 * @param {object} unit - What the compiler produced for one component or page.
 * @param {string} unit.template - The finished template.
 * @param {Object<string, string>} [unit.computed] - Computed declarations.
 * @param {Object<string, string>} [unit.methods] - Action bodies.
 * @param {Object<string, string>} [unit.resources] - Resource bodies.
 * @param {object} [unit.program] - The render program, when one was compiled.
 * @param {string[]} [unit.voidTags] - Project-specific void tag names.
 * @returns {{expressions: string[], statements: string[]}} The collected sources.
 */
export function collectExpressions(unit) {
  const expressions = new Set();
  const statements = new Set();

  if (typeof unit.template === 'string' && unit.template.trim() !== '') {
    let nodes;
    try {
      nodes = parseHTML(unit.template, unit.voidTags || []);
    } catch {
      // A template that does not parse here is already failing the build
      // elsewhere with a better message. Collecting nothing simply means those
      // expressions stay interpreted, which is the pre-existing behaviour.
      nodes = null;
    }
    if (nodes) {
      walk(nodes, expressions, statements);
    }
  }

  if (unit.computed) {
    for (const definition of Object.values(unit.computed)) {
      add(expressions, definition);
    }
  }

  // Action and resource bodies run through the same statement path an inline
  // handler does, so they belong in the same table. A body using real statement
  // syntax will not compile and is simply left out, which leaves that one
  // action on the existing runtime path.
  for (const source of Object.values(unit.methods || {})) {
    add(statements, source);
  }
  for (const source of Object.values(unit.resources || {})) {
    add(statements, source);
  }

  // The program's ops are the authoritative list for anything the compiled
  // renderer drives, and they are already normalised, so they are taken
  // directly rather than rediscovered from the skeleton.
  if (unit.program && Array.isArray(unit.program.ops)) {
    for (const op of unit.program.ops) {
      add(expressions, op.x);
      if (Array.isArray(op.p)) {
        for (const part of op.p) {
          if (part && typeof part === 'object') {
            add(expressions, part.x);
          }
        }
      }
    }
  }

  return {
    expressions: [...expressions].sort(),
    statements: [...statements].sort(),
  };
}
