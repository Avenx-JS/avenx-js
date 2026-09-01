/**
 * @file capture.js
 * @description Bounded, redaction-aware value capture for traces.
 *
 * A trace has to hold *values* — the old and new side of every write, the body
 * of every resource response — and it has to hold them as JSON. Three things
 * make that harder than calling `JSON.stringify`:
 *
 * 1. The values are reactive proxies. Recording the proxy would re-enter the
 *    reactive system and track dependencies against whichever watcher happened
 *    to be running, silently changing application behaviour.
 * 2. Some values cannot survive the round trip (DOM nodes, class instances,
 *    functions, cycles). Recording a placeholder is fine; *claiming* the trace
 *    can be replayed afterwards is not, so capture reports when it was lossy.
 * 3. Some values must never be recorded at all. Redaction is applied here,
 *    during capture, so a secret never reaches the buffer.
 *
 * Capture is bounded in depth and breadth. A trace of a thousand-row list must
 * not clone the list a thousand times.
 * @module lib/core/trace/capture
 */

import { RAW_SYMBOL } from '../reactive/symbols.js';
import { NO_REDACTION } from './redact.js';
import { REDACTED } from './schema.js';

/**
 * How deep a captured value is walked before it is summarised.
 * @type {number}
 */
export const DEFAULT_MAX_DEPTH = 6;

/**
 * How many array entries or object keys are captured before the rest is
 * summarised as a count.
 * @type {number}
 */
export const DEFAULT_MAX_ITEMS = 50;

/**
 * How long a captured string may be before it is truncated.
 * @type {number}
 */
export const DEFAULT_MAX_STRING = 512;

/**
 * Set by {@link captureValue} when the most recent capture could not represent
 * a value exactly. Module-scoped rather than returned in a wrapper object
 * because capture runs on hot paths and this avoids an allocation per write.
 * Capture is synchronous, so there is no interleaving to worry about.
 * @type {boolean}
 */
let lastCaptureLossy = false;

/**
 * Whether the most recent {@link captureValue} call lost information.
 * @returns {boolean} True when the captured value is a summary, not the value.
 */
export function wasLossy() {
  return lastCaptureLossy;
}

/**
 * Unwraps a reactive proxy so capture reads the plain object underneath.
 *
 * `toRaw()` is not used here: it goes through the proxy's `get` trap, which
 * would call `track()` and attribute the read to whatever watcher is running.
 * Reading the symbol directly on a non-proxy is simply `undefined`.
 * @param {any} value - A possibly reactive value.
 * @returns {any} The raw value.
 */
function unwrap(value) {
  if (value !== null && typeof value === 'object') {
    const raw = value[RAW_SYMBOL];
    if (raw) {
      return raw;
    }
  }
  return value;
}

/**
 * Describes a value that cannot be represented in JSON.
 * @param {any} value - The value.
 * @returns {string} A short human-readable placeholder.
 */
function describeOpaque(value) {
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') {
    return `[Symbol ${String(value.description || '')}]`;
  }
  if (typeof value === 'bigint') {
    return `[BigInt ${value.toString()}]`;
  }
  if (value && typeof value === 'object') {
    if (typeof Node !== 'undefined' && value instanceof Node) {
      return `[DOM ${value.nodeName || 'Node'}]`;
    }
    const name = value.constructor && value.constructor.name;
    return `[${name || 'Object'}]`;
  }
  return '[Unserializable]';
}

/**
 * Recursively captures a value within the configured bounds.
 * @param {any} value - The value to capture.
 * @param {object} options - Capture options.
 * @param {string} path - The property path this value sits at.
 * @param {number} depth - Remaining depth budget.
 * @param {WeakSet<object>} seen - Objects already on the current branch.
 * @returns {any} A JSON-representable capture.
 */
