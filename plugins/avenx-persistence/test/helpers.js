/**
 * Shared fixtures for the persistence test suite.
 * @module plugins/avenx-persistence/test/helpers
 */

import { logger } from '../../../lib/core/index.js';
import { memoryStorage } from '../src/storage.js';
import { resetDiagnostics } from '../src/diagnostics.js';
import { resetRegistry } from '../src/registry.js';

/**
 * Every message the Avenx logger emitted since the last reset.
 * @type {Array<{level: string, text: string}>}
 */
export const logged = [];

/**
 * Replaces the logger's console transport so diagnostics can be asserted on
 * instead of scrolling past. Called once, before any test runs.
 */
export function captureLogs() {
  logger.configure({
    level: 'trace',
    transports: [
      {
        /**
         * @param {string} level - The log level.
         * @param {any[]} formatted - The formatted arguments.
         */
        log(level, formatted) {
          logged.push({
            level,
            text: formatted.map((part) => String(part && part.message ? part.message : part)).join(' '),
          });
        },
      },
    ],
  });
}

/**
 * Returns the logged messages that mention a fragment.
 * @param {string} fragment - Text to look for.
 * @returns {Array<{level: string, text: string}>} The matching entries.
 */
export function loggedMatching(fragment) {
  return logged.filter((entry) => entry.text.includes(fragment));
}

/**
 * Clears everything that outlives a single scenario: the controller registry,
 * the once-only warning history, and captured log output.
 */
export function reset() {
  resetRegistry();
  resetDiagnostics();
  logged.length = 0;
}

/**
 * Wraps a storage adapter and counts what the plugin asks of it.
 * @param {object} [inner] - The adapter to wrap. Defaults to a fresh memory adapter.
 * @returns {object} The instrumented adapter.
 */
export function countingStorage(inner = memoryStorage()) {
  const counts = { reads: 0, writes: 0, removals: 0 };
  return {
    counts,
    /**
     * @param {string} key - The entry to read.
     * @returns {string|null} The stored value.
     */
    getItem(key) {
      counts.reads++;
      return inner.getItem(key);
    },
    /**
     * @param {string} key - The entry to write.
     * @param {string} value - The value to store.
     */
    setItem(key, value) {
      counts.writes++;
      inner.setItem(key, value);
    },
    /**
     * @param {string} key - The entry to remove.
     */
    removeItem(key) {
      counts.removals++;
      inner.removeItem(key);
    },
  };
}

/**
 * Builds an adapter that throws from the chosen operations.
 * @param {object} options - Which operations fail, and with what.
 * @param {Error} [options.onGet] - Thrown by getItem.
 * @param {Error} [options.onSet] - Thrown by setItem.
 * @param {Error} [options.onRemove] - Thrown by removeItem.
 * @param {object} [options.inner] - The adapter used for operations that do not fail.
 * @returns {object} The failing adapter.
 */
export function failingStorage({ onGet, onSet, onRemove, inner = memoryStorage() } = {}) {
  return {
    /**
     * @param {string} key - The entry to read.
     * @returns {string|null} The stored value.
     */
    getItem(key) {
      if (onGet) throw onGet;
      return inner.getItem(key);
    },
    /**
     * @param {string} key - The entry to write.
     * @param {string} value - The value to store.
     */
    setItem(key, value) {
      if (onSet) throw onSet;
      inner.setItem(key, value);
    },
    /**
     * @param {string} key - The entry to remove.
     */
    removeItem(key) {
      if (onRemove) throw onRemove;
      inner.removeItem(key);
    },
  };
}

/**
 * Builds the error a browser raises when storage is full.
 * @returns {Error} A quota error.
 */
export function quotaError() {
  const error = new Error('The quota has been exceeded.');
  error.name = 'QuotaExceededError';
  error.code = 22;
  return error;
}

/**
 * Writes an envelope straight into storage, standing in for what an earlier
 * page load would have left behind.
 * @param {object} storage - The adapter to seed.
 * @param {string} storageKey - The full storage key, prefix included.
 * @param {object} state - The state to store.
 * @param {number} [version] - The schema version to record.
 */
export function seed(storage, storageKey, state, version = 1) {
  storage.setItem(storageKey, JSON.stringify({ avenx: 1, version, state }));
}

/**
 * Installs Web Storage globals for the duration of a scenario.
 *
 * The shared happy-dom registration does not publish `localStorage` or
 * `sessionStorage`, and the point of these tests is what
 * `browserLocalStorage()` does with whatever the environment offers — so the
 * environment is what gets substituted here.
 * @param {object} [overrides] - Adapters to install instead of memory-backed ones.
 * @param {object} [overrides.local] - The object to publish as globalThis.localStorage.
 * @param {object} [overrides.session] - The object to publish as globalThis.sessionStorage.
 * @returns {Function} Removes the globals again.
 */
export function installWebStorage({ local = memoryStorage(), session = memoryStorage() } = {}) {
  const had = {
    local: Object.prototype.hasOwnProperty.call(globalThis, 'localStorage'),
    session: Object.prototype.hasOwnProperty.call(globalThis, 'sessionStorage'),
  };
  const previous = { local: globalThis.localStorage, session: globalThis.sessionStorage };

  globalThis.localStorage = local;
  globalThis.sessionStorage = session;

  return () => {
    if (had.local) {
      globalThis.localStorage = previous.local;
    } else {
      delete globalThis.localStorage;
    }
    if (had.session) {
      globalThis.sessionStorage = previous.session;
    } else {
      delete globalThis.sessionStorage;
    }
  };
}
