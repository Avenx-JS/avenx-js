/**
 * @file bindings.js
 * @description What each render-program op does to the DOM.
 *
 * One function per op kind, each writing to exactly one node. These are the
 * leaves of the new architecture: everything above them exists to arrange for
 * the right one of these to run with the right value, and nothing below them
 * touches the DOM.
 *
 * ## Matching the string renderer's semantics
 *
 * These replace a pipeline that escaped a value into HTML, parsed that HTML,
 * and diffed the result into the document. Anything the round trip did
 * incidentally is behaviour applications now depend on, so it is reproduced
 * here deliberately rather than rediscovered as a bug report:
 *
 * - **Escaping.** The old path escaped a value and the parser unescaped it, so
 *   the text that reached the document was the value verbatim. Writing
 *   `node.data` directly produces the same string and cannot be mis-escaped,
 *   because it never becomes markup at all.
 * - **`null` renders as nothing**, not as the string "null".
 * - **`SafeHtml` in a `{{ }}` interpolation is inserted as markup.** The old
 *   path skipped escaping for it; a text write would have shown the tags. Text
 *   ops therefore check for it and hand over to the raw path.
 * - **Boolean attributes.** `disabled="false"` removed the attribute and set
 *   the property; anything else set both.
 * - **URL attributes** were sanitised on every parsed tree, so they are
 *   sanitised on every write here.
 *
 * ## Where the security boundary sits
 *
 * Nowhere in this file is a value turned into markup unless the op is `raw` or
 * the value is a `SafeHtml` -- the same two doors the string renderer had, and
 * no new ones. Expressions are still evaluated by the AST evaluator through the
 * callback these functions are given; this module receives values, never source.
 * @module lib/core/renderer/program/bindings
 */

import { isBooleanAttribute } from '../constants.js';
import { HtmlEscaper, SafeHtml } from '../../security/escapeHtml.js';
import { sanitizeUrlAttribute, isUrlAttribute } from '../../security/urlPolicy.js';
import { tracer } from '../../trace/tracer.js';
import { traceDomOp, clampDomValue } from '../../trace/dom.js';
import { logger } from '../../runtime/AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../../runtime/AvenxError.js';

/**
 * The escaper the string renderer used, reused rather than reimplemented.
 *
 * `data-ax-html` escapes a plain value and only lets a `SafeHtml` through. A
 * second escaping implementation here could drift from that one, and the
 * direction it would drift in is "escapes less".
 * @type {HtmlEscaper}
 */
const escaper = new HtmlEscaper();

/**
 * Values that mean "this boolean attribute is off".
 *
 * Deliberately not JavaScript falsiness. The string renderer decided by looking
 * at the rendered attribute text, where the only off value was the literal
 * "false" -- so `0` was on. Matching that keeps `disabled="{{ count }}"` behaving
 * as it does today. Empty and null are added because they reached the old path
 * as an empty attribute value, which read as *on*: an attribute bound to
 * nothing being present is a bug rather than a semantic worth carrying forward.
 * @param {any} value - The evaluated value.
 * @returns {boolean} True when the attribute should be absent.
 */
function isBooleanOff(value) {
  return value === false || value === 'false' || value === null || value === undefined || value === '';
}

/**
 * Converts an evaluated value to the text it renders as.
 * @param {any} value - The evaluated value.
 * @returns {string} The text, with null and undefined rendering as nothing.
 */
