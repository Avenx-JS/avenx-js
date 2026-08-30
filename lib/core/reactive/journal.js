/**
 * @file journal.js
 * @description The write journal behind Avenx Rewind.
 *
 * An action marked `atomic` runs inside a *transaction*. Every state write it
 * makes — its own, and those of any bridge action it calls — is journaled, and
 * if it fails the journal is played backwards until the state is what it was
 * before the action ran.
 *
 * ## Why this can live in the framework rather than in a library
 *
 * Every mutation of Avenx state passes through one of a handful of proxy traps
 * in `proxyHandler.js`, and each of those traps already knows the target, the
 * key, the value before and the value after. A journal placed there sees a
 * `state.busy = true`, a `cart.items[2].qty += 1` reached through a bridge, and
 * an `items.push(row)`, without the developer listing any of them.
 *
 * ## Cost when nothing is transactional
 *
 * `journal.active` is a plain own property, read once per write and compared
 * once. The pattern is copied deliberately from `tracer.on`: with no
 * transaction open, no descriptor is allocated and nothing else in the
 * reactive system changes shape.
 *
 * ## Why a rewind restores through the handler
 *
 * Putting a value back on the raw target would leave the UI showing the value
 * that was rolled back, because nothing would wake. Restoring through the same
 * `ProxyHandlerFactory` that recorded the write means a rewind is an ordinary
 * write as far as watchers, the scheduler and the patcher are concerned — the
 * DOM corrects itself with no special case anywhere.
 *
 * ## What it deliberately does not do
 *
 * The journal follows the *dynamic extent* of the action. A write made inside
 * a `.then()` continuation runs after the action has already handed back its
 * promise, so the journal never sees it. That is a real limit, it is reported
 * at build time as AVX_W42, and it is not papered over here.
 * @module lib/core/reactive/journal
 */

import { trigger } from './watcher.js';
import { RAW_SYMBOL } from './symbols.js';
import { logger } from '../runtime/AvenxLogger.js';
import { tracer } from '../trace/tracer.js';
import { traceRewindOutcome, traceRewindStart } from '../trace/transaction.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';

/**
 * What a rewind does when it finds a value the transaction did not write.
 * @readonly
 * @enum {string}
 */
export const ConflictPolicy = {
  /** Leave the newer value alone and report it. The default. */
  SAFE: 'safe',
  /** Restore regardless. For a transaction that is the authority on the value. */
  FORCE: 'force',
  /** Restore what is safe, then throw. */
  ABORT: 'abort',
};

/**
 * How many entries a collection may hold before the journal stops snapshotting it.
 *
 * A `push` onto a ten-thousand row list would otherwise copy the list. The
 * limit is not a silent truncation: a collection over it marks the frame
 * partial, and the rewind reports what it could not restore.
 * @type {number}
 */
export const DEFAULT_MAX_SNAPSHOT_ITEMS = 10000;

/**
 * Marks the absence of a value, so that restoring a key that did not exist can
 * be told apart from restoring one whose value was `undefined`.
 * @type {symbol}
 */
const ABSENT = Symbol('avenx.journal.absent');

/**
 * Unwraps a reactive proxy without going through its `get` trap.
 *
 * `toRaw()` would call `track()` and attribute the read to whichever watcher is
 * running, which would make journaling change what the application depends on.
 * @param {any} value - A possibly reactive value.
 * @returns {any} The raw value.
 */
function unwrap(value) {
  if (value !== null && typeof value === 'object') {
    const raw = value[RAW_SYMBOL];
    if (raw) return raw;
  }
  return value;
}

/**
 * The size of a journaled collection.
 * @param {object} target - An array, Map or Set.
 * @returns {number} Its entry count.
 */
function collectionSize(target) {
  if (Array.isArray(target)) return target.length;
  if (target instanceof Map || target instanceof Set) return target.size;
  return 0;
}

/**
 * One transaction's record of what it changed.
 *
 * Entries are kept in first-touch order and replayed in reverse, so a key
 * written three times is restored once, to the value it had before the
 * transaction started.
 */
