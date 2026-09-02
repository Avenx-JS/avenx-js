/**
 * Avenx Persistence plugin definition.
 * @module @avenx/persistence/plugin
 */

import { configError, PLUGIN_TAG } from './diagnostics.js';
import { normalizeSharedOptions } from './options.js';
import { getController, listControllers, setPluginDefaults } from './registry.js';

/**
 * Selects the controllers an app-level call applies to.
 * @param {string} [key] - A single persistence key, or undefined for all of them.
 * @returns {object[]} The controllers to act on.
 */
function select(key) {
  if (key === undefined) {
    return listControllers();
  }
  const controller = getController(key);
  if (!controller) {
    const known = listControllers().map((entry) => entry.key);
    throw configError(`no persisted bridge uses the key "${key}". Known keys: ${known.join(', ') || 'none'}.`);
  }
  return [controller];
}

/**
 * Builds the `app.$persistence` handle.
 *
 * Deliberately small. Everything about *what* is persisted is declared on the
 * bridge with `persist()`; this exists for the two moments an application has
 * to reach persistence directly — writing before the page goes away, and
 * discarding stored data on sign-out.
 * @returns {object} The application-facing persistence handle.
 */
function createHandle() {
  return {
    /**
     * Lists the persistence keys registered by `persist()`.
     * @returns {string[]} Every known persistence key.
     */
    keys() {
      return listControllers().map((controller) => controller.key);
    },

    /**
     * Writes pending changes immediately instead of at the end of the tick.
     * Useful from a `pagehide` or `visibilitychange` handler.
     * @param {string} [key] - A single key, or omit for every persisted bridge.
     */
    flush(key) {
      for (const controller of select(key)) {
        controller.save();
      }
    },

    /**
     * Removes persisted data. Live state is left alone: this decides what the
     * next reload finds, not what the application is currently showing.
     * @param {string} [key] - A single key, or omit for every persisted bridge.
     */
    clear(key) {
      for (const controller of select(key)) {
        controller.clear();
      }
    },
  };
}

/**
 * Official Avenx persistence plugin.
 *
 * Installing it is optional for persistence itself — a bridge wrapped in
 * `persist()` works on its own defaults. Installing sets the application-wide
 * defaults every persisted bridge inherits, and provides `app.$persistence`.
 *
 * Usage:
 * ```javascript
 * import { avenxPersistence } from '@avenx/persistence';
 * app.use(avenxPersistence, { prefix: 'shop:' });
 * ```
 */
export const avenxPersistence = {
  /**
   * Installs the persistence plugin on an AvenxApp instance.
   * @param {import('avenx-core/runtime').AvenxApp} app - Avenx application instance.
   * @param {object} [options] - Defaults for every persisted bridge. Accepts the same
   *   storage, prefix, version, restore, serialize, deserialize and onError settings as `persist()`.
   */
  install(app, options = {}) {
    if (!app || typeof app.use !== 'function') {
      throw new Error(`${PLUGIN_TAG} Invalid AvenxApp instance passed to plugin install().`);
    }
    setPluginDefaults(normalizeSharedOptions(options, 'app.use(avenxPersistence)'));
    app.$persistence = createHandle();
  },
};

/**
 * Functional plugin alias for `app.use(createAvenxPersistence(options))`.
 * @param {object} [options] - Defaults for every persisted bridge.
 * @returns {object} A plugin object bound to those options.
 */
export function createAvenxPersistence(options = {}) {
  return {
    /**
     * @param {import('avenx-core/runtime').AvenxApp} app - Avenx application instance.
     */
    install(app) {
      avenxPersistence.install(app, options);
    },
  };
}

export default avenxPersistence;
