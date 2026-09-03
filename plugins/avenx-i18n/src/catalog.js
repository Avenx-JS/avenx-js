/**
 * Translation resources, and what the plugin turns them into.
 *
 * An application declares messages as nested objects because that is how
 * translators and translation management systems work with them:
 *
 *   { home: { title: 'Welcome', description: 'Welcome to Avenx' } }
 *
 * A lookup, though, asks for `home.title`, and it asks on every render. Walking
 * the nesting each time would mean one property access per dotted segment, on
 * objects that never change — so resources are flattened once, when they are
 * registered, into a Map keyed by the dotted path. A lookup is then a single
 * `Map.get`, and the depth of the resource file stops mattering.
 *
 * Catalogues are held here, outside Avenx's reactive state, on purpose.
 * Messages are read constantly and written almost never; wrapping tens of
 * thousands of them in reactive proxies would cost memory and tracking work
 * for changes that do not happen. What *is* reactive — the active locale, and
 * a revision counter bumped whenever a catalogue changes — lives in the store,
 * which is what components actually depend on.
 * @module @avenx/i18n/catalog
 */

import { configError } from './diagnostics.js';

/**
 * The plural categories `Intl.PluralRules` can select, plus the `zero` an
 * author may declare explicitly for an exact count of none.
 * @type {Set<string>}
 */
export const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Reports whether an object is a plural form rather than a nested group.
 *
 * A plural form is an object whose keys are all plural categories and whose
 * values are all strings. `{ one: '1 item', other: '{count} items' }` is one;
 * `{ one: { title: '...' } }` is a group that happens to be called `one`, and
 * flattening keeps descending into it.
 * @param {object} value - The node to classify.
 * @returns {boolean} True when the node is a plural form.
 */
export function isPluralForm(value) {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((key) => PLURAL_CATEGORIES.has(key) && typeof value[key] === 'string');
}

/**
 * A translation catalogue for one locale: dotted key to message.
 */
export class Catalog {
  /**
   * @param {string} locale - The canonical locale this catalogue holds.
   */
  constructor(locale) {
    /** @type {string} */
    this.locale = locale;
    /**
     * Dotted key to message. A message is a string, or a plural form object.
     * @type {Map<string, string|object>}
     */
    this.entries = new Map();
  }

  /**
   * Merges a nested resource object into this catalogue.
   *
   * Malformed branches are dropped rather than thrown on: one mistyped value
   * in a large resource file must not cost the application every other message
   * in it. Each one is reported so it is still visible.
   * @param {object} resource - The nested messages to add.
   * @param {function(string, string, object=): void} report - The failure reporter.
   * @returns {number} How many messages were added or replaced.
   */
  merge(resource, report) {
    let added = 0;

    /**
     * Walks one node of the resource tree.
     * @param {any} node - The current node.
     * @param {string} prefix - The dotted path to this node.
     */
    const walk = (node, prefix) => {
      for (const key of Object.keys(node)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        const value = node[key];

        if (typeof value === 'string') {
          this.entries.set(path, value);
          added++;
          continue;
        }
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          if (isPluralForm(value)) {
            this.entries.set(path, { ...value });
            added++;
            continue;
          }
          walk(value, path);
          continue;
        }

        report('malformed', `translation "${path}" is ${describe(value)} rather than a message and was ignored`, {
          key: path,
          locale: this.locale,
        });
      }
    };

    walk(resource, '');
    return added;
  }

  /**
   * Looks one key up.
   * @param {string} key - The dotted translation key.
   * @returns {string|object|undefined} The message, or undefined.
   */
  get(key) {
    return this.entries.get(key);
  }

  /**
   * Reports whether this catalogue defines a key.
   * @param {string} key - The dotted translation key.
   * @returns {boolean} True when the key is defined here.
   */
  has(key) {
    return this.entries.has(key);
  }

  /**
   * How many messages this catalogue holds.
   * @returns {number} The message count.
   */
  get size() {
    return this.entries.size;
  }
}

/**
 * Names a value's type for a diagnostic message.
 * @param {any} value - The offending value.
 * @returns {string} A short description.
 */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * Validates the shape of a resource object handed to the plugin.
 * @param {any} value - The candidate resource.
 * @param {string} label - How to name the caller in an error message.
 * @returns {object} The validated resource.
 */
export function assertResource(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw configError(`${label} expects an object of messages, received ${describe(value)}.`);
  }
  return value;
}