export class JournalFrame {
  /**
   * @param {object} [options] - Frame options.
   * @param {string} [options.owner] - The component or bridge that owns the action.
   * @param {string} [options.name] - The action name, used in diagnostics.
   * @param {string} [options.onConflict] - The conflict policy for this frame.
   * @param {number} [options.maxSnapshotItems] - Collection snapshot ceiling.
   */
  constructor(options = {}) {
    /** @type {string} */
    this.owner = options.owner || '';
    /** @type {string} */
    this.name = options.name || 'anonymous';
    /** @type {string} */
    this.onConflict = options.onConflict || ConflictPolicy.SAFE;
    /** @type {number} */
    this.maxSnapshotItems =
      typeof options.maxSnapshotItems === 'number' && options.maxSnapshotItems > 0
        ? options.maxSnapshotItems
        : DEFAULT_MAX_SNAPSHOT_ITEMS;

    /**
     * Property writes, in first-touch order.
     * @type {Array<object>}
     */
    this.entries = [];
    /**
     * Target to key to entry, for deduplication.
     * @type {Map<object, Map<string|number, object>>}
     */
    this.index = new Map();
    /**
     * Collection savepoints, in first-touch order.
     * @type {Array<object>}
     */
    this.collections = [];
    /** @type {Map<object, object>} */
    this.collectionIndex = new Map();
    /**
     * Paths this frame knows it cannot restore, discovered while recording.
     * @type {string[]}
     */
    this.unrewindable = [];
    /** @type {boolean} */
    this.settled = false;
  }

  /**
   * Whether the frame recorded anything at all.
   * @returns {boolean} True when a rewind would have work to do.
   */
  get empty() {
    return this.entries.length === 0 && this.collections.length === 0;
  }

  /**
   * Records a property write.
   * @param {object} target - The raw object that was mutated.
   * @param {string|number} key - The mutated key.
   * @param {any} oldValue - The value before the mutation.
   * @param {any} newValue - The value after it.
   * @param {boolean} existed - Whether the key was an own property beforehand.
   * @param {object} handler - The ProxyHandlerFactory that owns this target.
   * @returns {void}
   */
  recordWrite(target, key, oldValue, newValue, existed, handler) {
    let keys = this.index.get(target);
    if (!keys) {
      keys = new Map();
      this.index.set(target, keys);
    }
    const existing = keys.get(key);
    if (existing) {
      // A key written twice keeps its original savepoint; only where it ended
      // up matters for conflict detection.
      existing.last = unwrap(newValue);
      return;
    }
    const entry = {
      target,
      key,
      handler,
      first: existed ? unwrap(oldValue) : ABSENT,
      last: unwrap(newValue),
    };
    keys.set(key, entry);
    this.entries.push(entry);
  }

  /**
   * Records a deletion.
   * @param {object} target - The raw object.
   * @param {string|number} key - The deleted key.
   * @param {any} oldValue - The value it held.
   * @param {boolean} existed - Whether the key was there to begin with.
   * @param {object} handler - The ProxyHandlerFactory that owns this target.
   * @returns {void}
   */
  recordDelete(target, key, oldValue, existed, handler) {
    let keys = this.index.get(target);
    if (!keys) {
      keys = new Map();
      this.index.set(target, keys);
    }
    const existing = keys.get(key);
    if (existing) {
      existing.last = ABSENT;
      return;
    }
    const entry = {
      target,
      key,
      handler,
      first: existed ? unwrap(oldValue) : ABSENT,
      last: ABSENT,
    };
    keys.set(key, entry);
    this.entries.push(entry);
  }

  /**
   * Takes a savepoint of a collection before it is mutated.
   *
   * An array method, a `Map.set` or a `Set.add` has no single before-and-after
   * pair to journal — `splice` can move every element at once — so the whole
   * container is copied, once, the first time the transaction touches it.
   * @param {object} target - The raw array, Map or Set.
   * @param {object} handler - The ProxyHandlerFactory that owns this target.
   * @param {string} fallback - What to call it when it has no resolvable path.
   * @returns {void}
   */
  recordCollection(target, handler, fallback) {
    if (this.collectionIndex.has(target)) return;

    // Naming costs a walk up the parent chain, so it happens here — once per
    // collection per transaction — rather than on every `push` that finds a
    // savepoint already taken.
    const label = describe(target, undefined) || fallback;
    const size = collectionSize(target);
    if (size > this.maxSnapshotItems) {
      this.collectionIndex.set(target, null);
      this.unrewindable.push(`${label} (${size} entries exceeds rewind.maxSnapshotItems=${this.maxSnapshotItems})`);
      return;
    }

    let snapshot;
    let kind;
    if (Array.isArray(target)) {
      kind = 'array';
      snapshot = target.slice();
    } else if (target instanceof Map) {
      kind = 'map';
      snapshot = new Map(target);
    } else if (target instanceof Set) {
      kind = 'set';
      snapshot = new Set(target);
    } else {
      return;
    }

    const record = { target, handler, kind, snapshot, label };
    this.collectionIndex.set(target, record);
    this.collections.push(record);
  }

