/**
 * @file bindingScope.js
 * @description Which scope a piece of DOM was rendered under.
 *
 * ## The problem this solves
 *
 * Most of a component's DOM is rendered against the component's own scope, and
 * an executable binding on it — an event handler, a directive — can be resolved
 * against that scope whenever it fires. Some of it is not. A `<@for>` body is
 * rendered once per item, against a scope carrying that item and its index; a
 * scoped slot is rendered against the props the parent passed. In both cases the
 * text interpolated into the markup was resolved correctly at render time, and
 * the handler *attached* to it was not: handlers are bound in one pass over the
 * component's element, with the component's scope, long after the derived scope
 * that produced the row has gone out of scope in the renderer.
 *
 * The visible result was that `@click="select(item.id)"` — the form the events
 * guide documents — threw `Cannot read property "id" of undefined`, because by
 * the time the click arrived nothing remembered which row it came from.
 *
 * ## What is stored, and where
 *
 * The scope itself, on the root element of the subtree it produced. Resolution
 * walks up from the element the handler is on and takes the nearest one, which
 * gives nesting for free: an inner `<@for>` stamps a scope derived from the
 * outer one, so a handler in the inner row finds the inner scope and reads both
 * loop variables through it.
 *
 * Storing the scope rather than a copy of its bindings is what keeps a reused
 * row correct. The list manager recycles DOM nodes, so the element a handler is
 * attached to may have held a different item a moment ago; re-stamping on every
 * create-or-patch means the answer is always the item the element holds now.
 *
 * ## Why a property rather than a WeakMap
 *
 * A WeakMap keyed by node would be tidier, but resolution walks ancestors on
 * every dispatched event and a property read is the cheaper of the two by
 * enough to matter on a large list. The property is non-enumerable so it does
 * not appear in a serialised node, a diff or a trace.
 * @module lib/core/renderer/bindingScope
 */

/**
 * The property holding a subtree's scope.
 *
 * Named for what it is rather than for the first thing that needed it. Scoped
 * slots got here first and called it `__avenx_slot_scope`; lists, defer blocks
 * and error fallbacks all need exactly the same thing, and a list row carrying
 * something called a slot scope reads as a bug to whoever finds it next.
 * @type {string}
 */
const SCOPE_PROPERTY = '__avenx_binding_scope';

/**
 * Records the scope a subtree was rendered under.
 *
 * Safe to call repeatedly on the same node: a recycled list row is re-stamped
 * with the item it now holds.
 * @param {Node} node - The root of the rendered subtree.
 * @param {object|null} scope - The scope it was rendered against.
 * @returns {Node} The node, for chaining.
 */
export function stampScope(node, scope) {
  if (!node || node.nodeType !== 1 || !scope) {
    return node;
  }
  Object.defineProperty(node, SCOPE_PROPERTY, {
    value: scope,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return node;
}

/**
 * Removes a scope stamp.
 *
 * Called when a node is returned to the list manager's pool, so a pooled node
 * cannot hand a stale item to anything that reads it before it is re-stamped.
 * @param {Node} node - The node to clear.
 */
export function clearScope(node) {
  if (node && node.nodeType === 1 && Object.prototype.hasOwnProperty.call(node, SCOPE_PROPERTY)) {
    delete node[SCOPE_PROPERTY];
  }
}

/**
 * The scope an element's bindings should resolve against.
 *
 * Walks ancestors and returns the nearest stamp, so the innermost enclosing
 * derived scope wins. Returns null when the element sits in ordinary component
 * DOM, which means "resolve against the component scope" to every caller.
 * @param {Node|null} node - Where to start looking.
 * @returns {object|null} The nearest enclosing scope, or null.
 */
export function findScope(node) {
  let current = node;
  while (current) {
    const scope = current[SCOPE_PROPERTY];
    if (scope) {
      return scope;
    }
    current = current.parentNode;
  }
  return null;
}
