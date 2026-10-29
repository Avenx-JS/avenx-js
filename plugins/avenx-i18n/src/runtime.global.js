/**
 * The runtime resolver used by the standalone browser build.
 *
 * A `<script>`-tag deployment has no module resolution, so the plugin reaches
 * the runtime the same way a compiled Avenx application does: through the
 * namespace the runtime bundle publishes on the global object. The build
 * substitutes this module for `runtime.js`, which keeps `avenx-core` out of
 * the standalone bundle — a page must only ever have one runtime on it.
 *
 * Resolution is deferred to first use rather than done at load. A compiled
 * Avenx application is one file containing the runtime and the application
 * together, so at the moment this script is parsed the namespace does not
 * exist yet — but by the time `app.use(avenxI18n)` runs, it does. Deferring
 * means the plugin can be loaded before the application, which is the only
 * order a plain `<script>` tag allows.
 * @module @avenx/i18n/runtime.global
 */

import { Sanitizer as BuiltinSanitizer } from '../../../lib/core/security/sanitize.js';

/**
 * Returns the Avenx runtime namespace, optionally verifying required members.
 * @param {string[]} [requiredMembers] - Member names required on the namespace.
 * @returns {object} The `Avenx` global.
 */
function core(requiredMembers = []) {
  const namespace = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
  if (!namespace) {
    throw new Error(
      '[avenx-i18n] The Avenx runtime was not found on the page. Load the Avenx application bundle alongside avenx-i18n.global.js.',
    );
  }
  const missing = requiredMembers.filter((name) => !(name in namespace));
  if (missing.length > 0) {
    throw new Error(
      `[avenx-i18n] The Avenx runtime is missing required member(s): ${missing.join(', ')}. Ensure the Avenx application bundle is loaded.`,
    );
  }
  return namespace;
}

/**
 * The Avenx logger, resolved on each call with console fallback.
 * @type {object}
 */
export const logger = {
  /**
   * @param {...any} args - Arguments to log.
   */
  warn(...args) {
    const ns = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
    const log = (ns && ns.logger) || console;
    log.warn(...args);
  },
  /**
   * @param {...any} args - Arguments to log.
   */
  error(...args) {
    const ns = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
    const log = (ns && ns.logger) || console;
    log.error(...args);
  },
};

/**
 * Creates an Avenx bridge. See `avenx-core/runtime`.
 * @param {object} definition - The bridge definition.
 * @returns {object} The bridge instance.
 */
export function bridge(definition) {
  return core(['bridge']).bridge(definition);
}

/**
 * The SafeHtml marker class, resolved from the runtime or self-contained.
 */
export class SafeHtml {
  /**
   * @param {any} value - The sanitized HTML string.
   * @returns {object} An instance of SafeHtml.
   */
  constructor(value) {
    const ns = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
    if (ns && typeof ns.SafeHtml === 'function') {
      return new ns.SafeHtml(value);
    }
    this.value = String(value);
    this.__isSafeHtml = true;
  }

  /**
   * Returns the safe HTML string representation.
   * @returns {string} The safe HTML string.
   */
  toString() {
    return this.value;
  }
}

/**
 * The HTML escaper, resolved from the runtime or self-contained.
 */
export class HtmlEscaper {
  /**
   * Creates an instance of HtmlEscaper.
   */
  constructor() {
    const ns = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
    if (ns && typeof ns.HtmlEscaper === 'function') {
      return new ns.HtmlEscaper();
    }
  }

  /**
   * Escapes special HTML characters in a string.
   * @param {any} value - The value to escape.
   * @returns {string} The escaped string.
   */
  escape(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Unescapes HTML entities in a string back to original characters.
   * @param {any} value - The value to unescape.
   * @returns {string} The unescaped string.
   */
  unescape(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}

/**
 * The HTML sanitizer, resolved from the runtime or carrying its own built-in sanitizer.
 */
export class Sanitizer {
  /**
   * @param {object} [options] - Sanitizer policy options.
   * @returns {object} An instance of Sanitizer.
   */
  constructor(options) {
    const ns = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
    if (ns && typeof ns.Sanitizer === 'function') {
      return new ns.Sanitizer(options);
    }
    return new BuiltinSanitizer(options);
  }
}