  /**
   * Plays the frame backwards.
   *
   * Property writes are restored through the handler that recorded them, so a
   * rewind wakes watchers exactly as the original write did. Collections are
   * restored in place and then triggered, because there is no single key whose
   * assignment would describe the change.
   * @returns {{restored: number, conflicts: Array<{path: string, expected: any, found: any}>, unrewindable: string[]}}
   *   What the rewind managed to do.
   */
  rewind() {
    const conflicts = [];
    let restored = 0;
    const force = this.onConflict === ConflictPolicy.FORCE;

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const current = entry.target[entry.key];
      const present = Object.prototype.hasOwnProperty.call(entry.target, entry.key);
      const currentValue = present ? unwrap(current) : ABSENT;

      if (!force && currentValue !== entry.last) {
        conflicts.push({
          path: describe(entry.target, entry.key),
          expected: entry.last === ABSENT ? undefined : entry.last,
          found: currentValue === ABSENT ? undefined : currentValue,
        });
        continue;
      }

      try {
        if (entry.first === ABSENT) {
          entry.handler.deleteProperty(entry.target, entry.key);
        } else {
          entry.handler.set(entry.target, entry.key, entry.first);
        }
        restored++;
      } catch (error) {
        conflicts.push({
          path: describe(entry.target, entry.key),
          expected: entry.last === ABSENT ? undefined : entry.last,
          found: `restore threw: ${(error && error.message) || error}`,
        });
      }
    }

    for (let i = this.collections.length - 1; i >= 0; i--) {
      const record = this.collections[i];
      if (!record) continue;
      try {
        restoreCollection(record);
        restored++;
      } catch (error) {
        conflicts.push({
          path: record.label,
          expected: `${record.kind} savepoint`,
          found: `restore threw: ${(error && error.message) || error}`,
        });
      }
    }

    return { restored, conflicts, unrewindable: this.unrewindable };
  }
}

/**
 * Puts a collection back and wakes whatever depended on it.
 * @param {object} record - A collection savepoint.
 * @returns {void}
 */
function restoreCollection(record) {
  const { target, snapshot, kind, handler } = record;
  if (kind === 'array') {
    target.length = 0;
    for (let i = 0; i < snapshot.length; i++) target[i] = snapshot[i];
    trigger(target, 'length');
  } else if (kind === 'map') {
    const keys = new Set([...target.keys(), ...snapshot.keys()]);
    target.clear();
    for (const [key, value] of snapshot) target.set(key, value);
    trigger(target, [...keys, 'size']);
  } else if (kind === 'set') {
    const keys = new Set([...target.values(), ...snapshot.values()]);
    target.clear();
    for (const value of snapshot) target.add(value);
    trigger(target, [...keys, 'size']);
  }
  if (handler && typeof handler.notifyChange === 'function') {
    handler.notifyChange(target);
  }
}

/**
 * Names a target and key for a conflict report.
 *
 * The full property path is recovered from the parent chain when it is still
 * intact; a detached object falls back to the bare key rather than reporting a
 * path that no longer describes anything.
 * @param {object} target - The raw object.
 * @param {string|number} key - The key.
 * @returns {string} A readable path.
 */
function describe(target, key) {
  try {
    // Injected rather than imported, so the journal does not pull the
    // watcher's naming surface into its own import shape.
    const path = pathResolver ? pathResolver(target, key) : '';
    if (path) return path;
    return key === undefined ? '' : String(key);
  } catch {
    return key === undefined ? '' : String(key);
  }
}

