/**
 * The persistence lifecycle for one bridge.
 *
 * A controller owns exactly two directions of movement:
 *
 *   storage -> state  once, when the bridge initializes ({@link PersistenceController#restore})
 *   state -> storage  on every change, coalesced into one write per tick
 *
 * The second direction is driven by `watchEffect`, so the plugin learns about
 * changes the same way a component does. There is no polling, no second update
 * mechanism and no copy of the state: the bridge remains the only place the
 * data lives.
 *
 * Every write goes through the bridge's own `this` facade — the one `setup()`
 * receives — so "state is only written from inside the bridge" still holds
 * with the plugin installed.
 * @module @avenx/persistence/controller
 */

import { queueJob, watchEffect } from './runtime.js';
import { report } from './diagnostics.js';
import { getPluginDefaults } from './registry.js';
import { browserLocalStorage } from './storage.js';
import { clone, isPlainObject, packEnvelope, readEnvelope, snapshot } from './serialize.js';

/**
 * Configuration applied when neither `persist()` nor the plugin says otherwise.
 * @type {object}
 */
const BUILT_IN_DEFAULTS = {
  prefix: 'avenx:',
  version: 1,
  restore: true,
  serialize: JSON.stringify,
  deserialize: JSON.parse,
};

/**
 * Reports whether a storage error is the browser refusing on grounds of space.
 * @param {any} error - The error thrown by the storage adapter.
 * @returns {boolean} True when the write failed because the quota is full.
 */
function isQuotaError(error) {
  if (!error) {
    return false;
  }
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014
  );
}

/**
 * Drives persistence for a single bridge.
 */
export class PersistenceController {
  /** @type {object|null} */
  #config = null;
  /** @type {Function|null} */
  #stopWatcher = null;
  /** @type {string|null} */
  #lastWritten = null;
  /**
   * True while the tracking effect is being created. The first run exists to
   * register dependencies, not to report a change, so it must not write.
   * @type {boolean}
   */
  #priming = false;
  /** @type {Function} */
  #saveJob;

  /**
   * @param {string} key - The persistence key, unique within the application.
   * @param {object} owner - The bridge's own write-capable state facade.
   * @param {string[]} keys - The state keys this controller persists.
   * @param {object} options - The options passed to `persist()`.
   */
  constructor(key, owner, keys, options) {
    /** @type {string} */
    this.key = key;
    /**
     * The bridge this controller belongs to. Created once by `bridge()` and
     * stable across `$dispose`, which is what lets a re-initialized bridge be
     * recognised as the same one rather than as a key collision.
     * @type {object}
     */
    this.owner = owner;
    /** @type {string[]} */
    this.keys = keys;
    /** @type {object} */
    this.options = options;

    // One stable job identity: the scheduler deduplicates by reference, so a
    // hundred mutations in one tick collapse into a single write.
    this.#saveJob = () => this.save();
  }

  /**
   * Whether this controller has resolved its configuration yet.
   * @returns {boolean} True once configuration has been read.
   */
  get resolved() {
    return this.#config !== null;
  }

  /**
   * Whether the controller is currently watching its bridge.
   * @returns {boolean} True between start() and stop().
   */
  get active() {
    return this.#stopWatcher !== null;
  }

  /**
   * Replaces the keys and options a re-initialized bridge declared.
   * @param {string[]} keys - The state keys to persist.
   * @param {object} options - The options passed to `persist()`.
   */
  reconfigure(keys, options) {
    this.keys = keys;
    this.options = options;
    this.#config = null;
    // What storage last received belonged to the previous life of this bridge.
    // Forgetting it means the next save is decided by comparing against the
    // store, not against a value from before the state was reset.
    this.#lastWritten = null;
  }

