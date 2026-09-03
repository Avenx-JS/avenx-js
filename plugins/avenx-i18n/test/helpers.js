/**
 * Shared fixtures for the i18n test suite.
 * @module plugins/avenx-i18n/test/helpers
 */

import { AvenxComponent, logger } from '../../../lib/core/index.js';
import { resetDiagnostics } from '../src/diagnostics.js';
import { resetFormatCache } from '../src/format.js';
import { resetSegmentCache } from '../src/i18n.js';
import { resetPluralCache } from '../src/plural.js';

/**
 * Every message the Avenx logger emitted since the last reset.
 * @type {Array<{level: string, text: string}>}
 */
export const logged = [];

/**
 * Replaces the logger's console transport so diagnostics can be asserted on
 * instead of scrolling past. Called once, before any test runs.
 */
export function captureLogs() {
  logger.configure({
    level: 'trace',
    transports: [
      {
        /**
         * @param {string} level - The log level.
         * @param {any[]} formatted - The formatted arguments.
         */
        log(level, formatted) {
          logged.push({
            level,
            text: formatted.map((part) => String(part && part.message ? part.message : part)).join(' '),
          });
        },
      },
    ],
  });
}

/**
 * Returns the logged messages that mention a fragment.
 * @param {string} fragment - Text to look for.
 * @returns {Array<{level: string, text: string}>} The matching entries.
 */
export function loggedMatching(fragment) {
  return logged.filter((entry) => entry.text.includes(fragment));
}

/**
 * Clears everything that outlives a single scenario.
 *
 * The plugin's caches are keyed by content rather than by instance, which is
 * what lets two instances share the work of parsing the same message — and is
 * why a suite of independent scenarios has to empty them between runs if it
 * wants to assert on what was parsed or warned about.
 */
export function reset() {
  resetDiagnostics();
  resetSegmentCache();
  resetFormatCache();
  resetPluralCache();
  AvenxComponent.clearMixins();
  logged.length = 0;
}

/**
 * The message set most scenarios translate against.
 *
 * `de-CH` deliberately defines only one key: everything else has to arrive
 * through `de`, and then through the fallback locale, which is what makes the
 * chain observable.
 * @returns {object} Messages by locale.
 */
export function messages() {
  return {
    en: {
      home: {
        title: 'Welcome',
        description: 'Welcome to Avenx',
      },
      navigation: { settings: 'Settings' },
      errors: { network: { timeout: 'The request timed out' } },
      welcome: { user: 'Hello, {name}!' },
      cart: {
        summary: '{name}, you have {count} items worth {total}',
        items: { one: '{count} item', other: '{count} items' },
        empty: { zero: 'Your cart is empty', one: '{count} item', other: '{count} items' },
      },
    },
    de: {
      home: {
        title: 'Willkommen',
        description: 'Willkommen bei Avenx',
      },
      navigation: { settings: 'Einstellungen' },
      welcome: { user: 'Hallo, {name}!' },
      cart: { items: { one: '{count} Element', other: '{count} Elemente' } },
    },
    'de-CH': {
      home: { title: 'Grüezi' },
    },
    pl: {
      cart: {
        items: {
          one: '{count} plik',
          few: '{count} pliki',
          many: '{count} plików',
          other: '{count} pliku',
        },
      },
    },
  };
}

/**
 * Creates an in-memory storage adapter, the same shape `@avenx/persistence`
 * adapters have.
 * @param {object} [seed] - Entries the adapter starts with.
 * @returns {object} The adapter, with a `counts` record of what was asked of it.
 */
export function memoryStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  const counts = { reads: 0, writes: 0, removals: 0 };
  return {
    counts,
    /**
     * @param {string} key - The entry to read.
     * @returns {string|null} The stored value, or null when absent.
     */
    getItem(key) {
      counts.reads++;
      return entries.has(key) ? entries.get(key) : null;
    },
    /**
     * @param {string} key - The entry to write.
     * @param {string} value - The value to store.
     */
    setItem(key, value) {
      counts.writes++;
      entries.set(key, String(value));
    },
    /**
     * @param {string} key - The entry to remove.
     */
    removeItem(key) {
      counts.removals++;
      entries.delete(key);
    },
  };
}

/**
 * Builds an adapter that throws from the chosen operations.
 * @param {object} options - Which operations fail, and with what.
 * @param {Error} [options.onGet] - Thrown by getItem.
 * @param {Error} [options.onSet] - Thrown by setItem.
 * @returns {object} The failing adapter.
 */
export function failingStorage({ onGet, onSet } = {}) {
  const inner = memoryStorage();
  return {
    /**
     * @param {string} key - The entry to read.
     * @returns {string|null} The stored value.
     */
    getItem(key) {
      if (onGet) throw onGet;
      return inner.getItem(key);
    },
    /**
     * @param {string} key - The entry to write.
     * @param {string} value - The value to store.
     */
    setItem(key, value) {
      if (onSet) throw onSet;
      inner.setItem(key, value);
    },
    /**
     * @param {string} key - The entry to remove.
     */
    removeItem(key) {
      inner.removeItem(key);
    },
  };
}

/**
 * Mounts a component built from a bare template, and counts its renders.
 *
 * Counting matters more here than in most suites: the claim this plugin makes
 * is that a locale change re-renders the components that translate and no
 * others, and that is only observable by watching how often each one renders.
 * @param {string} template - The component template.
 * @param {object} [state] - The component's initial state.
 * @returns {object} `{ component, root, renders, text }`.
 */
export function mountTemplate(template, state = {}) {
  const counter = { renders: 0 };

  /**
   * A component whose only job is to render the given template.
   */
  class Fixture extends AvenxComponent {
    /**
     * Builds the fixture component.
     */
    constructor() {
      super(state, {}, {}, template, {});
    }

    /**
     * Renders, recording that it happened.
     * @returns {string} The rendered HTML.
     */
    render() {
      counter.renders++;
      return super.render();
    }
  }

  const root = document.createElement('div');
  document.body.appendChild(root);
  const component = new Fixture();
  component.mount(root);

  return {
    component,
    root,
    counter,
    /**
     * @returns {string} The component's rendered text.
     */
    text() {
      return root.textContent;
    },
    /**
     * @returns {string} The component's rendered markup.
     */
    html() {
      return root.innerHTML;
    },
  };
}
