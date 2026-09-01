/**
 * `persist()` — the one call an application makes to persist a bridge.
 *
 * It wraps a bridge *definition*, not a bridge instance:
 *
 *   export default bridge(
 *     persist(
 *       {
 *         state: { items: [] },
 *         add(item) { this.items.push(item); },
 *       },
 *       { key: 'cart' },
 *     ),
 *   );
 *
 * Wrapping the definition is what keeps the plugin inside Avenx's own
 * boundaries. Bridge state is read-only from the outside — writes go through
 * the bridge — so a restore performed from outside would have to break that
 * rule. Inside the definition there is already a hook that runs once, lazily,
 * detached from any component's scope, with a `this` that may write: `setup`.
 * That is exactly the shape a restore needs, so `persist()` adds its work to
 * `setup` and leaves everything else about the definition untouched.
 * @module @avenx/persistence/persist
 */

import { PersistenceController } from './controller.js';
import { configError } from './diagnostics.js';
import { normalizeSharedOptions, resolvePersistedKeys } from './options.js';
import { isPlainObject } from './serialize.js';
import { registerController } from './registry.js';

/**
 * Adds persistence to a bridge definition.
 * @param {object} definition - The bridge definition, as passed to `bridge()`.
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
 * @returns {object} A bridge definition to hand to `bridge()`.
 */
export function persist(definition, options = {}) {
  if (!isPlainObject(definition)) {
    throw configError('persist() expects a bridge definition object as its first argument.');
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw configError('persist() expects an options object as its second argument.');
  }

  const key = options.key;
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw configError('persist() requires a non-empty "key" option naming where this bridge is stored.');
  }

  if (!isPlainObject(definition.state)) {
    throw configError(`persist({ key: "${key}" }) expects the definition to declare a "state" object; there is nothing to persist without one.`);
  }
  if (definition.setup !== undefined && typeof definition.setup !== 'function') {
    throw configError(`persist({ key: "${key}" }) found a "setup" member that is not a function.`);
  }

  const label = `persist({ key: "${key}" })`;
  const settings = normalizeSharedOptions(options, label);
  if (options.migrate !== undefined) {
    if (typeof options.migrate !== 'function') {
      throw configError(`${label} received a "migrate" that is not a function.`);
    }
    settings.migrate = options.migrate;
  }

  const keys = resolvePersistedKeys(Object.keys(definition.state), options, label);
  const controller = new PersistenceController(key, keys, settings);
  registerController(controller);

  // Copy descriptors rather than spreading: a bridge definition's getters are
  // derived values, and spreading would evaluate them once and freeze the
  // result into a plain property.
  const persisted = {};
  Object.defineProperties(persisted, Object.getOwnPropertyDescriptors(definition));

  const originalSetup = typeof definition.setup === 'function' ? definition.setup : null;

  /**
   * Runs on the bridge's first use: restores, then watches for changes.
   *
   * `bridge()` runs `setup` untracked and outside any component's disposal
   * scope, and calls the returned cleanup on `$dispose`. That is precisely
   * the lifetime persistence needs, so the controller borrows it instead of
   * introducing one of its own.
   * @returns {Function} Cleanup that stops persisting and runs the definition's own cleanup.
   */
  function persistedSetup() {
    controller.start(this);
    const originalCleanup = originalSetup ? originalSetup.call(this) : null;

    return () => {
      if (typeof originalCleanup === 'function') {
        originalCleanup();
      }
      controller.stop();
    };
  }

  Object.defineProperty(persisted, 'setup', {
    value: persistedSetup,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  return persisted;
}
