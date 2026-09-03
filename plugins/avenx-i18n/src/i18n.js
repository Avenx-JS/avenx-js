/**
 * `createI18n()` — the translator itself.
 *
 * One instance owns the catalogues, the locale bridge, and the handful of
 * functions an application actually calls: `t`, `tHtml`, `n`, `d`, `rel` and
 * `locale`. The plugin installs one of these into an application; a test can
 * make as many as it likes, because nothing here is module-global.
 *
 * The reactive contract is the whole point and is worth stating plainly:
 * `t()` reads `locale` and `revision` off the bridge on every call. When it is
 * called during a render, the component's render watcher is the active watcher,
 * so those two reads register the component as a dependent of the locale.
 * Switching locale writes one value, Avenx notifies exactly the watchers that
 * read it, and each of those components re-renders through the normal DOM
 * patcher — which touches only the text nodes whose content actually changed.
 * A component that never translates anything never subscribes and is never
 * touched.
 * @module @avenx/i18n/i18n
 */

import { assertResource, Catalog } from './catalog.js';
import { configError, createReporter } from './diagnostics.js';
import { formatDate, formatNumber, formatRelative } from './format.js';
import { interpolate, parseMessage } from './interpolate.js';
import { expandLocale, normalizeLocale, resolveChain } from './locale.js';
import { normalizeOptions } from './options.js';
import { selectPlural } from './plural.js';
import { HtmlEscaper, SafeHtml, Sanitizer } from './runtime.js';
import { createLocaleStore } from './store.js';

/**
 * Separator between a locale and a key in the resolution cache. A NUL cannot
 * appear in a locale tag or in a translation key, so no two pairs collide.
 * @type {string}
 */
const CACHE_SEPARATOR = '\u0000';

/**
 * Parsed message segments, keyed by the message text.
 *
 * Keyed by content rather than by locale and key, so the same message written
 * once in twenty places is parsed once — and so the cache never goes stale when
 * a catalogue is replaced.
 * @type {Map<string, Array<string|{name: string}>>}
 */
const segmentCache = new Map();

/**
 * Parses a message once and remembers the result.
 * @param {string} message - The raw message.
 * @returns {Array<string|{name: string}>} The parsed segments.
 */
function segmentsFor(message) {
  let segments = segmentCache.get(message);
  if (!segments) {
    segments = parseMessage(message);
    segmentCache.set(message, segments);
  }
  return segments;
}

/**
 * Empties the shared message-segment cache. Exposed for tests.
 */
export function resetSegmentCache() {
  segmentCache.clear();
}

/**
 * Creates an i18n instance.
 * @param {object} [options] - See the plugin documentation.
 * @param {string} [options.locale] - The starting locale. Defaults to 'en'.
 * @param {string|string[]|null} [options.fallbackLocale] - Locales tried when the active one has no message. Defaults to 'en'.
 * @param {object} [options.messages] - Translation resources, keyed by locale tag.
 * @param {object} [options.loaders] - Functions returning a locale's messages, keyed by locale tag.
 * @param {object} [options.formats] - Named `Intl` presets under `number`, `date` and `relative`.
 * @param {'key'|Function} [options.missing] - What a missing key renders as. Defaults to the key itself.
 * @param {object} [options.storage] - Storage adapter used to remember the chosen locale.
 * @param {string} [options.storageKey] - Where in that adapter to keep it. Defaults to 'avenx:locale'.
 * @param {Function} [options.onError] - Called with `{ phase, message, key, locale, error }` on any failure.
 * @returns {object} The i18n instance.
 */
