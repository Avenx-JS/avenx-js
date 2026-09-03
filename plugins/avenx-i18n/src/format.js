/**
 * Localized formatting, on top of `Intl`.
 *
 * The platform already knows that 1234.5 is `1,234.5` in English and
 * `1.234,5` in German, and it knows it for every locale a browser ships. This
 * module adds three things to that and nothing else:
 *
 *   - the active locale, so a call site does not repeat it;
 *   - named presets, so `n(total, 'currency')` can mean one thing across an
 *     application rather than an options object copied into forty components;
 *   - caching, because constructing an `Intl.NumberFormat` is expensive and a
 *     formatted value is re-rendered constantly.
 *
 * There is deliberately no formatting logic here. Anything `Intl` decides,
 * `Intl` decides.
 * @module @avenx/i18n/format
 */

/**
 * Formatter instances by kind, locale and options.
 * @type {Map<string, object>}
 */
const formatterCache = new Map();

/**
 * The `Intl` constructors this module exposes, by short name.
 * @type {object}
 */
const CONSTRUCTORS = {
  number: 'NumberFormat',
  date: 'DateTimeFormat',
  relative: 'RelativeTimeFormat',
};

/**
 * Discards every cached formatter. Exposed for tests.
 */
export function resetFormatCache() {
  formatterCache.clear();
}

/**
 * Returns a cached `Intl` formatter, or null when the environment has none.
 * @param {string} kind - One of 'number', 'date' or 'relative'.
 * @param {string} locale - A canonical locale tag.
 * @param {object} options - The formatter options.
 * @returns {object|null} The formatter, or null.
 */
function formatter(kind, locale, options) {
  const cacheKey = `${kind} ${locale} ${JSON.stringify(options || {})}`;
  if (formatterCache.has(cacheKey)) {
    return formatterCache.get(cacheKey);
  }

  const Ctor = typeof Intl !== 'undefined' ? Intl[CONSTRUCTORS[kind]] : undefined;
  let instance = null;
  if (typeof Ctor === 'function') {
    try {
      instance = new Ctor(locale, options);
    } catch {
      // An unsupported option, or a tag this environment's ICU data rejects.
      // The caller falls back to an unformatted value rather than throwing.
      instance = null;
    }
  }
  formatterCache.set(cacheKey, instance);
  return instance;
}

/**
 * Resolves a preset name, or passes an options object through.
 * @param {object} presets - The configured presets for this kind.
 * @param {string|object|undefined} options - A preset name, an options object, or nothing.
 * @param {object} context - Reporting context with `report`.
 * @param {string} kind - One of 'number', 'date' or 'relative'.
 * @returns {object} The resolved options.
 */
function resolveOptions(presets, options, context, kind) {
  if (options === undefined || options === null) {
    return {};
  }
  if (typeof options === 'string') {
    const preset = presets[options];
    if (preset) {
      return preset;
    }
    context.report('format', `no "${options}" ${kind} format is configured; the value was formatted with defaults`);
    return {};
  }
  return options;
}

/**
 * Formats a number.
 * @param {any} value - The value to format.
 * @param {string|object} [options] - A configured preset name, or `Intl.NumberFormat` options.
 * @param {object} context - Formatting context: `{ locale, formats, report }`.
 * @returns {string} The formatted number, or the value as text when it is not one.
 */
export function formatNumber(value, options, context) {
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    context.report('format', `a number was expected for formatting, received ${typeof value}`, {
      locale: context.locale,
    });
    return value === null || value === undefined ? '' : String(value);
  }
  const resolved = resolveOptions(context.formats.number, options, context, 'number');
  const intl = formatter('number', context.locale, resolved);
  return intl ? intl.format(value) : String(value);
}

/**
 * Coerces a value into a Date.
 * @param {any} value - A Date, a timestamp, or a date string.
 * @returns {Date|null} The date, or null when the value is not one.
 */
function toDate(value) {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a date or time.
 * @param {any} value - A Date, a timestamp, or a date string.
 * @param {string|object} [options] - A configured preset name, or `Intl.DateTimeFormat` options.
 * @param {object} context - Formatting context: `{ locale, formats, report }`.
 * @returns {string} The formatted date, or the value as text when it is not one.
 */
export function formatDate(value, options, context) {
  const date = toDate(value);
  if (!date) {
    context.report('format', `"${String(value)}" is not a date and was not formatted`, { locale: context.locale });
    return value === null || value === undefined ? '' : String(value);
  }
  const resolved = resolveOptions(context.formats.date, options, context, 'date');
  const intl = formatter('date', context.locale, resolved);
  return intl ? intl.format(date) : date.toISOString();
}

/**
 * Formats a relative time, such as "in 3 days" or "2 hours ago".
 * @param {any} value - The signed offset: negative is past, positive is future.
 * @param {string} unit - An `Intl.RelativeTimeFormat` unit, e.g. 'day' or 'hour'.
 * @param {string|object} [options] - A configured preset name, or `Intl.RelativeTimeFormat` options.
 * @param {object} context - Formatting context: `{ locale, formats, report }`.
 * @returns {string} The formatted value, or a plain description when `Intl` cannot help.
 */
export function formatRelative(value, unit, options, context) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    context.report('format', `a number was expected for relative formatting, received ${typeof value}`, {
      locale: context.locale,
    });
    return value === null || value === undefined ? '' : String(value);
  }
  const resolved = resolveOptions(context.formats.relative, options, context, 'relative');
  const intl = formatter('relative', context.locale, { numeric: 'auto', ...resolved });
  if (!intl) {
    return `${value} ${unit}`;
  }
  try {
    return intl.format(value, unit);
  } catch (error) {
    context.report('format', `"${unit}" is not a relative time unit`, { locale: context.locale, error });
    return `${value} ${unit}`;
  }
}
