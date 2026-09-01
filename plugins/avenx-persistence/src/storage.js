/**
 * Storage adapters.
 *
 * An adapter is anything with `getItem`, `setItem` and `removeItem` — the
 * shape the platform already defines for Web Storage. `window.localStorage`
 * is therefore a valid adapter as it stands, and so is a small object over
 * IndexedDB, a cookie jar, or a server-backed store. The persistence logic
 * only ever sees this interface, so a different backend never reaches it.
 * @module @avenx/persistence/storage
 */

import { warnOnce } from './diagnostics.js';

/**
 * Key written and removed to find out whether a Web Storage area actually
 * accepts writes. Some browsers expose `localStorage` and then throw on the
 * first `setItem` — private browsing modes historically did exactly that.
 * @type {string}
 */
const PROBE_KEY = '__avenx_persistence_probe__';

/**
 * Reports whether a value implements the storage adapter interface.
 * @param {any} value - The candidate adapter.
 * @returns {boolean} True when the value can be used as a storage adapter.
 */
export function isStorageAdapter(value) {
  return !!(
    value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function' &&
    typeof value.removeItem === 'function'
  );
}

/**
 * Creates an in-memory storage adapter.
 *
 * Nothing it holds outlives the page, which makes it the right choice for
 * tests and for server-side rendering, and the fallback when the browser
 * refuses to store anything. The application keeps working; only the
 * "survives a reload" part is lost.
 * @returns {object} A storage adapter backed by a Map.
 */
export function memoryStorage() {
  const entries = new Map();
  return {
    /**
     * @param {string} key - The entry to read.
     * @returns {string|null} The stored value, or null when absent.
     */
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    /**
     * @param {string} key - The entry to write.
     * @param {string} value - The value to store.
     */
    setItem(key, value) {
      entries.set(key, String(value));
    },
    /**
     * @param {string} key - The entry to remove.
     */
    removeItem(key) {
      entries.delete(key);
    },
  };
}

/**
 * Resolves a Web Storage area, falling back to memory when it is unusable.
 * @param {string} area - Either 'localStorage' or 'sessionStorage'.
 * @returns {object} A usable storage adapter.
 */
function webStorage(area) {
  const host = typeof globalThis !== 'undefined' ? globalThis : undefined;
  let storage = null;
  try {
    storage = host ? host[area] : null;
  } catch {
    // Accessing the property itself throws when the browser blocks storage.
    storage = null;
  }

  if (!isStorageAdapter(storage)) {
    warnOnce(`${area} is unavailable in this environment; falling back to in-memory storage (state will not survive a reload)`);
    return memoryStorage();
  }

  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
  } catch {
    warnOnce(`${area} rejected a write (private browsing or a full quota); falling back to in-memory storage`);
    return memoryStorage();
  }

  return storage;
}

/**
 * Resolves `window.localStorage`: persistence that survives both a reload and
 * a closed tab. This is the default backend.
 * @returns {object} A storage adapter.
 */
export function browserLocalStorage() {
  return webStorage('localStorage');
}

/**
 * Resolves `window.sessionStorage`: persistence that survives a reload but
 * ends with the browser tab.
 * @returns {object} A storage adapter.
 */
export function browserSessionStorage() {
  return webStorage('sessionStorage');
}
