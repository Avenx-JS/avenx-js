/**
 * Snapshotting and the stored envelope format.
 *
 * What reaches storage is never a bare state object. It is an envelope:
 *
 *   { "avenx": 1, "version": 3, "state": { ... } }
 *
 * `avenx` identifies the envelope format itself, so a key that holds
 * something else entirely — another library's data, a hand-edited value — is
 * recognised as foreign instead of being restored as state. `version` is the
 * application's own schema version, which is what makes stale data from an
 * earlier release detectable. See {@link readEnvelope}.
 * @module @avenx/persistence/serialize
 */

/**
 * Version of the envelope format written by this plugin. It changes only if
 * the envelope itself ever changes, which is not the same thing as an
 * application bumping its own `version`.
 * @type {number}
 */
export const ENVELOPE_FORMAT = 1;

/**
 * Reports whether a value is a plain object literal.
 * @param {any} value - The value to test.
 * @returns {boolean} True for `{}`-style objects, false for arrays and everything else.
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-copies plain objects and arrays, passing every other value through.
 *
 * This mirrors how `bridge()` copies its own initial state: class instances,
 * Dates, Maps and functions are shared by reference rather than mangled into
 * something that only looks like them.
 * @param {any} value - The value to copy.
 * @returns {any} A copy for plain containers, or the original value.
 */
export function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (isPlainObject(value)) {
    const copy = {};
    for (const key of Object.keys(value)) {
      copy[key] = clone(value[key]);
    }
    return copy;
  }
  return value;
}

/**
 * Reads the named keys off reactive state into a detached plain object.
 *
 * The result is what a custom `serialize` function receives, so it holds no
 * proxies: a serializer can inspect and reshape it without accidentally
 * registering reactive dependencies or writing back into the application.
 * @param {object} source - The bridge state to read from.
 * @param {string[]} keys - The state keys to include.
 * @returns {object} A plain snapshot of those keys.
 */
export function snapshot(source, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = clone(source[key]);
  }
  return result;
}

/**
 * Wraps a snapshot in the stored envelope.
 * @param {object} state - The snapshot to store.
 * @param {number} version - The application's schema version.
 * @returns {object} The envelope to serialize.
 */
export function packEnvelope(state, version) {
  return { avenx: ENVELOPE_FORMAT, version, state };
}

/**
 * Validates a deserialized value as an envelope.
 *
 * A rejection is never fatal: the caller reports it and carries on with the
 * application's own defaults, which is the whole point of storing a shape
 * that can be checked rather than a bare object that cannot.
 * @param {any} value - The deserialized stored value.
 * @returns {{ok: boolean, state?: object, version?: number, reason?: string}} The validation result.
 */
export function readEnvelope(value) {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'stored value is not an object' };
  }
  if (value.avenx !== ENVELOPE_FORMAT) {
    return { ok: false, reason: 'stored value was not written by this plugin' };
  }
  if (typeof value.version !== 'number' || !Number.isFinite(value.version)) {
    return { ok: false, reason: 'stored value has no usable version' };
  }
  if (!isPlainObject(value.state)) {
    return { ok: false, reason: 'stored value carries no state object' };
  }
  return { ok: true, state: value.state, version: value.version };
}
