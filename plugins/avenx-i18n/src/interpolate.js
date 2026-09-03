/**
 * Placeholder substitution inside a message.
 *
 * A message names its variables inline:
 *
 *   'Hello, {name}! You have {count} new messages.'
 *
 * Substitution is string concatenation and nothing else. A message is data —
 * frequently data that arrives from a translation service, a CMS or a
 * contributor's pull request — so it is never compiled, never evaluated, and
 * never given access to a scope. There is no `eval`, no `new Function`, and no
 * expression syntax inside a placeholder: `{user.name}` is a placeholder named
 * `user.name`, not a property access the message gets to perform.
 *
 * Messages are parsed into segments once and the result is cached on the
 * compiled catalogue entry, so a message rendered on every frame is scanned
 * exactly once for the lifetime of the page.
 * @module @avenx/i18n/interpolate
 */

/**
 * A placeholder: `{` a name `}`, where the name is letters, digits, `_`, `$`
 * and `.`. Anything else between braces is literal text — a message may say
 * `{ this }` and mean it.
 * @type {RegExp}
 */
const PLACEHOLDER = /\{([A-Za-z0-9_$.]+)\}/g;

/**
 * Splits a message into literal strings and placeholder names.
 *
 * A segment is either a string (literal) or `{ name }` (a substitution).
 * @param {string} message - The raw message.
 * @returns {Array<string|{name: string}>} The parsed segments.
 */
export function parseMessage(message) {
  const segments = [];
  let last = 0;
  let match;

  PLACEHOLDER.lastIndex = 0;
  while ((match = PLACEHOLDER.exec(message)) !== null) {
    if (match.index > last) {
      segments.push(message.slice(last, match.index));
    }
    segments.push({ name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < message.length) {
    segments.push(message.slice(last));
  }
  return segments;
}

/**
 * Reads a possibly dotted placeholder name out of the parameters.
 *
 * A dotted name walks plain properties so `{user.name}` can be filled from
 * `{ user: { name: 'Ada' } }` without the caller flattening it first. The walk
 * stops at anything that is not an object, and never consults the prototype
 * chain — a message may not reach `constructor` or `__proto__` through a
 * placeholder name.
 * @param {object} params - The interpolation values.
 * @param {string} name - The placeholder name.
 * @returns {any} The value, or undefined when the name is not present.
 */
function readParam(params, name) {
  if (!name.includes('.')) {
    return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
  }
  let current = params;
  for (const part of name.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Renders a value into a message.
 *
 * `null` and `undefined` never reach this — an absent parameter is handled by
 * the caller — so anything here is a value the application meant to show.
 * @param {any} value - The parameter value.
 * @returns {string} Its text.
 */
function stringify(value) {
  if (typeof value === 'string') {
    return value;
  }
  // Deliberately not locale-formatted. A placeholder is as likely to hold an
  // order number or an identifier as a quantity, and silently grouping the
  // digits of one would be a bug that only appears in some locales. Values
  // that should be formatted are formatted by the caller with `n()` or `d()`.
  return String(value);
}

/**
 * Fills a parsed message's placeholders.
 *
 * A placeholder with no matching parameter is left standing — `{name}` renders
 * as `{name}` — and reported. An empty string in its place would look like a
 * finished sentence with a word missing, which is far harder to notice in a
 * screenshot from a user than a literal brace.
 * @param {Array<string|{name: string}>} segments - The parsed message.
 * @param {object} params - The interpolation values.
 * @param {object} context - Reporting context.
 * @param {string} context.key - The translation key, for diagnostics.
 * @param {string} context.locale - The locale the message came from.
 * @param {function(string, string, object=): void} context.report - The failure reporter.
 * @returns {string} The rendered message.
 */
export function interpolate(segments, params, context) {
  let result = '';
  for (const segment of segments) {
    if (typeof segment === 'string') {
      result += segment;
      continue;
    }

    const value = params === null || typeof params !== 'object' ? undefined : readParam(params, segment.name);
    if (value === undefined || value === null) {
      context.report(
        'interpolation',
        `translation "${context.key}" expects a "${segment.name}" parameter, which was not supplied`,
        { key: context.key, locale: context.locale },
      );
      result += `{${segment.name}}`;
      continue;
    }
    result += stringify(value);
  }
  return result;
}
