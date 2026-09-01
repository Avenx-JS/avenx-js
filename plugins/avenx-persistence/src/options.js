/**
 * Option validation shared by `persist()` and the plugin installer.
 *
 * The two accept the same settings — one for a single bridge, one as the
 * application-wide default — so they validate them in one place. Everything
 * here is checked when it is declared rather than when it is first used, so a
 * typo surfaces at startup instead of as an absent value after a reload.
 * @module @avenx/persistence/options
 */

import { configError } from './diagnostics.js';
import { isStorageAdapter } from './storage.js';

/**
 * Settings accepted both per bridge and application-wide.
 * @type {string[]}
 */
const SHARED_KEYS = ['storage', 'prefix', 'version', 'restore', 'serialize', 'deserialize', 'onError'];

/**
 * Validates the settings that `persist()` and the plugin have in common.
 * @param {object} options - The raw options.
 * @param {string} label - How to name the caller in an error message.
 * @returns {object} The validated settings, with absent ones omitted.
 */
export function normalizeSharedOptions(options, label) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw configError(`${label} expects an options object.`);
  }

  const result = {};
  for (const key of SHARED_KEYS) {
    if (options[key] !== undefined) {
      result[key] = options[key];
    }
  }

  if (result.storage !== undefined && !isStorageAdapter(result.storage)) {
    throw configError(
      `${label} received a "storage" value that is not a storage adapter. An adapter needs getItem, setItem and removeItem.`,
    );
  }
  if (result.prefix !== undefined && typeof result.prefix !== 'string') {
    throw configError(`${label} received a "prefix" that is not a string.`);
  }
  if (result.version !== undefined && (typeof result.version !== 'number' || !Number.isFinite(result.version))) {
    throw configError(`${label} received a "version" that is not a finite number.`);
  }
  if (result.restore !== undefined && typeof result.restore !== 'boolean') {
    throw configError(`${label} received a "restore" that is not a boolean.`);
  }
  for (const key of ['serialize', 'deserialize', 'onError']) {
    if (result[key] !== undefined && typeof result[key] !== 'function') {
      throw configError(`${label} received a "${key}" that is not a function.`);
    }
  }

  return result;
}

/**
 * Resolves which state keys a bridge persists.
 *
 * `include` and `exclude` name declared state keys, so a name that matches
 * nothing is a mistake rather than a no-op — most often a rename that was
 * only applied in one of the two places.
 * @param {string[]} declared - Every key the bridge declares in `state`.
 * @param {object} options - The `persist()` options.
 * @param {string} label - How to name the caller in an error message.
 * @returns {string[]} The keys to persist.
 */
export function resolvePersistedKeys(declared, options, label) {
  const { include, exclude } = options;

  if (include !== undefined && exclude !== undefined) {
    throw configError(`${label} declares both "include" and "exclude". Use one or the other.`);
  }

  /**
   * Validates a key list against the bridge's declared state.
   * @param {any} list - The candidate list.
   * @param {string} name - Either 'include' or 'exclude'.
   * @returns {string[]} The validated list.
   */
  const checkList = (list, name) => {
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) {
      throw configError(`${label} expects "${name}" to be an array of state key names.`);
    }
    const unknown = list.filter((entry) => !declared.includes(entry));
    if (unknown.length > 0) {
      throw configError(
        `${label} lists ${unknown.map((entry) => `"${entry}"`).join(', ')} in "${name}", which the bridge does not declare in state. Declared: ${declared.join(', ') || 'none'}.`,
      );
    }
    return list;
  };

  let keys = declared;
  if (include !== undefined) {
    keys = checkList(include, 'include');
  } else if (exclude !== undefined) {
    const removed = checkList(exclude, 'exclude');
    keys = declared.filter((entry) => !removed.includes(entry));
  }

  if (keys.length === 0) {
    throw configError(
      `${label} would persist no state at all. Declare state on the bridge, or widen "include"/"exclude".`,
    );
  }
  return [...new Set(keys)];
}