/**
 * How the journal turns a target and key into a readable path.
 * @type {((target: object, key: any) => string)|null}
 */
let pathResolver = null;

/**
 * Installs the property-path resolver used in conflict reports.
 *
 * Set by `proxyHandler.js`, which already imports `getPropertyPath`. Keeping
 * it injected rather than imported means the journal does not have to reach
 * into the watcher's naming rules to produce a diagnostic string.
 * @param {(target: object, key: any) => string} resolver - The resolver.
 * @returns {void}
 */
export function setPathResolver(resolver) {
  pathResolver = typeof resolver === 'function' ? resolver : null;
}

/**
 * The transaction stack.
 *
 * A singleton for the same reason the tracer is one: the reactive system is
 * module-scoped, so a per-application journal would have to be threaded
 * through every trap.
 */
class Journal {
  /**
   * Constructs the idle journal installed at import time.
   */
  constructor() {
    /**
     * Hot-path flag. Read by every mutation site, so it is a plain own
     * property rather than a getter over `frames.length`.
     * @type {boolean}
     */
    this.active = false;

    /**
     * Frames whose dynamic extent is currently executing, innermost last.
     * @type {JournalFrame[]}
     */
    this.frames = [];

    /**
     * Project defaults, installed by the application at startup.
     * @type {{onConflict: string, maxSnapshotItems: number}}
     */
    this.defaults = {
      onConflict: ConflictPolicy.SAFE,
      maxSnapshotItems: DEFAULT_MAX_SNAPSHOT_ITEMS,
    };
  }

  /**
   * Applies project-level Rewind configuration.
   * @param {object} [options] - `rewind` from avenx.config.json.
   * @param {string} [options.onConflict] - Default conflict policy.
   * @param {number} [options.maxSnapshotItems] - Default collection ceiling.
   * @returns {void}
   */
  configure(options = {}) {
    if (options.onConflict && Object.values(ConflictPolicy).includes(options.onConflict)) {
      this.defaults.onConflict = options.onConflict;
    }
    if (typeof options.maxSnapshotItems === 'number' && options.maxSnapshotItems > 0) {
      this.defaults.maxSnapshotItems = options.maxSnapshotItems;
    }
  }

  /**
   * The frame currently recording, or null.
   * @returns {JournalFrame|null} The innermost open frame.
   */
  current() {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }

  /**
   * Records a property write into the open frame.
   * @param {object} target - The raw object that was mutated.
   * @param {string|number} key - The mutated key.
   * @param {any} oldValue - The value before the mutation.
   * @param {any} newValue - The value after it.
   * @param {boolean} existed - Whether the key was an own property beforehand.
   * @param {object} handler - The ProxyHandlerFactory that owns this target.
   * @returns {void}
   */
  recordWrite(target, key, oldValue, newValue, existed, handler) {
    const frame = this.current();
    if (frame) frame.recordWrite(target, key, oldValue, newValue, existed, handler);
  }

  /**
   * Records a deletion into the open frame.
   * @param {object} target - The raw object.
   * @param {string|number} key - The deleted key.
   * @param {any} oldValue - The value it held.
   * @param {boolean} existed - Whether the key was there to begin with.
   * @param {object} handler - The ProxyHandlerFactory that owns this target.
   * @returns {void}
   */
  recordDelete(target, key, oldValue, existed, handler) {
    const frame = this.current();
    if (frame) frame.recordDelete(target, key, oldValue, existed, handler);
  }

  /**
   * Takes a collection savepoint in the open frame.
   * @param {object} target - The raw array, Map or Set.
   * @param {object} handler - The ProxyHandlerFactory that owns this target.
   * @param {string} fallback - What to call it when it has no resolvable path.
   * @returns {void}
   */
  recordCollection(target, handler, fallback) {
    const frame = this.current();
    if (frame) frame.recordCollection(target, handler, fallback);
  }

  /**
   * Opens a frame and makes it the recording target.
   * @param {object} [options] - Frame options; see {@link JournalFrame}.
   * @returns {JournalFrame} The opened frame.
   */
  begin(options = {}) {
    const frame = new JournalFrame({
      onConflict: options.onConflict || this.defaults.onConflict,
      maxSnapshotItems: options.maxSnapshotItems || this.defaults.maxSnapshotItems,
      owner: options.owner,
      name: options.name,
    });
    this.frames.push(frame);
    this.active = true;
    return frame;
  }

