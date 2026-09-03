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

/**
 * Returns the Avenx runtime namespace.
 * @returns {object} The `Avenx` global.
 */
function core() {
  const namespace = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
  if (!namespace) {
    throw new Error(
      '[avenx-i18n] The Avenx runtime was not found on the page. Load the Avenx application bundle alongside avenx-i18n.global.js.',
    );
  }
  return namespace;
}

/**
 * The Avenx logger, resolved on each call.
 * @type {object}
 */
export const logger = {
  /**
   * @param {...any} args - Arguments to log.
   */
  warn(...args) {
    core().logger.warn(...args);
  },
  /**
   * @param {...any} args - Arguments to log.
   */
  error(...args) {
    core().logger.error(...args);
  },
};

/**
 * Creates an Avenx bridge. See `avenx-core/runtime`.
 * @param {object} definition - The bridge definition.
 * @returns {object} The bridge instance.
 */
export function bridge(definition) {
  return core().bridge(definition);
}

/**
 * The runtime's SafeHtml marker class, resolved on first use.
 *
 * `tHtml()` has to produce a value the renderer recognises as already-safe,
 * and that recognition is an `instanceof` check against the runtime's own
 * class — so this proxies construction to whichever class the page's runtime
 * holds rather than declaring a second one.
 */
export class SafeHtml {
  /**
   * @param {any} value - The sanitized HTML string.
   * @returns {object} An instance of the runtime's SafeHtml.
   */
  constructor(value) {
    return new (core().SafeHtml)(value);
  }
}

/**
 * The runtime's HTML escaper.
 */
export class HtmlEscaper {
  /**
   * @returns {object} An instance of the runtime's HtmlEscaper.
   */
  constructor() {
    return new (core().HtmlEscaper)();
  }
}

/**
 * The runtime's HTML sanitizer.
 */
export class Sanitizer {
  /**
   * @param {object} [options] - Sanitizer policy options.
   * @returns {object} An instance of the runtime's Sanitizer.
   */
  constructor(options) {
    return new (core().Sanitizer)(options);
  }
}
