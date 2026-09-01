/**
 * The plugin's bookkeeping: application-level defaults, and the controllers
 * created by `persist()`.
 *
 * A bridge is module-scoped, so `persist()` runs when the bridge module is
 * imported — before `app.use(avenxPersistence)` has had a chance to run. The
 * two halves meet here: `persist()` registers a controller as it is created,
 * and installing the plugin deposits the defaults that every controller reads
 * when it first resolves its configuration.
 *
 * This holds plugin configuration and controller identities. It holds no
 * application state: that stays in the bridges, where Avenx keeps it.
 * @module @avenx/persistence/registry
 */

import { configError, warnOnce } from './diagnostics.js';

/**
 * Controllers by persistence key.
 * @type {Map<string, object>}
 */
const controllers = new Map();

/**
 * Defaults deposited by `avenxPersistence.install()`.
 * @type {object}
 */
let pluginDefaults = {};

/**
 * Records the application-level defaults for every persisted bridge.
 * @param {object} defaults - Normalized plugin options.
 */
export function setPluginDefaults(defaults) {
  pluginDefaults = defaults || {};

  // A controller that already resolved its configuration hydrated before the
  // plugin was installed, and kept the built-in defaults. Saying so is more
  // useful than letting half the application use a different storage key.
  const alreadyResolved = [...controllers.values()].filter((controller) => controller.resolved).map((controller) => controller.key);
  if (alreadyResolved.length > 0) {
    warnOnce(
      `avenxPersistence was installed after these keys had already hydrated, so application defaults did not reach them: ${alreadyResolved.join(', ')}. ` +
        'Call app.use(avenxPersistence) before any persisted bridge is read.',
    );
  }
}

/**
 * Returns the application-level defaults.
 * @returns {object} The defaults deposited at install time.
 */
export function getPluginDefaults() {
  return pluginDefaults;
}

/**
 * Registers a controller under its persistence key.
 *
 * Two bridges sharing one key would overwrite each other's stored data on
 * every save, which is a configuration mistake rather than a runtime
 * condition, so it is reported as an error the developer has to resolve.
 * @param {object} controller - The controller to register.
 */
export function registerController(controller) {
  const existing = controllers.get(controller.key);
  if (existing && existing !== controller) {
    throw configError(
      `persistence key "${controller.key}" is already used by another persisted bridge. Give each persisted bridge its own key.`,
    );
  }
  controllers.set(controller.key, controller);
}

/**
 * Looks up a controller by persistence key.
 * @param {string} key - The persistence key.
 * @returns {object|undefined} The controller, when one is registered.
 */
export function getController(key) {
  return controllers.get(key);
}

/**
 * Lists every registered controller.
 * @returns {object[]} The controllers, in registration order.
 */
export function listControllers() {
  return [...controllers.values()];
}

/**
 * Forgets every controller and default. Exposed for tests, which run many
 * independent scenarios inside a single process.
 */
export function resetRegistry() {
  controllers.clear();
  pluginDefaults = {};
}
