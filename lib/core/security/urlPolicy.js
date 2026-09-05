/**
 * @file urlPolicy.js
 * @description Refuses dangerous URL schemes in attributes that navigate or load.
 *
 * ## The gap this closes
 *
 * Interpolation escapes correctly: `{{ value }}` in a quoted attribute cannot
 * break out of the quotes. What it cannot do is make the *value* safe, and for
 * a URL-bearing attribute the value is the whole attack:
 *
 * ```html
 * <a href="{{ link }}">…</a>      <!-- link = "javascript:steal()" -->
 * ```
 *
 * Nothing is escaped away, because nothing needs escaping — the string is a
 * perfectly well-formed attribute value that happens to execute when clicked.
 * Any application binding a user-supplied URL had a script-execution sink, and
 * Avenx shipped a full `Sanitizer` that was never applied on this path.
 *
 * ## The policy
 *
 * Only the scheme is judged, and only for attributes whose value is fetched or
 * navigated to. A relative URL, a fragment, a query, an absolute path and the
 * ordinary schemes all pass untouched; `javascript:`, `vbscript:` and `data:`
 * do not. `data:` is included because a `data:text/html` document navigated to
 * from `href` executes in the page's origin.
 *
 * The check is deliberately conservative about what it inspects. It is not a
 * URL validator and does not rewrite anything: it either allows the value
 * through unchanged or replaces it with a value that cannot navigate, and says
 * so. Silently mangling a URL would be worse than either.
 * @module lib/core/security/urlPolicy
 */

import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { logger } from '../runtime/AvenxLogger.js';

/**
 * Attributes whose value is navigated to or loaded.
 *
 * `src` and `href` are the obvious ones. `action` and `formaction` submit to a
 * URL; `xlink:href` is the SVG spelling of `href` and executes on click in
 * exactly the same way; `ping` and `data` are fetched.
 * @type {Set<string>}
 */
export const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'ping',
  'data',
  'poster',
  'background',
  'srcdoc',
]);

/**
 * Schemes that execute rather than locate.
 * @type {Set<string>}
 */
const DANGEROUS_SCHEMES = new Set(['javascript', 'vbscript', 'data']);

/**
 * `data:` URLs that are inert in every context Avenx puts them in.
 *
 * An image or a font cannot execute. Blocking `data:image/png` would break
 * inline avatars and icons for no security gain, so the media types that
 * cannot carry script are allowed through.
 * @type {RegExp}
 */
const INERT_DATA_URL = /^data:(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|font\/|application\/font)/i;

/**
 * The value substituted for a refused URL.
 *
 * `about:blank` rather than an empty string: an empty `href` resolves to the
 * current document, so a refused link would silently reload the page instead of
 * doing nothing.
 * @type {string}
 */
export const REFUSED_URL = 'about:blank';

/**
 * Whether an attribute's value is treated as a URL.
 * @param {string} name - The attribute name.
 * @returns {boolean} True when the attribute navigates or loads.
 */
export function isUrlAttribute(name) {
  return typeof name === 'string' && URL_ATTRIBUTES.has(name.toLowerCase());
}

/**
 * Extracts the scheme of a URL, if it has one.
 *
 * Leading control characters and whitespace are stripped first: browsers ignore
 * them when resolving a URL, so `java\tscript:alert(1)` navigates exactly as
 * `javascript:alert(1)` does, and a check that did not strip them would be
 * reading a different string than the browser.
 * @param {string} value - The attribute value.
 * @returns {string|null} The lowercased scheme, or null when the URL is relative.
 */
export function schemeOf(value) {
  if (typeof value !== 'string') return null;

  // eslint-disable-next-line no-control-regex
  const normalized = value.replace(/[\u0000-\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g, '');
  const match = normalized.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Whether a URL is safe to place in a navigating attribute.
 * @param {string} value - The attribute value.
 * @returns {boolean} True when the URL may be used.
 */
export function isSafeUrl(value) {
  const scheme = schemeOf(value);
  if (scheme === null) {
    // Relative, fragment, query or protocol-relative: no scheme to abuse.
    return true;
  }
  if (!DANGEROUS_SCHEMES.has(scheme)) {
    return true;
  }
  if (scheme === 'data' && INERT_DATA_URL.test(String(value).trim())) {
    return true;
  }
  return false;
}

/**
 * Returns a URL safe for the given attribute, reporting a refusal.
 * @param {string} name - The attribute name.
 * @param {string} value - The attribute value.
 * @param {object} [context] - Logging context.
 * @returns {string} The original value, or {@link REFUSED_URL}.
 */
export function sanitizeUrlAttribute(name, value, context) {
  if (!isUrlAttribute(name) || isSafeUrl(value)) {
    return value;
  }
  const message = formatMessage(AvenxErrorCodes.SECURITY_BLOCKED_URL, name, String(value).slice(0, 120));
  // The context argument is omitted rather than passed as undefined, which the
  // logger would render as the string "undefined" after the message.
  if (context) {
    logger.warn(message, context);
  } else {
    logger.warn(message);
  }
  return REFUSED_URL;
}
