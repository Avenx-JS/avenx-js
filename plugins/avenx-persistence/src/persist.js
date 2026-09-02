/**
 * `persist()` — the one call an application makes to persist a bridge.
 *
 * It is called from the bridge's own `setup()` hook and returns that hook's
 * cleanup function:
 *
 *   export default bridge({
 *     state: { items: [], draft: '' },
 *     add(item) { this.items.push(item); },
 *
 *     setup() {
 *       return persist(this, { key: 'cart', exclude: ['draft'] });
 *     },
 *   });
 *
 * That shape is not a convenience — it is what keeps the plugin inside Avenx's
 * own boundaries, in three ways.
 *
 * Bridge state is read-only from the outside by design: every mutation goes
 * through the bridge, so "who changed this?" has one answer. `setup()` runs
 * with `this` bound to the bridge's write-capable facade, so a restore is
 * still a write from inside the bridge module rather than around it.
 *
 * `bridge()` runs `setup()` once, lazily, untracked, and detached from any
 * component's disposal scope, and calls the returned cleanup on `$dispose`.
 * That is exactly the lifetime persistence needs, so it borrows it instead of
 * inventing one.
 *
 * And the bridge module stays a bridge module: a literal `bridge({ ... })`
 * whose state, getters and actions the Avenx compiler can still read
 * statically for Atlas, template validation and tree-shaking.
 * @module @avenx/persistence/persist
 */

import { PersistenceController } from './controller.js';
import { configError } from './diagnostics.js';
import { normalizeSharedOptions, resolvePersistedKeys } from './options.js';
import { getController, registerController } from './registry.js';

/**
 * Lists the state keys of a bridge, leaving its getters out.
 *
 * A bridge's `this` enumerates state and getters together, and there is no
 * flag distinguishing them. There is a difference in behaviour, though:
 * assigning to a getter is refused, and assigning a value that is already
 * there is a no-op the reactivity system does not even report. Writing each
 * value back over itself therefore separates the two without changing
 * anything — and it happens before the change watcher exists, so nothing is
 * listening either way.
 *
 * NaN is the one value that is not equal to itself, so a key holding one is
 * taken to be state rather than probed. If that guess is ever wrong the
 * restore refuses the key and drops it, which is why this can afford to guess.
 * @param {object} self - The bridge's own state facade.
 * @returns {string[]} The writable state keys.
 */
function declaredStateKeys(self) {
  const keys = [];
  for (const key of Object.keys(self)) {
    const value = self[key];
    if (typeof value === 'number' && Number.isNaN(value)) {
      keys.push(key);
      continue;
    }
    try {
      self[key] = value;
      keys.push(key);
    } catch {
      // A getter. Derived values are recomputed from restored state, so there
      // is nothing to persist.
    }
  }
  return keys;
}

/**
 * Persists a bridge's state. Call from the bridge's `setup()` and return the
 * result, so persistence stops when the bridge is disposed.
 * @param {object} self - The bridge's `this` inside `setup()`.
 * @param {object} options - Persistence options.
 * @param {string} options.key - Storage key for this bridge. Unique within the application.
 * @param {string[]} [options.include] - Persist only these state keys.
 * @param {string[]} [options.exclude] - Persist every state key except these.
 * @param {object} [options.storage] - Storage adapter. Defaults to `browserLocalStorage()`.
 * @param {string} [options.prefix] - Prefix for the storage key. Defaults to 'avenx:'.
 * @param {number} [options.version] - Schema version of the persisted state. Defaults to 1.
 * @param {boolean} [options.restore] - Set false to keep saving but never restore. Defaults to true.
 * @param {Function} [options.serialize] - Turns the envelope into a string. Defaults to JSON.stringify.
 * @param {Function} [options.deserialize] - Turns a stored string back into an envelope. Defaults to JSON.parse.
 * @param {Function} [options.migrate] - Upgrades state written by an older version. Return null to discard it.
 * @param {Function} [options.onError] - Called with { key, phase, message, error } on any persistence failure.
 * @returns {Function} The cleanup to return from `setup()`.
 */
export function persist(self, options = {}) {
  if (self === null || typeof self !== 'object') {
    throw configError(
      'persist() expects the bridge\'s own `this`, as in: setup() { return persist(this, { key: "cart" }); }',
    );
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw configError('persist() expects an options object as its second argument.');
  }

  const key = options.key;
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw configError('persist() requires a non-empty "key" option naming where this bridge is stored.');
  }

  // Checked before anything else touches the bridge. A controller already
  // under this key belongs either to this bridge initializing again — after
  // $dispose, or a hot reload — or to a different one, which would overwrite
  // this bridge's stored data on every save.
  let controller = getController(key);
  if (controller && controller.owner !== self) {
    throw configError(
      `persistence key "${key}" is already used by another persisted bridge. Give each persisted bridge its own key.`,
    );
  }

  const label = `persist({ key: "${key}" })`;
  const settings = normalizeSharedOptions(options, label);
  if (options.migrate !== undefined) {
    if (typeof options.migrate !== 'function') {
      throw configError(`${label} received a "migrate" that is not a function.`);
    }
    settings.migrate = options.migrate;
  }

  // `include` names the keys outright, so there is nothing to work out.
  const declared = options.include === undefined ? declaredStateKeys(self) : Object.keys(self);
  const keys = resolvePersistedKeys(declared, options, label);

  if (controller) {
    controller.reconfigure(keys, settings);
  } else {
    controller = new PersistenceController(key, self, keys, settings);
    registerController(controller);
  }

  controller.start();
  return () => controller.stop();
}
