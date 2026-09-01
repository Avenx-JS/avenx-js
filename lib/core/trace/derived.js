/**
 * @file derived.js
 * @description Trace hooks for derived values — computed properties and
 * bridge getters.
 *
 * Derived values are read far more often than they change. A component's
 * template may read `cart.total` on every render, and a bridge getter is
 * re-evaluated on every access because it has no cache of its own. Recording
 * every evaluation would bury the causal graph under noise that says nothing.
 *
 * So a derived value is recorded only when its result actually changed, which
 * is the only form in which it explains anything: `cart.total 24.00 → 36.00` is
 * a step in the causal chain, while `cart.total read` is not.
 * @module lib/core/trace/derived
 */

import { tracer } from './tracer.js';
import { TraceNodeType } from './schema.js';

/**
 * Last recorded value per derived key, so a re-evaluation that produced the
 * same answer can be dropped.
 *
 * Keyed by owner object so entries disappear with the component or bridge they
 * belong to, and populated only while a recording is running.
 * @type {WeakMap<object, Map<string, any>>}
 */
const lastValues = new WeakMap();

/**
 * Compares two derived results.
 *
 * Deliberately reference equality with a NaN special case, not a deep compare:
 * a deep compare on every evaluation of every computed would cost more than
 * the tracing it serves. A computed returning a fresh object each time is
 * therefore recorded on every evaluation, which is accurate — it did produce a
 * new value, and that is usually worth seeing.
 * @param {any} a - Previous value.
 * @param {any} b - Current value.
 * @returns {boolean} True when the value is unchanged.
 */
function unchanged(a, b) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Records that a derived value was re-evaluated and produced a new result.
 * @param {object} owner - The component or bridge that owns the value.
 * @param {object} descriptor - What was evaluated.
 * @param {string} descriptor.name - The computed or getter name.
 * @param {string} [descriptor.kind] - `computed` for a component, `getter` for a bridge.
 * @param {string} [descriptor.owner] - The owning component or bridge name.
 * @param {string} [descriptor.expression] - The expression source, when Avenx has it.
 * @param {string[]} [descriptor.contracts] - Compiler contracts the owner declared.
 * @param {any} value - The value the evaluation produced.
 * @param {object} [known] - The caller's own record of the previous value.
 * @param {boolean} known.has - Whether the caller knows the previous value.
 * @param {any} known.value - The previous value.
 */
export function traceDerived(owner, descriptor, value, known) {
  const recorder = tracer.sink;
  if (!recorder) {
    return;
  }

  let seen = lastValues.get(owner);
  if (!seen) {
    seen = new Map();
    lastValues.set(owner, seen);
  }

  // A component's computed already has a cached previous value in its watcher,
  // and the caller passes it in. Without that, the first evaluation inside a
  // recording would only be able to establish a baseline — and the very first
  // change after recording started, which is usually the interesting one,
  // would go unreported.
  const had = known && known.has ? true : seen.has(descriptor.name);
  const previous = known && known.has ? known.value : seen.get(descriptor.name);
  seen.set(descriptor.name, value);

  // Where no previous value is knowable, the first evaluation establishes a
  // baseline rather than reporting a change: "undefined -> 24" on first render
  // is an artefact of when recording started, not something that happened.
  if (!had || unchanged(previous, value)) {
    return;
  }

  const path = descriptor.owner ? `${descriptor.owner}.${descriptor.name}` : descriptor.name;
  const kind = descriptor.kind || 'computed';

  tracer.record(TraceNodeType.COMPUTED, {
    name: descriptor.name,
    kind,
    // A bridge getter's owner is a bridge, not a component. Recording it in the
    // component slot would inflate the component count in a listing and make
    // `avenx trace view` claim a bridge is a component.
    ...(kind === 'getter' ? { bridge: descriptor.owner } : { component: descriptor.owner }),
    expression: descriptor.expression,
    contracts: descriptor.contracts,
    from: recorder.capture(previous, path),
    to: recorder.capture(value, path),
  });
}

/**
 * Forgets the baseline values for an owner.
 *
 * Called when a recording stops so a later recording of the same long-lived
 * bridge starts from a clean baseline rather than comparing against values
 * observed in a previous session.
 * @param {object} owner - The component or bridge.
 */
export function forgetDerived(owner) {
  lastValues.delete(owner);
}