function asText(value) {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Writes a value into a dynamic text node.
 * @param {Text} node - The text node the compiler reserved.
 * @param {any} value - The evaluated value.
 * @param {object} binding - Per-binding state, used to manage raw ranges.
 */
export function applyText(node, value, binding) {
  if (value instanceof SafeHtml) {
    applyRaw(node, value, binding);
    return;
  }

  // A binding that previously held raw markup and now holds text has to clear
  // the nodes it inserted, or the old markup would sit beside the new text.
  if (binding.rawNodes) {
    clearRawRange(binding);
  }

  const next = asText(value);
  if (node.data === next) {
    return;
  }
  const previous = node.data;
  node.data = next;

  if (tracer.on) {
    traceDomOp('text', node, { from: clampDomValue(previous), to: clampDomValue(next) });
  }
}

/**
 * Replaces the markup a raw binding owns.
 *
 * A raw binding owns a *range* rather than a node: one expression can produce
 * any number of elements. The compiler's text marker stays in the document as
 * an anchor, and the nodes the binding inserted are tracked so the next
 * evaluation can remove exactly those and nothing else. Clearing by emptying
 * the parent would take siblings that belong to other bindings.
 * @param {Text} anchor - The anchor node the compiler reserved.
 * @param {any} value - The evaluated value.
 * @param {object} binding - Per-binding state holding the current range.
 */
export function applyRaw(anchor, value, binding) {
  const markup = value === null || value === undefined ? '' : String(value);
  if (binding.rawHtml === markup) {
    return;
  }
  binding.rawHtml = markup;

  clearRawRange(binding);

  const parent = anchor.parentNode;
  if (!parent || markup === '') {
    return;
  }

  const host = document.createElement('template');
  let source;
  if (host && 'content' in host) {
    host.innerHTML = markup;
    source = host.content;
  } else {
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    source = holder;
  }

  // Collected first, then inserted in order after the anchor. Inserting
  // straight from the fragment would work too, but reading `firstChild` while
  // mutating the same list is the shape that produces reversed output when the
  // insertion point is recomputed, and this is not the place to be clever.
  const inserted = [];
  while (source.firstChild) {
    inserted.push(source.removeChild(source.firstChild));
  }

  let cursor = anchor;
  for (const node of inserted) {
    parent.insertBefore(node, cursor.nextSibling);
    cursor = node;
  }

  binding.rawNodes = inserted;
  if (tracer.on) {
    traceDomOp('html', anchor, { to: clampDomValue(markup) });
  }
}

/**
 * Removes the nodes a raw binding previously inserted.
 * @param {object} binding - Per-binding state.
 */
function clearRawRange(binding) {
  if (!binding.rawNodes) return;
  for (const node of binding.rawNodes) {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
  binding.rawNodes = null;
}

/**
 * Sets an attribute from a whole-value expression.
 * @param {Element} element - The bound element.
 * @param {string} name - The attribute name.
 * @param {any} value - The evaluated value.
 */
export function applyAttribute(element, name, value) {
  if (value === null || value === undefined || value === false) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
    return;
  }

  const raw = value === true ? 'true' : String(value);
  const next = isUrlAttribute(name) ? sanitizeUrlAttribute(name, raw) : raw;

  if (element.getAttribute(name) === next) {
    return;
  }
  element.setAttribute(name, next);

  if (tracer.on) {
    traceDomOp('attr', element, { name, to: clampDomValue(next) });
  }
}

/**
 * Sets an attribute assembled from literal and expression parts.
 * @param {Element} element - The bound element.
 * @param {string} name - The attribute name.
 * @param {string} value - The already-joined value.
 */
export function applyAttributeParts(element, name, value) {
  const next = isUrlAttribute(name) ? sanitizeUrlAttribute(name, value) : value;
  if (element.getAttribute(name) === next) {
    return;
  }
  element.setAttribute(name, next);

  if (tracer.on) {
    traceDomOp('attr', element, { name, to: clampDomValue(next) });
  }
}

/**
 * Sets or removes a boolean attribute, and mirrors it onto the property.
 * @param {Element} element - The bound element.
 * @param {string} name - The attribute name.
 * @param {any} value - The evaluated value.
 */
export function applyBoolean(element, name, value) {
  const off = isBooleanOff(value);

  if (off) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  } else if (element.getAttribute(name) !== 'true') {
    element.setAttribute(name, 'true');
  }

  // The property is what the browser acts on; the attribute is what a test or
  // a stylesheet reads. The string renderer set both, so both are set here.
  if (isBooleanAttribute(name)) {
    element[name] = !off;
  }

  if (tracer.on) {
    traceDomOp('attr', element, { name, to: off ? null : 'true' });
  }
}

/**
 * Toggles an element's visibility, preserving its authored display value.
 * @param {Element} element - The bound element.
 * @param {any} value - The evaluated value; truthiness decides.
 * @param {object} binding - Per-binding state, holding the authored display.
 */
export function applyShow(element, value, binding) {
  const visible = !!value;

  if (binding.originalDisplay === undefined) {
    // Read once, before the first hide, so a later show restores what the
    // author wrote rather than the empty string a hidden element reports.
    binding.originalDisplay = (element.style && element.style.display) || '';
    element.__originalDisplay = binding.originalDisplay;
  }

  const next = visible ? binding.originalDisplay : 'none';
  if (element.style && element.style.display !== next) {
    element.style.display = next;
  }
}

/**
 * Applies a class binding, removing only the classes it previously added.
 * @param {Element} element - The bound element.
 * @param {any} value - A string of class names, or an object of name to flag.
 * @param {object} binding - Per-binding state, holding the previous class list.
 */
export function applyClass(element, value, binding) {
  const next = [];
  if (typeof value === 'string') {
    for (const name of value.split(/\s+/)) {
      if (name) next.push(name);
    }
  } else if (value && typeof value === 'object') {
    for (const [name, enabled] of Object.entries(value)) {
      if (enabled) next.push(name);
    }
  }

  const previous = binding.classes || [];

  // Remove only what this binding added. The element's authored classes and the
  // component's scoped class share the same attribute and must survive.
  for (const name of previous) {
    if (!next.includes(name)) {
      element.classList.remove(name);
    }
  }
  for (const name of next) {
    if (!previous.includes(name)) {
      element.classList.add(name);
    }
  }

  binding.classes = next;
  element.__lastAxClasses = next;
}

/**
 * Replaces an element's inner HTML from an expression.
 * @param {Element} element - The bound element.
 * @param {any} value - The evaluated value.
 */
export function applyHtml(element, value) {
  let markup;
  if (value instanceof SafeHtml) {
    markup = String(value);
  } else if (value === null || value === undefined) {
    markup = '';
  } else {
    // Matches the string renderer: a plain value in `data-ax-html` is escaped,
    // so only a SafeHtml can introduce markup. Removing that check would turn
    // every `data-ax-html` in every application into an injection point.
    markup = escaper.escape(value);
  }

  if (element.innerHTML !== markup) {
    element.innerHTML = markup;
  }
}

/**
 * Reports a binding that threw, without taking the rest of the update with it.
 * @param {object} op - The op that failed.
 * @param {Error} error - What went wrong.
 */
export function reportBindingError(op, error) {
  logger.warn(formatMessage(AvenxErrorCodes.TEMPLATE_RENDER_ERROR, op.x || op.a || op.k, error));
}