export function createI18n(options = {}) {
  const config = normalizeOptions(options, 'createI18n()');
  const owner = { onError: config.onError };
  const report = createReporter(owner);

  /** @type {Map<string, Catalog>} */
  const catalogs = new Map();
  /** @type {Map<string, Function>} */
  const loaders = new Map(Object.entries(config.loaders));
  /** @type {Map<string, Promise<boolean>>} */
  const inFlight = new Map();

  /**
   * Resolved lookups, keyed by locale and translation key. Emptied whenever the
   * catalogues change, which is the only thing that can change an answer.
   * @type {Map<string, {message: string|object, locale: string}|null>}
   */
  const resolutionCache = new Map();
  /**
   * Fallback chains by locale. Emptied when the fallback locales change.
   * @type {Map<string, string[]>}
   */
  const chainCache = new Map();

  const escaper = new HtmlEscaper();
  /** @type {object|null} */
  let sanitizer = null;
  /**
   * The catalogue revision the resolution cache was built against. One counter
   * invalidates every cached answer, which is the only thing that can change
   * them.
   * @type {number}
   */
  let cacheGeneration = 0;

  /**
   * Registers messages for one locale, creating its catalogue if needed.
   * @param {string} tag - A canonical locale tag.
   * @param {object} resource - The nested messages.
   */
  const mergeInto = (tag, resource) => {
    let catalog = catalogs.get(tag);
    if (!catalog) {
      catalog = new Catalog(tag);
      catalogs.set(tag, catalog);
    }
    catalog.merge(resource, report);
  };

  for (const [tag, resource] of Object.entries(config.messages)) {
    mergeInto(tag, resource);
  }

  /**
   * Every locale the application can switch to: one with messages, or one a
   * loader can fetch.
   * @returns {string[]} The canonical tags, sorted for a stable render.
   */
  const availableLocales = () => [...new Set([...catalogs.keys(), ...loaders.keys()])].sort();

  const store = createLocaleStore({
    locale: config.locale,
    fallback: config.fallback,
    available: availableLocales(),
  });

  /**
   * The lookup chain for a locale, computed once per locale.
   * @param {string} locale - The active canonical locale.
   * @returns {string[]} The chain, most specific first.
   */
  const chainFor = (locale) => {
    let chain = chainCache.get(locale);
    if (!chain) {
      chain = resolveChain(locale, store.fallback);
      chainCache.set(locale, chain);
    }
    return chain;
  };

  /**
   * Finds a key in the first catalogue along the chain that defines it.
   * @param {string} key - The dotted translation key.
   * @param {string} locale - The active canonical locale.
   * @returns {{message: string|object, locale: string}|null} The hit, or null.
   */
  const resolve = (key, locale) => {
    const cacheKey = `${locale}${CACHE_SEPARATOR}${key}`;
    if (resolutionCache.has(cacheKey)) {
      return resolutionCache.get(cacheKey);
    }

    let hit = null;
    for (const step of chainFor(locale)) {
      const catalog = catalogs.get(step);
      if (catalog && catalog.has(key)) {
        hit = { message: catalog.get(key), locale: step };
        break;
      }
    }
    resolutionCache.set(cacheKey, hit);
    return hit;
  };

  /**
   * Reads the catalogue revision — which is what subscribes the caller to
   * catalogue changes — and empties the derived caches when it moved.
   * @returns {number} The current revision.
   */
  const syncCache = () => {
    const revision = store.revision;
    if (revision !== cacheGeneration) {
      cacheGeneration = revision;
      resolutionCache.clear();
      chainCache.clear();
    }
    return revision;
  };

  /**
   * Announces that the catalogues changed. Bumping the revision is what both
   * empties the caches and re-renders the components that translate.
   */
  const invalidate = () => {
    store.setAvailable(availableLocales());
    store.touch();
  };

  /**
   * Renders what a missing key should show.
   * @param {string} key - The key that was not found.
   * @param {string} locale - The active locale.
   * @returns {string} The placeholder text.
   */
  const renderMissing = (key, locale) => {
    report('missing', `no translation for "${key}"`, { key, locale });

    if (typeof config.missing === 'function') {
      try {
        const replacement = config.missing(key, locale);
        if (typeof replacement === 'string') {
          return replacement;
        }
        report('missing', `the "missing" handler returned ${typeof replacement} rather than a string for "${key}"`, {
          key,
          locale,
        });
      } catch (error) {
        report('missing', `the "missing" handler threw while handling "${key}"`, { key, locale, error });
      }
    }
    // The key itself. Never an empty string: a gap that renders as nothing is
    // a gap nobody reports, and a dotted key names exactly what to go and add.
    return key;
  };

  /**
   * Translates a key. The shared implementation behind `t` and `tHtml`.
   * @param {any} key - The dotted translation key.
   * @param {object} params - Interpolation values, `count` included.
   * @param {function(string): string} [escape] - Applied to substituted values only.
   * @returns {string} The translated text.
   */
  const translate = (key, params, escape) => {
    // Both reads are the subscription: performed inside a component's render,
    // they make that component a dependent of the locale and of the catalogue
    // revision, and of nothing else.
    const locale = store.locale;
    syncCache();

    if (typeof key !== 'string' || key === '') {
      report('key', `a translation key must be a non-empty string, received ${JSON.stringify(key)}`, { locale });
      return '';
    }

    const hit = resolve(key, locale);
    if (!hit) {
      return renderMissing(key, locale);
    }

    const context = { key, locale: hit.locale, report, escape };
    let message = hit.message;

    if (typeof message !== 'string') {
      message = selectPlural(message, params ? params.count : undefined, hit.locale, context);
      if (message === null) {
        return renderMissing(key, locale);
      }
    }

    return interpolate(segmentsFor(message), params, context);
  };

  /**
   * Formatting context handed to the `Intl` helpers, rebuilt per call so it
   * always carries the locale that is active now — and so that reading it
   * subscribes the caller to locale changes exactly as `t()` does.
   * @returns {object} The formatting context.
   */
  const formatContext = () => ({ locale: store.locale, formats: config.formats, report });

  /**
   * Loads a locale's messages through its registered loader.
   * @param {any} tag - The locale to load.
   * @returns {Promise<boolean>} True when messages are now available.
   */
  const load = (tag) => {
    const canonical = normalizeLocale(tag);
    if (!canonical) {
      report('locale', `"${String(tag)}" is not a valid locale tag and was not loaded`);
      return Promise.resolve(false);
    }
    if (catalogs.has(canonical)) {
      return Promise.resolve(true);
    }
    const pending = inFlight.get(canonical);
    if (pending) {
      return pending;
    }

    const loader = loaders.get(canonical);
    if (!loader) {
      report('load', `no messages and no loader are registered for "${canonical}"`, { locale: canonical });
      return Promise.resolve(false);
    }

    store.setLoading(true);
    const request = Promise.resolve()
      .then(() => loader(canonical))
      .then((loaded) => {
        // A dynamic `import()` resolves to a module namespace; the messages are
        // its default export. A loader may equally return the object outright.
        const resource = loaded && typeof loaded === 'object' && 'default' in loaded ? loaded.default : loaded;
        assertResource(resource, `the loader for "${canonical}"`);
        mergeInto(canonical, resource);
        invalidate();
        return true;
      })
      .catch((error) => {
        // A locale that will not download is not a reason for the application
        // to stop: the active locale is left alone and the chain keeps
        // answering. The caller is told, and may retry.
        report('load', `the loader for "${canonical}" failed; the locale was not changed`, {
          locale: canonical,
          error,
        });
        return false;
      })
      .finally(() => {
        inFlight.delete(canonical);
        if (inFlight.size === 0) {
          store.setLoading(false);
        }
      });

    inFlight.set(canonical, request);
    return request;
  };

  /**
   * Reports whether a locale, or one of its own ancestors, has messages.
   *
   * Ancestors count, so switching to `en-GB` when only `en` is registered is
   * ordinary regional fallback and says nothing. The configured fallback
   * locales deliberately do not count: they would cover every tag ever passed
   * in, including a typo, which is exactly what this is here to catch.
   * @param {string} canonical - A canonical locale tag.
   * @returns {boolean} True when the locale has messages of its own.
   */
  const isCovered = (canonical) => expandLocale(canonical).some((step) => catalogs.get(step)?.size > 0);

  /**
   * Activates a locale, loading it first when it is lazy.
   * @param {any} tag - The locale to switch to.
   * @returns {Promise<string>} The locale that ended up active.
   */
  const setLocale = (tag) => {
    const canonical = normalizeLocale(tag);
    if (!canonical) {
      report('locale', `"${String(tag)}" is not a valid locale tag; the locale was not changed`);
      return Promise.resolve(store.locale);
    }
    if (canonical === store.locale) {
      return Promise.resolve(canonical);
    }

    /**
     * Switches, once whatever had to be loaded has been.
     * @returns {string} The active locale.
     */
    const activate = () => {
      if (!isCovered(canonical)) {
        report(
          'missing-locale',
          `no messages are registered for "${canonical}"; it will render through the fallback chain`,
          { locale: canonical },
        );
      }
      store.setLocale(canonical);
      return store.locale;
    };

    // Only the exact tag is worth loading: `de-CH` falls back to `de`, so a
    // loader for `de-CH` is what would make it more than that.
    const needsLoad = !catalogs.has(canonical) && loaders.has(canonical);
    if (!needsLoad) {
      return Promise.resolve(activate());
    }
    // A locale that was going to be loaded and could not be is not switched to.
    // Activating it anyway would drop the user into a language the application
    // has no messages for, over one it does — a worse outcome than staying put,
    // and one the caller can see because the resolved locale is unchanged.
    return load(canonical).then((loaded) => (loaded ? activate() : store.locale));
  };

  /**
   * The locale handle. Its identity is stable, and every read on it goes
   * through the reactive bridge — so `{{ locale.current }}` in a template
   * updates like any other reactive value.
   * @type {object}
   */
  const locale = {
    /**
     * @returns {string} The active locale.
     */
    get current() {
      return store.locale;
    },
    /**
     * @returns {string[]} The configured fallback locales, in order.
     */
    get fallback() {
      return [...store.fallback];
    },
    /**
     * @returns {string[]} Every locale that has messages or a loader.
     */
    get available() {
      return [...store.available];
    },
    /**
     * @returns {boolean} True while a lazily loaded locale is in flight.
     */
    get loading() {
      return store.loading;
    },
    /**
     * @returns {string[]} The chain a lookup walks for the active locale.
     */
    get chain() {
      return [...chainFor(store.locale)];
    },
    set: setLocale,
    load,
    /**
     * Reports whether the active locale is, or descends from, a tag.
     *
     * `locale.is('de')` is true for both `de` and `de-CH`, which is what a
     * template asking "are we in German?" means.
     * @param {any} tag - The locale to test against.
     * @returns {boolean} True when the active locale matches.
     */
    is(tag) {
      const canonical = normalizeLocale(tag);
      return canonical ? expandLocale(store.locale).includes(canonical) : false;
    },
  };

  const instance = {
    /**
     * Translates a key into the active locale.
     * @param {string} key - The dotted translation key, e.g. 'home.title'.
     * @param {object} [params] - Interpolation values. A numeric `count` also selects the plural form.
     * @returns {string} The translated text. Plain text, escaped by the template like any other value.
     */
    t(key, params) {
      return translate(key, params, undefined);
    },

    /**
     * Translates a key whose message contains markup.
     *
     * The message is sanitized and returned as `SafeHtml`, which the Avenx
     * renderer inserts without escaping. Interpolated values are HTML-escaped
     * first, so a parameter can contribute text to the sentence but never
     * markup — a translated string is never a template.
     * @param {string} key - The dotted translation key.
     * @param {object} [params] - Interpolation values.
     * @returns {object} A `SafeHtml` value.
     */
    tHtml(key, params) {
      if (!sanitizer) {
        sanitizer = new Sanitizer();
      }
      const text = translate(key, params, (value) => escaper.escape(value));
      return new SafeHtml(sanitizer.sanitize(text));
    },

    /**
     * Formats a number in the active locale.
     * @param {any} value - The number to format.
     * @param {string|object} [options] - A configured preset name, or `Intl.NumberFormat` options.
     * @returns {string} The formatted number.
     */
    n(value, options) {
      return formatNumber(value, options, formatContext());
    },

    /**
     * Formats a date or time in the active locale.
     * @param {any} value - A Date, a timestamp, or a date string.
     * @param {string|object} [options] - A configured preset name, or `Intl.DateTimeFormat` options.
     * @returns {string} The formatted date.
     */
    d(value, options) {
      return formatDate(value, options, formatContext());
    },

    /**
     * Formats a relative time in the active locale.
     * @param {number} value - The signed offset: negative is past, positive is future.
     * @param {string} unit - An `Intl.RelativeTimeFormat` unit, e.g. 'day'.
     * @param {string|object} [options] - A configured preset name, or `Intl.RelativeTimeFormat` options.
     * @returns {string} The formatted value.
     */
    rel(value, unit, options) {
      return formatRelative(value, unit, options, formatContext());
    },

    locale,

    /**
     * Reports whether a key resolves, without rendering it or reporting a miss.
     * @param {string} key - The dotted translation key.
     * @param {string} [tag] - The locale to ask about. Defaults to the active one.
     * @returns {boolean} True when the key resolves along that locale's chain.
     */
    has(key, tag) {
      if (typeof key !== 'string' || key === '') {
        return false;
      }
      syncCache();
      const canonical = tag === undefined ? store.locale : normalizeLocale(tag);
      return canonical ? resolve(key, canonical) !== null : false;
    },

    /**
     * Registers additional messages for a locale, merging them into whatever is
     * already there. Components that translate re-render; nothing else does.
     * @param {string} tag - The locale these messages belong to.
     * @param {object} resource - The nested messages.
     */
    addMessages(tag, resource) {
      const canonical = normalizeLocale(tag);
      if (!canonical) {
        throw configError(`addMessages() received "${String(tag)}", which is not a valid locale tag.`);
      }
      assertResource(resource, `addMessages("${canonical}")`);
      mergeInto(canonical, resource);
      invalidate();
    },

    /**
     * Registers a loader for a locale that is fetched on demand.
     * @param {string} tag - The locale the loader provides.
     * @param {Function} loader - Returns the locale's messages, or a promise for them.
     */
    addLoader(tag, loader) {
      const canonical = normalizeLocale(tag);
      if (!canonical) {
        throw configError(`addLoader() received "${String(tag)}", which is not a valid locale tag.`);
      }
      if (typeof loader !== 'function') {
        throw configError(`addLoader("${canonical}") expects a function returning the locale's messages.`);
      }
      loaders.set(canonical, loader);
      store.setAvailable(availableLocales());
    },

    /**
     * Replaces the fallback locales.
     * @param {string|string[]|null} tags - The new fallback locales, in order.
     */
    setFallbackLocale(tags) {
      const { fallback } = normalizeOptions({ fallbackLocale: tags }, 'setFallbackLocale()');
      store.setFallback(fallback);
    },

    /**
     * Subscribes to a locale change. Called inside a component lifecycle hook,
     * the subscription is released when that component unmounts, because this
     * is the bridge's own `on()`.
     * @param {string} event - Currently only 'change'.
     * @param {Function} handler - Invoked with `{ locale, previous }`.
     * @returns {Function} The unsubscribe function.
     */
    on(event, handler) {
      return store.on(event, handler);
    },

    /**
     * The underlying Avenx bridge. Exposed for devtools, for `app.registerBridge`,
     * and for anything that wants to treat the locale as the ordinary piece of
     * reactive shared state that it is.
     * @type {object}
     */
    $bridge: store,
  };

  if (config.storage) {
    attachStorage(instance, store, config, report);
  }

  return instance;
}

