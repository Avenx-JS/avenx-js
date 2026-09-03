/**
 * Option validation for `createI18n()` and the plugin installer.
 *
 * Everything is checked when it is declared rather than when it is first used,
 * so a misspelt option surfaces at startup with a stack that points at the call
 * that was wrong — not three navigations later as a sentence in the wrong
 * language.
 * @module @avenx/i18n/options
 */

import { assertResource } from './catalog.js';
import { configError } from './diagnostics.js';
import { normalizeLocale, normalizeLocaleList } from './locale.js';

/**
 * The formatter kinds `formats` may configure presets for.
 * @type {string[]}
 */
const FORMAT_KINDS = ['number', 'date', 'relative'];

/**
 * Reports whether a value implements the storage adapter interface.
 *
 * This is the shape the platform defines for Web Storage, and the same one
 * `@avenx/persistence` uses — so an adapter from that plugin, `localStorage`
 * itself, or a small object of your own all satisfy it without either plugin
 * knowing about the other.
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
 * Validates and canonicalizes the options `createI18n()` accepts.
 * @param {object} options - The raw options.
 * @param {string} label - How to name the caller in an error message.
 * @returns {object} The normalized configuration.
 */
export function normalizeOptions(options, label) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw configError(`${label} expects an options object.`);
  }

  const locale = normalizeLocale(options.locale === undefined ? 'en' : options.locale);
  if (!locale) {
    throw configError(`${label} received a "locale" that is not a valid locale tag: ${JSON.stringify(options.locale)}.`);
  }

  const fallbackSource = options.fallbackLocale === undefined ? 'en' : options.fallbackLocale;
  const fallback = normalizeLocaleList(fallbackSource);
  if (fallback.length === 0 && fallbackSource !== null && fallbackSource !== false) {
    throw configError(
      `${label} received a "fallbackLocale" with no valid locale tag in it: ${JSON.stringify(fallbackSource)}. ` +
        'Pass null to run without a fallback locale.',
    );
  }

  const messages = {};
  if (options.messages !== undefined) {
    assertResource(options.messages, `${label} "messages"`);
    for (const [tag, resource] of Object.entries(options.messages)) {
      const canonical = normalizeLocale(tag);
      if (!canonical) {
        throw configError(`${label} declares messages under "${tag}", which is not a valid locale tag.`);
      }
      messages[canonical] = assertResource(resource, `${label} messages["${tag}"]`);
    }
  }

  const loaders = {};
  if (options.loaders !== undefined) {
    assertResource(options.loaders, `${label} "loaders"`);
    for (const [tag, loader] of Object.entries(options.loaders)) {
      const canonical = normalizeLocale(tag);
      if (!canonical) {
        throw configError(`${label} declares a loader for "${tag}", which is not a valid locale tag.`);
      }
      if (typeof loader !== 'function') {
        throw configError(`${label} expects loaders["${tag}"] to be a function returning the locale's messages.`);
      }
      loaders[canonical] = loader;
    }
  }

  const formats = { number: {}, date: {}, relative: {} };
  if (options.formats !== undefined) {
    assertResource(options.formats, `${label} "formats"`);
    for (const [kind, presets] of Object.entries(options.formats)) {
      if (!FORMAT_KINDS.includes(kind)) {
        throw configError(
          `${label} declares a "${kind}" format group, which is not one of ${FORMAT_KINDS.join(', ')}.`,
        );
      }
      assertResource(presets, `${label} formats.${kind}`);
      for (const [name, preset] of Object.entries(presets)) {
        assertResource(preset, `${label} formats.${kind}.${name}`);
      }
      formats[kind] = { ...presets };
    }
  }

  const missing = options.missing === undefined ? 'key' : options.missing;
  if (missing !== 'key' && typeof missing !== 'function') {
    throw configError(`${label} expects "missing" to be 'key' or a function, received ${JSON.stringify(missing)}.`);
  }

  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw configError(`${label} received an "onError" that is not a function.`);
  }

  let storage;
  let storageKey = 'avenx:locale';
  if (options.storage !== undefined && options.storage !== null) {
    if (!isStorageAdapter(options.storage)) {
      throw configError(
        `${label} received a "storage" value that is not a storage adapter. An adapter needs getItem, setItem and removeItem.`,
      );
    }
    storage = options.storage;
  }
  if (options.storageKey !== undefined) {
    if (typeof options.storageKey !== 'string' || options.storageKey.trim() === '') {
      throw configError(`${label} expects "storageKey" to be a non-empty string.`);
    }
    storageKey = options.storageKey;
  }

  return { locale, fallback, messages, loaders, formats, missing, onError: options.onError, storage, storageKey };
}
