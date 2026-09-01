/**
 * @file reactive.js
 * @description Trace hooks for the reactive system.
 *
 * Two things are recorded here, and the split matters:
 *
 * - A **write** is a logical mutation: one property, at one path, changing
 *   from one value to another. It is recorded in the proxy traps, where the
 *   mutation actually happens, rather than in `trigger()` — `trigger` walks up
 *   the `parentMap` re-firing itself for every ancestor, so recording there
 *   would log one write per level of nesting for a single assignment.
 *
 * - A **watcher wake** is a consequence of a write. It is recorded in
 *   `trigger()`, inside the write's causal scope, which is what produces
 *   "cart.items.2.qty changed, and that woke CartItem#3's render".
 *
 * Placing this in its own module rather than inlining it in `proxyHandler.js`
 * keeps `capture` and `recorder` out of the reactive system's import graph
 * from the reactive side, so the dependency runs one way only.
 * @module lib/core/trace/reactive
 */

import { getPropertyPath } from '../reactive/watcher.js';
import { tracer } from './tracer.js';
import { TraceNodeType } from './schema.js';

/**
 * Opens a write node and makes it the causal parent of the reactive work the
 * caller is about to trigger.
 *
 * Callers must guard with `tracer.on` and must pass the returned token to
 * `tracer.leave()` in a `finally`.
 * @param {object} target - The raw object that was mutated.
 * @param {string|symbol} key - The mutated key.
 * @param {any} oldValue - The value before the mutation.
 * @param {any} newValue - The value after the mutation.
 * @param {string} [op] - What kind of mutation this was, when it was not a plain assignment.
 * @returns {number} A restore token for `tracer.leave`, or -1 when tracing is off.
 */
export function traceWrite(target, key, oldValue, newValue, op) {
  const recorder = tracer.sink;
  if (!recorder) {
    return -1;
  }

  const path = getPropertyPath(target, key);
  const node = {
    path,
    from: recorder.capture(oldValue, path),
    to: recorder.capture(newValue, path),
  };
  if (op) {
    node.op = op;
  }
  return tracer.enter(TraceNodeType.WRITE, node);
}

/**
 * Opens a write node for a mutation whose before/after values are not a single
 * pair — an array method, a `Map.clear()`, a `Set.add()`.
 *
 * The collection's size is recorded instead of its contents: capturing a whole
 * array on every `push` would make tracing a list quadratic.
 * @param {object} target - The raw collection.
 * @param {string|symbol} key - The method or key that changed.
 * @param {string} op - The operation name, e.g. `push` or `clear`.
 * @param {number} [size] - The collection's size after the mutation.
 * @returns {number} A restore token for `tracer.leave`, or -1 when tracing is off.
 */
export function traceCollectionWrite(target, key, op, size) {
  if (!tracer.sink) {
    return -1;
  }
  const path = getPropertyPath(target, typeof key === 'symbol' ? undefined : key);
  return tracer.enter(TraceNodeType.WRITE, { path, op, size });
}

/**
 * Opens a watcher node for a watcher about to re-run because of a write.
 *
 * Named watchers carry their own identity (`CartItem#render`, `Resource#users`,
 * a computed key); anonymous ones are still worth recording, because the shape
 * of the propagation is the answer to "why did this update".
 * @param {object} watcher - The `AvenxWatcher` about to run.
 * @returns {number} A restore token for `tracer.leave`, or -1 when tracing is off.
 */
export function traceWatcher(watcher) {
  if (!tracer.sink) {
    return -1;
  }
  const name = (watcher && watcher.name) || 'anonymous';
  const node = { name };

  // `Component#render` is the single most common watcher and the one a reader
  // most wants to see attributed, so its component is lifted out of the name.
  const renderMatch = /^(.+)#render$/.exec(name);
  if (renderMatch) {
    node.kind = 'render';
    node.component = renderMatch[1];
  } else if (watcher && watcher.options && watcher.options.isComputed) {
    node.kind = 'computed';
  } else {
    node.kind = watcher && watcher.isEffect ? 'effect' : 'watch';
  }

  return tracer.enter(TraceNodeType.WATCHER, node);
}
