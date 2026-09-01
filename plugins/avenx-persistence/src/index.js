/**
 * Official state persistence plugin for Avenx.js.
 * @module @avenx/persistence
 */

export { avenxPersistence, createAvenxPersistence, default } from './plugin.js';
export { persist } from './persist.js';
export { browserLocalStorage, browserSessionStorage, memoryStorage } from './storage.js';