function walk(value, options, path, depth, seen) {
  // Checked with `matches` rather than by comparing `guard`'s return value:
  // `NaN !== NaN`, so a value-identity check here would treat every NaN as if
  // it had been redacted and skip the rest of the walk.
  if (!options.redactor.isEmpty && options.redactor.matches(path)) {
    options.redactor.markApplied(path, value);
    return REDACTED;
  }

  const raw = unwrap(value);

  if (raw === null || raw === undefined) {
    return raw === undefined ? null : null;
  }

  const type = typeof raw;

  if (type === 'string') {
    if (raw.length > options.maxString) {
      lastCaptureLossy = true;
      return `${raw.slice(0, options.maxString)}… (+${raw.length - options.maxString} chars)`;
    }
    return raw;
  }
  if (type === 'boolean') {
    return raw;
  }
  if (type === 'number') {
    // NaN and the infinities have no JSON representation; recording them as
    // null would silently turn a bug into a passing replay.
    if (Number.isFinite(raw)) {
      return raw;
    }
    lastCaptureLossy = true;
    return `[${String(raw)}]`;
  }
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    lastCaptureLossy = true;
    return describeOpaque(raw);
  }

  if (raw instanceof Date) {
    return { $date: raw.toISOString() };
  }
  if (raw instanceof Error) {
    return { $error: raw.name || 'Error', message: String(raw.message || '') };
  }

  if (seen.has(raw)) {
    lastCaptureLossy = true;
    return '[Circular]';
  }

  if (depth <= 0) {
    lastCaptureLossy = true;
    return describeOpaque(raw);
  }

  if (Array.isArray(raw)) {
    seen.add(raw);
    try {
      const limit = Math.min(raw.length, options.maxItems);
      const out = [];
      for (let i = 0; i < limit; i++) {
        out.push(walk(raw[i], options, path ? `${path}.${i}` : String(i), depth - 1, seen));
      }
      if (raw.length > limit) {
        lastCaptureLossy = true;
        out.push(`… (+${raw.length - limit} more)`);
      }
      return out;
    } finally {
      seen.delete(raw);
    }
  }

  if (raw instanceof Map) {
    lastCaptureLossy = true;
    return { $map: raw.size };
  }
  if (raw instanceof Set) {
    lastCaptureLossy = true;
    return { $set: raw.size };
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== null && proto !== Object.prototype) {
    lastCaptureLossy = true;
    return describeOpaque(raw);
  }

  seen.add(raw);
  try {
    const out = {};
    const keys = Object.keys(raw);
    const limit = Math.min(keys.length, options.maxItems);
    for (let i = 0; i < limit; i++) {
      const key = keys[i];
      out[key] = walk(raw[key], options, path ? `${path}.${key}` : key, depth - 1, seen);
    }
    if (keys.length > limit) {
      lastCaptureLossy = true;
      out.$truncated = keys.length - limit;
    }
    return out;
  } finally {
    seen.delete(raw);
  }
}

/**
 * Captures a value for storage in a trace.
 *
 * Call {@link wasLossy} straight afterwards to learn whether the capture is
 * exact. A lossy capture is still worth recording — it explains the shape of
 * what happened — but it means replay cannot restore this value, and the
 * caller is responsible for downgrading the trace's determinism accordingly.
 * @param {any} value - The value to capture.
 * @param {object} [options] - Capture options.
 * @param {string} [options.path] - The property path the value sits at, used for redaction.
 * @param {object} [options.redactor] - Redaction rules.
 * @param {number} [options.maxDepth] - Depth budget.
 * @param {number} [options.maxItems] - Per-collection breadth budget.
 * @param {number} [options.maxString] - String length budget.
 * @returns {any} A JSON-representable capture of the value.
 */
export function captureValue(value, options = {}) {
  lastCaptureLossy = false;
  const resolved = {
    redactor: options.redactor || NO_REDACTION,
    maxDepth: options.maxDepth || DEFAULT_MAX_DEPTH,
    maxItems: options.maxItems || DEFAULT_MAX_ITEMS,
    maxString: options.maxString || DEFAULT_MAX_STRING,
  };
  try {
    return walk(value, resolved, options.path || '', resolved.maxDepth, new WeakSet());
  } catch {
    // A hostile getter can throw from anywhere in the walk. Losing the value is
    // acceptable; letting a recorder break the application is not.
    lastCaptureLossy = true;
    return '[Uncapturable]';
  }
}

/**
 * Formats a captured value for single-line display in `avenx trace view`.
 * @param {any} value - A captured value.
 * @returns {string} A compact rendering.
 */
export function formatCaptured(value) {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  }
  if (typeof value === 'object') {
    if (value.$date) {
      return value.$date;
    }
    if (value.$error) {
      return `${value.$error}: ${value.message}`;
    }
    try {
      const json = JSON.stringify(value);
      return json.length > 60 ? `${json.slice(0, 57)}...` : json;
    } catch {
      return '{…}';
    }
  }
  return String(value);
}
