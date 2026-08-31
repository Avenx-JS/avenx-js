/**
 * @file atomic.js
 * @description The `atomic()` marker for bridge actions.
 *
 * A component declares a transaction in its template — `<action name="inc"
 * atomic>` — because that is where its actions are declared. A bridge is an
 * ordinary ES module, so there is no attribute to hang the declaration on and
 * it takes a wrapper instead:
 *
 *   import { bridge, atomic } from 'avenx-core/runtime';
 *
 *   export default bridge({
 *     state: { items: [] },
 *     addQty: atomic(function (id, n) { ... }),
 *   });
 *
 * The wrapper does two jobs at once. At runtime it marks the function so the
 * Bridge factory knows to run it inside a transaction. At compile time it is
 * the syntax `BridgeParser` recognises, which is what puts the action's write
 * set into Atlas and its effects into the AVX_W43 report.
 *
 * It returns the same function rather than a new one, so a bridge action keeps
 * its name, its arity and its identity — a wrapper that changed any of those
 * would show up in stack traces and in `fn.length` checks for no reason.
 * @module lib/core/runtime/atomic
 */

import { AvenxError, AvenxErrorCodes } from './AvenxError.js';

/**
 * Marks a bridge action as transactional.
 *
 * A symbol keeps the mark out of the member namespace that `ownKeys` and
 * template scopes see.
 * @type {symbol}
 */
export const ATOMIC_MARK = Symbol.for('avenx.atomic');

/**
 * Declares a bridge action transactional.
 *
 * Every state write the action makes — its own and those of anything it calls
 * — is journaled. If the action throws, or returns a promise that rejects,
 * the journal is played backwards and the state is what it was before the
 * action ran.
 * @template {Function} T
 * @param {T} fn - The action implementation.
 * @param {object} [options] - Transaction options.
 * @param {'safe'|'force'|'abort'} [options.onConflict] - What a rewind does
 *   when it finds a value this transaction did not write. Defaults to the
 *   project's `rewind.onConflict`.
 * @returns {T} The same function, marked.
 * @throws {AvenxError} When given something that is not a function.
 */
export function atomic(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new AvenxError(
      AvenxErrorCodes.BRIDGE_INVALID_MEMBER,
      'atomic()',
      fn === null ? 'null' : typeof fn,
      'atomic',
    );
  }
  Object.defineProperty(fn, ATOMIC_MARK, {
    value: { onConflict: options.onConflict },
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return fn;
}

/**
 * Reads the transaction options off a marked function.
 * @param {Function} fn - A possible atomic action.
 * @returns {{onConflict: string=}|null} Its options, or null when unmarked.
 */
export function atomicOptions(fn) {
  return (typeof fn === 'function' && fn[ATOMIC_MARK]) || null;
}

/**
 * Whether a function was declared atomic.
 * @param {Function} fn - A possible atomic action.
 * @returns {boolean} True when the function carries the mark.
 */
export function isAtomic(fn) {
  return atomicOptions(fn) !== null;
}
