/**
 * @file dom.js
 * @description Stable, replayable descriptions of DOM nodes.
 *
 * A trace refers to elements in two very different situations: when a human
 * reads `avenx trace view` and wants to recognise the button they clicked, and
 * when replay has to find that same button again in a freshly mounted
 * application. The second requirement is the strict one — a description that
 * reads well but cannot be resolved makes a trace unreplayable.
 *
 * So every reference carries both a selector and the node's index among that
 * selector's matches. Replay can then resolve `button.qty-inc` unambiguously
 * even when the page has twelve of them, without depending on ids the
 * application does not have.
 * @module lib/core/trace/dom
 */

import { tracer } from './tracer.js';
import { TraceNodeType } from './schema.js';

/**
 * How many class names are folded into a selector.
 *
 * Scoped-CSS class hashes make Avenx elements class-heavy; taking every class
 * would produce selectors that are long to read and brittle against an
 * unrelated style change.
 * @type {number}
 */
const MAX_SELECTOR_CLASSES = 2;

/**
 * Attributes Avenx adds for its own bookkeeping, which must never end up in a
 * selector: they are re-derived on every render and would not survive replay.
 * @type {RegExp}
 */
const INTERNAL_ATTR = /^(data-ax-|data-avenx-)/;

/**
 * How much of a changed attribute or text value a trace keeps.
 * @type {number}
 */
const MAX_DOM_VALUE = 120;

/**
 * Builds a CSS selector for an element.
 * @param {Element} el - The element.
 * @returns {string} A selector, or the tag name when nothing else is available.
 */
function selectorFor(el) {
  const tag = (el.tagName || 'unknown').toLowerCase();

  if (el.id && !INTERNAL_ATTR.test(el.id)) {
    return `#${el.id}`;
  }

  const className = typeof el.className === 'string' ? el.className : '';
  const classes = className
    .split(/\s+/)
    .filter((name) => name && !INTERNAL_ATTR.test(name))
    .slice(0, MAX_SELECTOR_CLASSES);

  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

/**
 * Finds the Avenx component instance an element belongs to.
 * @param {Node|null} node - The starting node.
 * @returns {object|null} The owning component instance, if any.
 */
export function ownerComponent(node) {
  let current = node;
  while (current) {
    if (current.__avenx_comp_instance) {
      return current.__avenx_comp_instance;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Describes a DOM node well enough to display it and to find it again.
 * @param {Node|null} node - The node to describe.
 * @returns {{selector: string, nth: number, component: string, uid: number}|null}
 *   A reference, or null when there is no element to describe.
 */
export function describeNode(node) {
  if (!node) {
    return null;
  }

  // Text nodes are addressed through the element that contains them: a text
  // node has no selector of its own, and the containing element is what a
  // reader recognises anyway.
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!el || el.nodeType !== 1) {
    return null;
  }

  const selector = selectorFor(el);
  let nth = 0;

  // The index disambiguates the selector. A missing document (a detached
  // subtree, a headless mount) simply yields index 0, which resolve() below
  // treats as "the first match".
  try {
    const root = el.ownerDocument;
    if (root && typeof root.querySelectorAll === 'function') {
      const matches = root.querySelectorAll(selector);
      for (let i = 0; i < matches.length; i++) {
        if (matches[i] === el) {
          nth = i;
          break;
        }
      }
    }
  } catch {
    // An exotic selector (an id starting with a digit, for instance) can make
    // querySelectorAll throw. Falling back to index 0 keeps the description
    // usable for display even when it is not precise enough to replay.
  }

  const ref = { selector, nth };
  const owner = ownerComponent(el);
  if (owner) {
    ref.component = owner.constructor && owner.constructor.name;
    ref.uid = owner.uid;
  }
  return ref;
}

/**
 * Resolves a reference produced by {@link describeNode} back to an element.
 * @param {object|null} ref - The reference.
 * @param {Document|Element} [root] - Where to search. Defaults to the document.
 * @returns {Element|null} The element, or null when it cannot be found.
 */
export function resolveNode(ref, root) {
  if (!ref || !ref.selector) {
    return null;
  }
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return null;
  }
  try {
    const matches = scope.querySelectorAll(ref.selector);
    return matches[ref.nth || 0] || null;
  } catch {
    return null;
  }
}

/**
 * Records a DOM mutation the patcher applied, attributed to whatever caused it.
 *
 * Called from the existing patch operations rather than from a second diffing
 * pass or a MutationObserver: the point of the trace is to say which *state
 * change* produced a DOM change, and only the patcher knows both halves.
 *
 * Values are truncated. A trace records that `.total` went from `"$24.00"` to
 * `"$36.00"`, not the innerHTML of the subtree around it.
 * @param {string} op - The operation: `text`, `attr`, `remove-attr`, `insert`, `remove`, `replace`.
 * @param {Node} node - The node that changed, or its parent for structural ops.
 * @param {object} [fields] - Operation-specific detail (`name`, `from`, `to`).
 */
export function traceDomOp(op, node, fields = {}) {
  if (!tracer.sink) {
    return;
  }
  const ref = describeNode(node);
  if (!ref) {
    return;
  }
  tracer.record(TraceNodeType.DOM, {
    op,
    target: { selector: ref.selector, nth: ref.nth },
    component: ref.component,
    ...fields,
  });
}

/**
 * Clamps a DOM value so a trace records the change rather than the document.
 * @param {any} value - The raw attribute or text value.
 * @returns {string|null} A bounded string, or null for an absent value.
 */
export function clampDomValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value);
  return text.length > MAX_DOM_VALUE ? `${text.slice(0, MAX_DOM_VALUE)}…` : text;
}

/**
 * Renders a node reference for display in `avenx trace view`.
 * @param {object|null} ref - The reference.
 * @returns {string} A short human-readable form.
 */
export function formatNodeRef(ref) {
  if (!ref || !ref.selector) {
    return '<unknown>';
  }
  const suffix = ref.nth > 0 ? `[${ref.nth}]` : '';
  return `<${ref.selector}${suffix}>`;
}
