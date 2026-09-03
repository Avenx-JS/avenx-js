/**
 * Avenx i18n plugin definition.
 *
 * Installing does two things. It puts the instance on `app.$i18n`, and it
 * registers a global mixin that publishes `t`, `tHtml`, `locale`, `n`, `d`,
 * `rel` and `$i18n` into every component's template scope.
 *
 * The mixin is the reason a template can say `{{ t('home.title') }}` with no
 * import and no per-component wiring. Avenx builds each component's expression
 * scope from its own state, actions and bridges, plus whatever global mixins
 * contribute — and mixin members are placed *before* the component's own, so a
 * component that declares its own `t` or `n` keeps it. The plugin never
 * shadows application code.
 * @module @avenx/i18n/plugin
 */

import { configError, PLUGIN_TAG } from './diagnostics.js';
import { createI18n } from './i18n.js';

/**
 * Builds the mixin that carries the translator into every component.
 *
 * Everything here is a top-level mixin member rather than a `methods` entry:
 * Avenx binds mixin methods to component state, while top-level members are
 * passed through as they are, which is what `locale` — an object with reactive
 * getters — needs.
 * @param {object} i18n - The i18n instance.
 * @returns {object} The mixin definition.
 */
function createMixin(i18n) {
  return {
    /**
     * Translates a key into the active locale.
     * @param {string} key - The dotted translation key.
     * @param {object} [params] - Interpolation values; a numeric `count` also selects the plural form.
     * @returns {string} The translated text.
     */
    t(key, params) {
      return i18n.t(key, params);
    },

    /**
     * Translates a key whose message contains markup, safely.
     * @param {string} key - The dotted translation key.
     * @param {object} [params] - Interpolation values, HTML-escaped before substitution.
     * @returns {object} A `SafeHtml` value the renderer inserts unescaped.
     */
    tHtml(key, params) {
      return i18n.tHtml(key, params);
    },

    /**
     * Formats a number in the active locale.
     * @param {any} value - The number to format.
     * @param {string|object} [options] - A configured preset name, or `Intl.NumberFormat` options.
     * @returns {string} The formatted number.
     */
    n(value, options) {
      return i18n.n(value, options);
    },

    /**
     * Formats a date in the active locale.
     * @param {any} value - A Date, a timestamp, or a date string.
     * @param {string|object} [options] - A configured preset name, or `Intl.DateTimeFormat` options.
     * @returns {string} The formatted date.
     */
    d(value, options) {
      return i18n.d(value, options);
    },

    /**
     * Formats a relative time in the active locale.
     * @param {number} value - The signed offset: negative is past, positive is future.
     * @param {string} unit - An `Intl.RelativeTimeFormat` unit.
     * @param {string|object} [options] - A configured preset name, or options.
     * @returns {string} The formatted value.
     */
    rel(value, unit, options) {
      return i18n.rel(value, unit, options);
    },

    locale: i18n.locale,
    $i18n: i18n,
  };
}

/**
 * The identifiers this plugin publishes into template scope.
 *
 * Declare these as `templateGlobals` in avenx.config.json so the compiler
 * knows a template that says `t('home.title')` is referring to something real.
 * Exported rather than only documented so a build script can write the list
 * out instead of copying it.
 * @type {string[]}
 */
export const TEMPLATE_GLOBALS = ['t', 'tHtml', 'n', 'd', 'rel', 'locale', '$i18n'];

/**
 * Official Avenx internationalization plugin.
 *
 * Usage:
 * ```javascript
 * import { avenxI18n } from '@avenx/i18n';
 * app.use(avenxI18n, { locale: 'en', fallbackLocale: 'en', messages });
 * ```
 */
export const avenxI18n = {
  /**
   * Installs the i18n plugin on an AvenxApp instance.
   * @param {import('avenx-core/runtime').AvenxApp} app - Avenx application instance.
   * @param {object} [options] - `createI18n()` options, or `{ i18n }` to install an
   *   instance that was built earlier.
   */
  install(app, options = {}) {
    if (!app || typeof app.mixin !== 'function') {
      throw new Error(`${PLUGIN_TAG} Invalid AvenxApp instance passed to plugin install().`);
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw configError('app.use(avenxI18n) expects an options object.');
    }

    const { i18n: provided, ...rest } = options;
    if (provided !== undefined && (provided === null || typeof provided.t !== 'function')) {
      throw configError('app.use(avenxI18n, { i18n }) expects an instance built by createI18n().');
    }

    const i18n = provided || createI18n(rest);
    app.$i18n = i18n;
    app.mixin(createMixin(i18n));
  },
};

/**
 * Functional plugin alias for `app.use(createAvenxI18n(options))`.
 * @param {object} [options] - The same options `avenxI18n` accepts.
 * @returns {object} A plugin object bound to those options.
 */
export function createAvenxI18n(options = {}) {
  return {
    /**
     * @param {import('avenx-core/runtime').AvenxApp} app - Avenx application instance.
     */
    install(app) {
      avenxI18n.install(app, options);
    },
  };
}

export default avenxI18n;
