/**
 * @file cache.js
 * @description Reusing per-unit Atlas fragments across rebuilds.
 *
 * `avenx serve` and `avenx watch` rebuild the whole project on every save, and
 * a project's components mostly do not change between two saves. This cache
 * keeps the nodes and edges each component produced so an unchanged file is
 * merged back rather than re-analysed.
 *
 * ## What the key has to cover
 *
 * A component's own text is not enough. Its edges resolve `cart.total` against
 * the *bridge's* declared surface, so renaming a getter must invalidate every
 * consumer's fragment even though none of their files changed. The key is
 * therefore the file's content plus a digest of the surfaces it resolves
 * against.
 *
 * A stale fragment is worse than no cache — it would answer an impact query
 * with relationships that no longer exist — so the key covers everything the
 * fragment was derived from, and nothing is keyed on mtime or path alone.
 *
 * The cache lives in memory for the life of the process. It is deliberately
 * not on disk: the build is not incremental anywhere else, so a disk cache
 * would add invalidation risk across process boundaries for a slice of a cost
 * that is already small.
 * @module lib/compiler/atlas/cache
 */

import { createHash } from 'crypto';
import { AppModel } from './AppModel.js';
import { addComponentUnit } from './build.js';

/**
 * How many unit fragments to retain.
 *
 * Large enough for a substantial application, bounded so a long-lived dev
 * server cannot grow without limit.
 * @type {number}
 */
const MAX_ENTRIES = 2000;

/** @type {Map<string, object>} */
const store = new Map();

/**
 * Digests the surfaces a unit's analysis depends on.
 *
 * Only the parts a consumer can resolve against are included: a bridge's
 * internals can change freely without altering what its consumers' edges mean.
 * @param {Array<object>} bindings - The unit's bridge bindings.
 * @param {Map<string, object>} bridges - Every bridge descriptor.
 * @returns {string} A digest, stable across runs.
 */
function surfaceDigest(bindings, bridges) {
  if (!bindings || bindings.length === 0) return '-';
  const parts = [];
  for (const binding of [...bindings].sort((a, b) => (a.local < b.local ? -1 : 1))) {
    let descriptor = null;
    if (bridges) {
      for (const candidate of bridges.values()) {
        if (candidate && candidate.name === binding.bridge) {
          descriptor = candidate;
          break;
        }
      }
    }
    if (!descriptor) {
      parts.push(`${binding.local}=${binding.bridge}:missing`);
      continue;
    }
    parts.push(
      [
        binding.local,
        descriptor.name,
        [...descriptor.stateKeys].sort().join(','),
        [...descriptor.getters].sort().join(','),
        [...descriptor.actions].sort().join(','),
        [...(descriptor.events || [])].sort().join(','),
      ].join('|'),
    );
  }
  return parts.join(';');
}

/**
 * Computes the cache key for a unit.
 * @param {object} unit - The unit being analysed.
 * @returns {string} The key.
 */
export function cacheKey(unit) {
  return createHash('sha1')
    .update(unit.filePath)
    .update('\0')
    .update(unit.kind)
    .update('\0')
    .update(unit.rootDir || '')
    .update('\0')
    .update(unit.content)
    .update('\0')
    .update(surfaceDigest(unit.bridgeBindings, unit.bridges))
    .digest('hex');
}

/**
 * Adds a unit to the model, reusing a previous analysis when nothing it
 * depends on has changed.
 *
 * On a miss the unit is analysed into an isolated fragment model, which is
 * built leniently — a component legitimately names bridge nodes it does not
 * itself declare — and then merged into the real model under its normal edge
 * rules.
 * @param {import('./AppModel.js').AppModel} model - The model being built.
 * @param {object} unit - The unit, as `addComponentUnit` expects it.
 * @returns {{ownerId: string, masked: string, starts: number[], cached: boolean}}
 *   What was added, and whether it came from the cache.
 */
export function addCachedComponentUnit(model, unit) {
  const key = cacheKey(unit);
  const hit = store.get(key);

  if (hit) {
    // Refresh recency: Map preserves insertion order, so re-inserting moves
    // this entry to the back of the eviction queue.
    store.delete(key);
    store.set(key, hit);
    model.merge(hit.fragment);
    return { ownerId: hit.ownerId, masked: hit.masked, starts: hit.starts, cached: true };
  }

  const scratch = new AppModel({ requireNodes: false });
  const result = addComponentUnit(scratch, unit);
  const fragment = {
    nodes: [...scratch.nodes.values()],
    edges: scratch.edges,
    unresolved: scratch.unresolved,
  };

  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
  store.set(key, { fragment, ownerId: result.ownerId, masked: result.masked, starts: result.starts });

  model.merge(fragment);
  return { ...result, cached: false };
}

/**
 * Empties the cache.
 *
 * Used by tests, and available to any caller that wants a guaranteed cold
 * analysis.
 * @returns {void}
 */
export function clearAtlasCache() {
  store.clear();
}

/**
 * How many fragments are currently retained.
 * @returns {number} The entry count.
 */
export function atlasCacheSize() {
  return store.size;
}

export default { addCachedComponentUnit, clearAtlasCache, atlasCacheSize, cacheKey };
