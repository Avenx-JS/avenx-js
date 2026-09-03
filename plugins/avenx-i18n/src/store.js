/**
 * The reactive half of the plugin: an ordinary Avenx bridge.
 *
 * This is the piece that makes translated UI update by itself. `t()` reads
 * `locale` and `revision` off this bridge, and it does so while the component's
 * render watcher is active — so reading a translation *is* subscribing to the
 * locale, through exactly the dependency tracking every other reactive value in
 * an Avenx application uses. Nothing here is a second reactivity system, a
 * second scheduler, or a second update path.
 *
 * It also means locale changes are precise. A component that never calls `t()`
 * never reads `locale`, so it is never a dependent, so it is not re-rendered
 * when the language changes. There is no application-wide re-render and no DOM
 * scan: the same per-component watcher that answers a counter increment answers
 * a language switch, and the same DOM patcher touches only the text nodes that
 * actually changed.
 *
 * What lives in state here is small on purpose — the active locale, the
 * fallback chain, which locales are available, whether one is loading, and a
 * revision counter. The messages themselves are held outside reactive state, in
 * plain catalogues; see catalog.js for why.
 * @module @avenx/i18n/store
 */

import { bridge } from './runtime.js';

/**
 * Creates the locale bridge.
 *
 * Written as a bridge rather than as a bare reactive object so that locale
 * changes obey the same rule as every other shared mutation in an Avenx
 * application: state is read-only from the outside, and every change has one
 * traceable origin inside the bridge. `i18n.locale.set('de')` reaches
 * `setLocale` here; nothing can assign the locale from the side.
 * @param {object} initial - The starting state.
 * @param {string} initial.locale - The active canonical locale.
 * @param {string[]} initial.fallback - The configured fallback locales, canonical.
 * @param {string[]} initial.available - The locales that have messages or a loader.
 * @returns {object} The bridge instance.
 */
export function createLocaleStore(initial) {
  return bridge({
    state: {
      locale: initial.locale,
      fallback: initial.fallback,
      available: initial.available,
      /**
       * True while a lazily loaded locale is in flight. Reactive, so a
       * template can show a spinner without the plugin owning one.
       */
      loading: false,
      /**
       * Bumped whenever a catalogue is added or replaced.
       *
       * Messages are not reactive, so something has to tell the components
       * that read them that they changed. One counter does it for all of them:
       * a lazily loaded locale arriving is a single write that re-renders
       * exactly the components which called `t()`.
       */
      revision: 0,
    },

    /**
     * Changes the active locale. Emits `change` with the new tag.
     * @param {string} tag - The canonical locale to activate.
     */
    setLocale(tag) {
      if (this.locale === tag) {
        return;
      }
      const previous = this.locale;
      this.locale = tag;
      this.emit('change', { locale: tag, previous });
    },

    /**
     * Replaces the fallback locales.
     * @param {string[]} tags - The canonical fallback locales, in order.
     */
    setFallback(tags) {
      this.fallback = tags;
      this.revision++;
    },

    /**
     * Records which locales the application can switch to.
     * @param {string[]} tags - The canonical available locales.
     */
    setAvailable(tags) {
      this.available = tags;
    },

    /**
     * Records whether a lazily loaded locale is in flight.
     * @param {boolean} value - True while loading.
     */
    setLoading(value) {
      this.loading = value;
    },

    /**
     * Announces that the catalogues changed.
     */
    touch() {
      this.revision++;
    },
  });
}