  /**
   * Closes a frame's dynamic extent.
   *
   * Truncating to the frame's depth rather than popping blindly means an
   * exception that unwound past a `close` cannot leave the journal recording
   * into a frame that has already finished.
   * @param {JournalFrame} frame - The frame to close.
   * @returns {void}
   */
  close(frame) {
    const index = this.frames.lastIndexOf(frame);
    if (index !== -1) {
      this.frames.length = index;
    }
    this.active = this.frames.length > 0;
  }

  /**
   * Runs a function as a transaction.
   *
   * The outcome is the function's own: it commits by returning, and rewinds by
   * throwing or by handing back a promise that rejects. Nothing else is
   * introduced, because an action already has both of those.
   *
   * A transaction opened while another is recording joins it instead of
   * opening a second frame. That is what makes an atomic bridge action called
   * from an atomic component action undo exactly once.
   * @template T
   * @param {object} spec - `{owner, name, onConflict}`.
   * @param {function(): T} fn - The action body.
   * @returns {T} Whatever `fn` returned.
   */
  run(spec, fn) {
    if (this.frames.length > 0) {
      // Nested: the enclosing transaction already owns these writes.
      return fn();
    }

    const frame = this.begin(spec);
    let result;
    try {
      result = fn();
    } catch (error) {
      this.close(frame);
      this.#rewind(frame);
      throw error;
    }

    if (result && typeof result.then === 'function') {
      // The frame leaves the recording stack here — anything the continuation
      // writes is outside the action's dynamic extent — but stays open until
      // the promise says whether it committed.
      this.close(frame);
      return result.then(
        (value) => value,
        (error) => {
          this.#rewind(frame);
          throw error;
        },
      );
    }

    this.close(frame);
    return result;
  }

  /**
   * Rewinds a frame and reports whatever it could not restore.
   * @param {JournalFrame} frame - The frame to play backwards.
   * @returns {void}
   */
  #rewind(frame) {
    if (frame.settled) return;
    frame.settled = true;
    if (frame.empty && frame.unrewindable.length === 0) return;

    // A value that changes back on its own is the most confusing thing a trace
    // can contain. Opening a node around the rewind makes every restoring
    // write a child of the transaction that undid it.
    const scope = tracer.on ? traceRewindStart(frame) : { token: -1, id: null };
    let outcome;
    try {
      outcome = frame.rewind();
    } finally {
      if (scope.token >= 0) {
        traceRewindOutcome(scope.id, outcome || { restored: 0, conflicts: [], unrewindable: [] });
        tracer.leave(scope.token);
      }
    }
    const problems = [
      ...outcome.conflicts.map(
        (conflict) => `  ${conflict.path} — wrote ${format(conflict.expected)}, found ${format(conflict.found)}`,
      ),
      ...outcome.unrewindable.map((entry) => `  ${entry}`),
    ];

    if (problems.length === 0) return;

    const label = frame.owner ? `${frame.owner}.${frame.name}` : frame.name;
    const message = formatMessage(
      AvenxErrorCodes.TRANSACTION_REWIND_FAILED,
      label,
      problems.length,
      problems.join('\n'),
      frame.onConflict,
    );

    if (frame.onConflict === ConflictPolicy.ABORT) {
      throw new AvenxError(
        AvenxErrorCodes.TRANSACTION_REWIND_FAILED,
        label,
        problems.length,
        problems.join('\n'),
        frame.onConflict,
      );
    }
    logger.error(message);
  }

  /**
   * Drops every open frame. Used by tests and by teardown.
   * @returns {void}
   */
  reset() {
    this.frames.length = 0;
    this.active = false;
  }
}

/**
 * Renders a value for a conflict report.
 * @param {any} value - The value.
 * @returns {string} A short, readable form.
 */
function format(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      const text = JSON.stringify(value);
      return text && text.length > 80 ? `${text.slice(0, 77)}...` : text;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * The journal every mutation site records through.
 * @type {Journal}
 */
export const journal = new Journal();
