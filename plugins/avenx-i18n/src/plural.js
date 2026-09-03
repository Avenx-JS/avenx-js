/**
 * Plural selection.
 *
 * Which form of a message a count takes is a property of the language, not of
 * the application: English has two, Polish has four, Japanese has one, Arabic
 * has six. `Intl.PluralRules` is the platform's implementation of the CLDR
 * rules that decide this, so it is what selects here. Nothing in this module
 * knows anything about any particular language.
 *
 * A plural message is written as the categories the language uses:
 *
 *   items: { one: '{count} item', other: '{count} items' }        // en
 *   items: { one: '...', few: '...', many: '...', other: '...' }  // pl
 *
 * `zero` is the one category that is not purely CLDR. Most languages never
 * select it, but "no items" is a sentence applications want to write, so an
 * explicitly declared `zero` wins for an exact count of 0. Languages that do
 * have a CLDR `zero` category (Latvian, Welsh, Arabic) still get it from the
 * rules for every other count that selects it.
 * @module @avenx/i18n/plural
 */

/**
 * `Intl.PluralRules` instances by locale. Constructing one costs real work, and
 * a plural message re-selects on every render.
 * @type {Map<string, Intl.PluralRules|null>}
 */
const rulesCache = new Map();

/**
 * Returns the plural rules for a locale, or null when the environment cannot
 * provide them.
 * @param {string} locale - A canonical locale tag.
 * @returns {Intl.PluralRules|null} The rules, or null.
 */
function rulesFor(locale) {
  if (rulesCache.has(locale)) {
    return rulesCache.get(locale);
  }
  let rules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    // An environment without Intl.PluralRules, or one that rejects the tag.
    // Selection falls back to `other`, which every plural form must define.
    rules = null;
  }
  rulesCache.set(locale, rules);
  return rules;
}

/**
 * Discards the cached rules. Exposed for tests.
 */
export function resetPluralCache() {
  rulesCache.clear();
}

/**
 * Chooses the form a count selects.
 * @param {object} form - The plural form: category to message.
 * @param {any} count - The `count` parameter the caller supplied.
 * @param {string} locale - The locale the message came from.
 * @param {object} context - Reporting context.
 * @param {string} context.key - The translation key, for diagnostics.
 * @param {function(string, string, object=): void} context.report - The failure reporter.
 * @returns {string|null} The selected message, or null when the form is unusable.
 */
export function selectPlural(form, count, locale, context) {
  const categories = Object.keys(form);
  if (categories.length === 0) {
    context.report('plural', `translation "${context.key}" is an empty plural form`, {
      key: context.key,
      locale,
    });
    return null;
  }

  if (typeof count !== 'number' || !Number.isFinite(count)) {
    context.report(
      'plural',
      `translation "${context.key}" is pluralized and needs a numeric "count" parameter; ` +
        `received ${count === undefined ? 'none' : typeof count}`,
      { key: context.key, locale },
    );
    return form.other !== undefined ? form.other : form[categories[0]];
  }

  if (count === 0 && form.zero !== undefined) {
    return form.zero;
  }

  const rules = rulesFor(locale);
  const category = rules ? rules.select(count) : 'other';

  if (form[category] !== undefined) {
    return form[category];
  }
  if (form.other !== undefined) {
    // Not fatal, but it is a gap in the translation: this locale selects a
    // category the translator did not write, so some counts read wrong.
    context.report(
      'plural',
      `translation "${context.key}" has no "${category}" form, which this locale selects; the "other" form was used`,
      { key: context.key, locale },
    );
    return form.other;
  }

  context.report(
    'plural',
    category === 'other'
      ? `translation "${context.key}" is a plural form with no "other" form`
      : `translation "${context.key}" has neither a "${category}" nor an "other" form`,
    { key: context.key, locale },
  );
  return form[categories[0]];
}