/**
 * Remembers the chosen locale, and restores it on the next visit.
 *
 * This is deliberately expressed against the storage-adapter interface rather
 * than against `@avenx/persistence`: pass `browserLocalStorage()` from that
 * plugin, `window.localStorage`, or three functions of your own, and neither
 * plugin has to know the other exists.
 *
 * A stored tag is only adopted when the application can actually render it —
 * a locale removed in a later release must not strand a returning user in a
 * language the bundle no longer has.
 * @param {object} instance - The i18n instance.
 * @param {object} store - The locale bridge.
 * @param {object} config - The normalized configuration.
 * @param {function(string, string, object=): void} report - The failure reporter.
 */
function attachStorage(instance, store, config, report) {
  let stored = null;
  try {
    stored = config.storage.getItem(config.storageKey);
  } catch (error) {
    report('storage', 'the stored locale could not be read; the configured locale was kept', { error });
  }

  if (typeof stored === 'string' && stored !== '') {
    const canonical = normalizeLocale(stored);
    if (!canonical) {
      report('storage', `the stored locale "${stored}" is not a valid locale tag and was ignored`);
    } else if (!expandLocale(canonical).some((step) => instance.locale.available.includes(step))) {
      report('storage', `the stored locale "${canonical}" is no longer available and was ignored`, {
        locale: canonical,
      });
    } else {
      instance.locale.set(canonical);
    }
  }

  store.on('change', ({ locale }) => {
    try {
      config.storage.setItem(config.storageKey, locale);
    } catch (error) {
      // A full quota or a browser that refuses to store anything. The
      // application keeps working; only "remembers your language" is lost.
      report('storage', 'the chosen locale could not be stored', { locale, error });
    }
  });
}
