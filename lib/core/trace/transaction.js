/**
 * @file transaction.js
 * @description Trace hooks for Avenx Rewind.
 *
 * A value that changes back on its own is the single most confusing thing a
 * trace can contain. Without a node for it, a rewind shows up as a run of
 * writes with no cause — exactly the situation Trace exists to eliminate.
 *
 * The node is opened *around* the rewind, so every restoring write lands
 * underneath it as an ordinary write and the causal tree reads:
 *
 *   ▸ click <button.qty-inc> CartItem
 *     └─ action CartItem.incQty()
 *        └─ rewind CartItem.incQty — 3 restored  [safe]
 *           ├─ write cart.items.0.qty 2 → 1
 *           └─ write CartItem.busy true → false
 *
 * Kept out of `journal.js` for the same reason `trace/reactive.js` is kept out
 * of `proxyHandler.js`: the reactive system should not import the recorder.
 * @module lib/core/trace/transaction
 */

import { tracer } from './tracer.js';
import { TraceNodeType } from './schema.js';

/**
 * Opens a rewind node and makes it the causal parent of the restoring writes.
 *
 * Callers must guard with `tracer.on` and pass the returned token to
 * `tracer.leave()` in a `finally`.
 * @param {object} frame - The journal frame about to be played backwards.
 * @returns {{token: number, id: number|null}} The restore token for
 *   `tracer.leave`, and the node's id so the outcome can be filled in later.
 *   `{token: -1, id: null}` when tracing is off.
 */
export function traceRewindStart(frame) {
  if (!tracer.sink) {
    return { token: -1, id: null };
  }
  const token = tracer.enter(TraceNodeType.REWIND, {
    action: frame.owner ? `${frame.owner}.${frame.name}` : frame.name,
    policy: frame.onConflict,
    // Filled in by `traceRewindOutcome` once the rewind has run: the counts
    // are not known until it has, and the node has to exist first so the
    // restoring writes are recorded underneath it.
    restored: 0,
    conflicts: 0,
  });
  return { token, id: tracer.current() };
}

/**
 * Records what the rewind managed to do, on the node opened for it.
 * @param {number|null} id - The node id `traceRewindStart` returned.
 * @param {object} outcome - What `JournalFrame#rewind` reported.
 * @returns {void}
 */
export function traceRewindOutcome(id, outcome) {
  if (id === null || !tracer.sink || typeof tracer.sink.annotate !== 'function') {
    return;
  }
  tracer.sink.annotate(id, {
    restored: outcome.restored,
    conflicts: outcome.conflicts.length,
    ...(outcome.conflicts.length > 0
      ? { conflictPaths: outcome.conflicts.map((conflict) => conflict.path) }
      : {}),
    ...(outcome.unrewindable.length > 0 ? { unrewindable: outcome.unrewindable } : {}),
  });
}
