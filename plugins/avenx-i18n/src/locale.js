/**
 * Locale tags: normalization, and the fallback chain a lookup walks.
 *
 * Two applications will write the same locale five different ways — `de_CH`,
 * `DE-ch`, `de-ch`, `  de-CH  `, `de-CH-u-nu-latn`. Normalizing once, at every
 * boundary where a tag arrives, means the rest of the plugin only ever
 * compares canonical tags and a catalogue is only ever registered under one
 * name.
 *
 * Fallback is the other half. `de-CH` is German as written in Switzerland: a
 * key it does not define should be answered by `de` before it is answered by
 * the application's fallback locale, and only reported missing when nothing in
 * that chain has it.
 * @module @avenx/i18n/locale
 */

/**
 * Canonicalizes a BCP 47 locale tag.
 *
 * `Intl.getCanonicalLocales` is the platform's own answer to this question, so
 * it is asked first; it fixes casing, rejects nonsense, and leaves extension
 * subtags intact. Underscores are translated first because they are how locale
 * tags are spelled in gettext, Java and most translation management systems,
 * and pasting one in should not be an error.
 * @param {any} tag - The locale tag to normalize.
 * @returns {string|null} The canonical tag, or null when the value is not a usable tag.
 */
export function normalizeLocale(tag) {
  if (typeof tag !== 'string') {
    return null;
  }
  const trimmed = tag.trim().replace(/_/g, '-');
  if (trimmed === '') {
    return null;
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    return canonical || null;
  } catch {
    return null;
  }
}

/**
 * Strips one subtag from the end of a locale tag.
 * @param {string} tag - A canonical locale tag.
 * @returns {string|null} The shorter tag, or null when there is nothing left to strip.
 */
function truncate(tag) {
  const index = tag.lastIndexOf('-');
  return index === -1 ? null : tag.slice(0, index);
}

/**
 * Expands a locale tag into itself followed by each of its ancestors.
 *
 * `zh-Hant-TW` yields `['zh-Hant-TW', 'zh-Hant', 'zh']`.
 *
 * Unicode extension subtags are not part of that hierarchy. `de-u-nu-latn` is
 * German with Latin digits, and its ancestor is `de` — not `de-u-nu`, which is
 * not a locale anyone writes messages for. The walk therefore starts from the
 * language-script-region core, with the full tag kept in front of it so an
 * exact catalogue registration still wins.
 * @param {string} tag - A canonical locale tag.
 * @returns {string[]} The tag and its ancestors, most specific first.
 */
export function expandLocale(tag) {
  const subtags = tag.split('-');
  const singleton = subtags.findIndex((subtag, index) => index > 0 && subtag.length === 1);
  const core = singleton === -1 ? tag : subtags.slice(0, singleton).join('-');

  const chain = tag === core ? [] : [tag];
  let current = core;
  while (current) {
    chain.push(current);
    current = truncate(current);
  }
  return chain;
}

/**
 * Builds the ordered list of locales a lookup tries.
 *
 * The active locale and its ancestors come first, then each fallback locale
 * and its ancestors, in the order they were configured. Duplicates are removed
 * so a chain never asks the same catalogue twice.
 * @param {string} locale - The active canonical locale.
 * @param {string[]} fallbacks - The configured fallback locales, canonical.
 * @returns {string[]} The lookup chain, most specific first.
 */
export function resolveChain(locale, fallbacks = []) {
  const chain = [];
  const seen = new Set();

  /**
   * Appends a tag and its ancestors, skipping anything already in the chain.
   * @param {string} tag - The locale to expand.
   */
  const push = (tag) => {
    for (const step of expandLocale(tag)) {
      if (!seen.has(step)) {
        seen.add(step);
        chain.push(step);
      }
    }
  };

  if (locale) {
    push(locale);
  }
  for (const fallback of fallbacks) {
    if (fallback) {
      push(fallback);
    }
  }
  return chain;
}

/**
 * Normalizes a locale option that may be written as one tag or as a list.
 * @param {any} value - A tag, an array of tags, or undefined.
 * @returns {string[]} The canonical tags, with unusable entries dropped.
 */
export function normalizeLocaleList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  const raw = Array.isArray(value) ? value : [value];
  const result = [];
  for (const entry of raw) {
    const tag = normalizeLocale(entry);
    if (tag && !result.includes(tag)) {
      result.push(tag);
    }
  }
  return result;
}
