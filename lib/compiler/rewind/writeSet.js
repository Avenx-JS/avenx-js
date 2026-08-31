/**
 * @file writeSet.js
 * @description What an atomic action writes, and whether that answer is complete.
 *
 * The journal does not need this. It observes the reactive proxies, so it sees
 * every write an action makes whether or not anything predicted it. What needs
 * this is the *report*: the developer asking "if this rolls back, what comes
 * back with it?" — and, more sharply, "what does not?"
 *
 * The walk is over the model Atlas already built. An action's own `writes`
 * edges are the first hop; every `invokes` edge to another action contributes
 * that action's write set in turn, which is how a component action that calls
 * `cart.addQty()` is credited with the bridge state that call touches.
 *
 * ## The completeness rule
 *
 * A write set is **bounded** only when nothing in its closure was left
 * unresolved for a reason that could be hiding a write. That flag is not
 * decoration: AVX_W44 compares two write sets, and comparing an incomplete one
 * would produce a warning that is a false positive and a false negative at the
 * same time. Anything unbounded is excluded from that comparison and reported
 * under AVX_W42 instead.
 * @module lib/compiler/rewind/writeSet
 */

import { AtlasEdgeKind, AtlasNodeKind, UnresolvedReason } from '../atlas/AppModel.js';

/**
 * Unresolved reasons that could be concealing a write.
 *
 * Deliberately the same list `atlas/diagnostics.js` blocks on, for the same
 * reason: a dynamic member could be the write, a shadowed identifier means a
 * body was not followed, a spread could carry a value out, and an unknown
 * identifier could be the missing link. None can be ruled out.
 * @type {Set<string>}
 */
const BLOCKING_REASONS = new Set([
  UnresolvedReason.DYNAMIC_MEMBER,
  UnresolvedReason.SHADOWED_IDENTIFIER,
  UnresolvedReason.SPREAD,
  UnresolvedReason.UNKNOWN_IDENTIFIER,
  UnresolvedReason.DYNAMIC_INVOCATION,
  UnresolvedReason.SLOT_SCOPE,
]);

/**
 * How many `invokes` hops the closure follows.
 *
 * Deep enough for a component action calling a bridge action that calls
 * another, which is as far as an Avenx application usually reaches, and
 * bounded so a pathological graph cannot make a build slow. Running out of
 * depth makes the write set unbounded rather than silently short.
 * @type {number}
 */
export const MAX_INVOKE_DEPTH = 6;

/**
 * Renders one write as the string the reports and the overlap check compare.
 * @param {object} model - The model.
 * @param {object} edge - A `writes` edge.
 * @returns {string} A readable target, e.g. `cart.items[].qty`.
 */
function writeTarget(model, edge) {
  const node = model.getNode(edge.to);
  if (!node) return edge.to;
  const owner = node.owner ? model.getNode(node.owner) : null;
  const base = owner ? `${owner.name}.${node.name}` : node.name;
  if (!edge.path) return base;
  // `formatPath` yields `[].qty` for an element member, which reads as part of
  // the path rather than a separate word.
  return edge.path.startsWith('[') ? `${base}${edge.path}` : `${base}.${edge.path}`;
}

/**
 * Computes what one action writes, following the actions it invokes.
 * @param {object} model - The finished AppModel.
 * @param {string} actionId - The action's node id.
 * @returns {{writes: string[], bounded: boolean, reasons: Array<{reason: string, expr: string=, owner: string, loc: object=}>, depthExceeded: boolean}}
 *   The write set, whether it is complete, and why it is not when it is not.
 */
export function computeWriteSet(model, actionId) {
  /** @type {Set<string>} */
  const writes = new Set();
  /** @type {Array<object>} */
  const reasons = [];
  const seen = new Set();
  let depthExceeded = false;

  /**
   * Walks one action.
   * @param {string} id - The action node id.
   * @param {number} depth - Remaining hops.
   * @returns {void}
   */
  const visit = (id, depth) => {
    if (seen.has(id)) return;
    seen.add(id);

    if (depth <= 0) {
      depthExceeded = true;
      return;
    }

    for (const entry of model.unresolvedFor(id)) {
      if (BLOCKING_REASONS.has(entry.reason)) {
        reasons.push(entry);
      }
    }

    for (const edge of model.outgoing(id)) {
      if (edge.kind === AtlasEdgeKind.WRITES) {
        writes.add(writeTarget(model, edge));
        continue;
      }
      if (edge.kind === AtlasEdgeKind.INVOKES) {
        const target = model.getNode(edge.to);
        if (target && target.kind === AtlasNodeKind.ACTION) {
          visit(edge.to, depth - 1);
        }
      }
    }
  };

  visit(actionId, MAX_INVOKE_DEPTH);

  // A write set is only as complete as the analysis behind it. A deferred
  // write — one made inside a `.then()` — is a completeness problem too: the
  // journal never sees it, so it is not in the set and never will be.
  const node = model.getNode(actionId);
  const deferred = (node && node.deferred) || [];

  return {
    writes: [...writes].sort(),
    bounded: reasons.length === 0 && !depthExceeded && deferred.length === 0,
    reasons,
    depthExceeded,
  };
}

/**
 * Whether one action can reach another by invoking it.
 *
 * Used to keep AVX_W44 off a caller and its callee. Their write sets overlap
 * by construction — the caller's set *contains* the callee's — and they cannot
 * interleave harmfully, because a nested transaction joins the enclosing frame
 * rather than opening a second one. Warning about that pair would report the
 * feature working as designed.
 * @param {object} model - The finished AppModel.
 * @param {string} fromId - The possible caller.
 * @param {string} toId - The possible callee.
 * @returns {boolean} True when `fromId` reaches `toId`.
 */
export function invokes(model, fromId, toId) {
  const seen = new Set();
  const queue = [fromId];
  let hops = 0;
  while (queue.length > 0 && hops <= MAX_INVOKE_DEPTH) {
    const size = queue.length;
    for (let i = 0; i < size; i++) {
      const current = queue.shift();
      if (current === toId && current !== fromId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of model.outgoing(current)) {
        if (edge.kind !== AtlasEdgeKind.INVOKES) continue;
        if (edge.to === toId) return true;
        queue.push(edge.to);
      }
    }
    hops++;
  }
  return false;
}

/**
 * Finds every atomic action in the model, with its write set.
 * @param {object} model - The finished AppModel.
 * @returns {Array<{node: object, label: string, writes: string[], bounded: boolean, reasons: object[], depthExceeded: boolean}>}
 *   One entry per atomic action, ordered by node id.
 */
export function collectAtomicActions(model) {
  const results = [];
  for (const node of model.nodesOfKind(AtlasNodeKind.ACTION)) {
    if (!node.atomic) continue;
    const owner = node.owner ? model.getNode(node.owner) : null;
    results.push({
      node,
      label: owner ? `${owner.name}.${node.name}` : node.name,
      ...computeWriteSet(model, node.id),
    });
  }
  return results;
}