  /**
   * Resolves configuration once, layering `persist()` options over the
   * application defaults over the built-in ones.
   * @returns {object} The resolved configuration.
   */
  #resolve() {
    if (this.#config) {
      return this.#config;
    }
    const merged = { ...BUILT_IN_DEFAULTS, ...getPluginDefaults(), ...this.options };
    merged.storage = merged.storage || browserLocalStorage();
    merged.storageKey = `${merged.prefix}${this.key}`;
    this.#config = merged;
    return merged;
  }

  /**
   * The context handed to the diagnostics reporter.
   * @returns {object} The reporting context.
   */
  #context() {
    return { key: this.key, onError: this.#resolve().onError };
  }

  /**
   * Serializes the current state, or returns null when serialization failed.
   * @returns {string|null} The envelope text, or null.
   */
  #serializeCurrent() {
    const config = this.#resolve();
    let text;
    try {
      text = config.serialize(packEnvelope(snapshot(this.owner, this.keys), config.version));
    } catch (error) {
      report(this.#context(), 'serialize', 'state could not be serialized and was not persisted', error);
      return null;
    }
    if (typeof text !== 'string') {
      report(
        this.#context(),
        'serialize',
        `serialize() returned ${typeof text} instead of a string; nothing was persisted`,
      );
      return null;
    }
    return text;
  }

  /**
   * Begins persisting: restores once, then watches for changes.
   *
   * Restoration deliberately runs before the effect is created. Writing the
   * restored values into state is itself a state change, and a watcher that
   * already existed would answer it by saving what it had just read back — the
   * feedback loop this ordering removes by construction.
   */
  start() {
    if (this.#stopWatcher) {
      return;
    }
    const config = this.#resolve();

    if (config.restore) {
      this.restore();
    }

    this.#priming = true;
    try {
      this.#stopWatcher = watchEffect(
        () => {
          // Reading each persisted key registers this effect as a dependent of
          // it; `deep` walks the returned values so a nested or array mutation
          // is tracked too. The read is the subscription.
          const tracked = this.keys.map((key) => this.owner[key]);
          if (!this.#priming) {
            queueJob(this.#saveJob);
          }
          return tracked;
        },
        { deep: true, name: `avenx-persistence:${this.key}` },
      );
    } finally {
      this.#priming = false;
    }
  }

  /**
   * Stops watching. Any change made in the same tick is written first, so a
   * teardown never loses the last mutation.
   */
  stop() {
    if (!this.#stopWatcher) {
      return;
    }
    this.save();
    this.#stopWatcher();
    this.#stopWatcher = null;
  }

  /**
   * Writes the current state, unless it is byte-for-byte what storage already
   * holds. Failures are reported and swallowed: a browser that will not store
   * data is not a reason for the application to stop.
   */
  save() {
    if (!this.#stopWatcher) {
      // Not watching: either persistence has not started, or the bridge was
      // disposed. Writing here would store the definition's defaults over data
      // the next page load still wants.
      return;
    }
    const config = this.#resolve();
    const text = this.#serializeCurrent();
    if (text === null || text === this.#lastWritten) {
      return;
    }

    try {
      config.storage.setItem(config.storageKey, text);
      this.#lastWritten = text;
    } catch (error) {
      if (isQuotaError(error)) {
        report(this.#context(), 'quota', 'storage quota exceeded; this change was not persisted', error);
      } else {
        report(this.#context(), 'write', 'storage rejected the write; this change was not persisted', error);
      }
    }
  }

  /**
   * Reads persisted state and writes it back into the bridge.
   *
   * Every failure below leaves the bridge with the defaults its definition
   * declared, which is the same state a first-time visitor gets.
   * @returns {boolean} True when state was restored.
   */
  restore() {
    const config = this.#resolve();

    let raw;
    try {
      raw = config.storage.getItem(config.storageKey);
    } catch (error) {
      report(this.#context(), 'read', 'storage could not be read; the application default state was kept', error);
      return false;
    }
    if (raw === null || raw === undefined) {
      return false;
    }

    let parsed;
    try {
      parsed = config.deserialize(raw);
    } catch (error) {
      report(this.#context(), 'deserialize', 'persisted data could not be deserialized and was ignored', error);
      return false;
    }

    const envelope = readEnvelope(parsed);
    if (!envelope.ok) {
      report(this.#context(), 'malformed', `persisted data was ignored: ${envelope.reason}`);
      return false;
    }

    const data = this.#reconcileVersion(envelope, config);
    if (!data) {
      return false;
    }

    return this.#apply(data);
  }

  /**
   * Brings persisted data up to the current schema version, or rejects it.
   * @param {object} envelope - The validated envelope.
   * @param {object} config - The resolved configuration.
   * @returns {object|null} Usable state, or null when the data must be discarded.
   */
  #reconcileVersion(envelope, config) {
    if (envelope.version === config.version) {
      return envelope.state;
    }

    if (typeof config.migrate !== 'function') {
      report(
        this.#context(),
        'version',
        `persisted data was written for version ${envelope.version} but this application expects ${config.version}; it was discarded`,
      );
      return null;
    }

    let migrated;
    try {
      migrated = config.migrate(envelope.state, envelope.version, config.version);
    } catch (error) {
      report(
        this.#context(),
        'migrate',
        `migrate() threw while upgrading from version ${envelope.version}; the data was discarded`,
        error,
      );
      return null;
    }
    if (!isPlainObject(migrated)) {
      report(
        this.#context(),
        'migrate',
        `migrate() declined to upgrade version ${envelope.version}; the data was discarded`,
      );
      return null;
    }
    return migrated;
  }

  /**
   * Writes restored values into bridge state through the bridge's own facade.
   *
   * Only keys the bridge declares are written. A key that has since been
   * renamed or removed is dropped rather than resurrected, which is what stops
   * an older release's data from reappearing as state nothing reads.
   * @param {object} data - The state to restore.
   * @returns {boolean} True when at least one key was written.
   */
  #apply(data) {
    let restored = 0;
    let unknown = 0;

    for (const key of Object.keys(data)) {
      if (!this.keys.includes(key)) {
        unknown++;
      }
    }
    for (const key of this.keys) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        continue;
      }
      try {
        this.owner[key] = clone(data[key]);
        restored++;
      } catch (error) {
        // The bridge refused the write — the key turned out to be a getter or
        // another member the plugin may not assign. Drop it rather than let one
        // key stop the rest of the restore.
        this.keys = this.keys.filter((entry) => entry !== key);
        report(this.#context(), 'malformed', `state key "${key}" cannot be written and is no longer persisted`, error);
      }
    }

    if (unknown > 0) {
      report(
        this.#context(),
        'malformed',
        `persisted data held ${unknown} key(s) this bridge no longer declares; they were ignored`,
      );
    }

    // Whatever storage holds, the state now serializes to this. Recording it
    // means the change the restore just made is not written straight back.
    this.#lastWritten = this.#serializeCurrent();
    return restored > 0;
  }

  /**
   * Removes this key's persisted data. State is left untouched: clearing is
   * about what a reload will find, not about what the application is showing.
   */
  clear() {
    const config = this.#resolve();
    try {
      config.storage.removeItem(config.storageKey);
    } catch (error) {
      report(this.#context(), 'write', 'storage rejected the removal; persisted data may remain', error);
    }
    this.#lastWritten = null;
  }
}
