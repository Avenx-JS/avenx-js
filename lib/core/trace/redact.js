/**
 * @file redact.js
 * @description Property-path redaction for traces.
 *
 * A trace records real application state, which means it records whatever the
 * user typed. Redaction happens at *record* time, not at export time: a value
 * a rule matches is never written into the buffer at all, so a trace cannot
 * leak a secret that a later export step forgot to strip.
 *
 * Patterns are matched against the same dotted property paths the reactive
 * system already produces (see `getPropertyPath` in `reactive/watcher.js`), so
 * `auth.token` and `cart.items.2.cardNumber` are both addressable.
 * @module lib/core/trace/redact
 */

import { REDACTED } from './schema.js';

/**
 * The shortest withheld value that is worth scrubbing out of source text.
 * @type {number}
 */
const MIN_SCRUBBABLE_LENGTH = 6;

/**
 * How deep a withheld object is walked when collecting scrubbable strings.
 * @type {number}
 */
const REMEMBER_MAX_DEPTH = 6;

/**
 * How many strings are remembered from a single withheld value.
 *
 * A rule that matches a large object should not turn the redactor into a
 * copy of that object.
 * @type {number}
 */
const REMEMBER_MAX_STRINGS = 200;

/**
 * Escapes the regular-expression metacharacters in a literal path segment.
 * @param {string} segment - A literal segment.
 * @returns {string} The escaped segment.
 */
function escapeSegment(segment) {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles one redaction pattern into a matcher.
 *
 * Supported syntax, deliberately small:
 *
 * - `auth.token` — that exact path.
 * - `auth.*` — any single segment under `auth`.
 * - `*.password` — `password` under any single segment.
 * - `auth.**` — `auth` and everything beneath it, at any depth.
 *
 * A pattern that matches a path also redacts everything nested below it: a
 * rule for `auth.token` must not be defeated by the value happening to be an
 * object. That also makes `auth` and `auth.**` equivalent, which is why `**`
 * needs no special handling beyond ending the pattern.
 * @param {string} pattern - The pattern source.
 * @returns {RegExp} A matcher anchored to the whole path.
 */
function compilePattern(pattern) {
  const parts = [];
  for (const segment of String(pattern).split('.')) {
    if (segment === '**') {
      break;
    }
    parts.push(segment === '*' ? '[^.]+' : escapeSegment(segment));
  }

  if (parts.length === 0) {
    return /^.*$/;
  }
  return new RegExp(`^${parts.join('\\.')}(?:\\..*)?$`);
}

/**
 * A compiled set of redaction rules.
 *
 * Held per recorder rather than globally, so a test can record with different
 * rules than the dev server without leaking configuration between them.
 */
export class Redactor {
  /**
   * @param {string[]} [patterns] - Redaction patterns from `avenx.config.json` or the runtime API.
   */
  constructor(patterns = []) {
    /**
     * The patterns as written, kept so an exported trace can declare what was
     * withheld from it.
     * @type {string[]}
     */
    this.patterns = [];
    /** @type {RegExp[]} */
    this.matchers = [];
    /**
     * True once a value has actually been withheld. A trace that declares
     * rules but never matched one is not a redacted trace.
     * @type {boolean}
     */
    this.applied = false;
    /** @type {Set<string>} */
    this.matchedPaths = new Set();

    /**
     * String values a rule actually withheld.
     *
     * Kept so the same value can be scrubbed out of recorded *source text*.
     * A trace records the verbatim body of every action it ran — that is what
     * lets it name the code responsible — and an action with a literal in it
     * would otherwise carry a value the path rules just withheld. These are
     * values already resident in the application's own memory; nothing new is
     * retained, and the set dies with the recorder.
     * @type {Set<string>}
     */
    this.withheldValues = new Set();

    for (const pattern of patterns) {
      this.add(pattern);
    }
  }

  /**
   * Registers an additional pattern.
   * @param {string} pattern - The pattern source.
   * @returns {Redactor} This redactor, for chaining.
   */
  add(pattern) {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      return this;
    }
    const trimmed = pattern.trim();
    if (this.patterns.includes(trimmed)) {
      return this;
    }
    this.patterns.push(trimmed);
    this.matchers.push(compilePattern(trimmed));
    return this;
  }

  /**
   * Whether this redactor has any rules at all. Hot paths check this first, so
   * an unconfigured recorder pays nothing for the feature.
   * @returns {boolean}
   */
  get isEmpty() {
    return this.matchers.length === 0;
  }

  /**
   * Whether a property path must be withheld.
   * @param {string} path - A dotted property path, e.g. `auth.token`.
   * @returns {boolean}
   */
  matches(path) {
    if (this.matchers.length === 0 || typeof path !== 'string' || path === '') {
      return false;
    }
    for (const matcher of this.matchers) {
      if (matcher.test(path)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Notes that a rule fired for a path.
   *
   * Separate from {@link Redactor#matches} because capture cannot detect a
   * redaction by comparing values: `NaN !== NaN` would make every NaN look
   * like a withheld value.
   * @param {string} path - The path a rule matched.
   * @param {any} [value] - The withheld value, remembered so it can also be
   *   scrubbed out of recorded source text.
   */
  markApplied(path, value) {
    this.applied = true;
    this.matchedPaths.add(path);
    this.#remember(value, REMEMBER_MAX_DEPTH);
  }

  /**
   * Collects the strings inside a withheld value.
   *
   * Withholding `{ email, name }` withholds the email, so the email string is
   * a secret wherever else it appears — in a recorded call's arguments, for
   * instance, which no path rule covers.
   *
   * Short strings are excluded: scrubbing a two-character value out of every
   * recorded expression would mangle unrelated source for no benefit.
   * @param {any} value - A withheld value.
   * @param {number} depth - Remaining depth budget.
   * @private
   */
  #remember(value, depth) {
    if (this.withheldValues.size >= REMEMBER_MAX_STRINGS) {
      return;
    }
    if (typeof value === 'string') {
      if (value.length >= MIN_SCRUBBABLE_LENGTH) {
        this.withheldValues.add(value);
      }
      return;
    }
    if (depth <= 0 || value === null || typeof value !== 'object') {
      return;
    }
    try {
      const entries = Array.isArray(value) ? value : Object.values(value);
      for (const entry of entries) {
        this.#remember(entry, depth - 1);
      }
    } catch {
      // A throwing getter costs one value's worth of scrubbing, not the trace.
    }
  }

  /**
   * Removes any withheld value from a piece of recorded source text.
   *
   * Applied when a trace is serialized rather than when a node is recorded: an
   * action's source is captured before its writes run, so the value it
   * contains is not yet known to be a secret at that point.
   * @param {string} text - Recorded source text.
   * @returns {string} The text, with withheld values replaced.
   */
  scrub(text) {
    if (typeof text !== 'string' || this.withheldValues.size === 0) {
      return text;
    }
    let scrubbed = text;
    for (const secret of this.withheldValues) {
      if (scrubbed.includes(secret)) {
        scrubbed = scrubbed.split(secret).join(REDACTED);
      }
    }
    return scrubbed;
  }

  /**
   * Returns the value to record for a path: the value itself, or the redaction
   * placeholder when a rule matched.
   * @param {string} path - The property path the value sits at.
   * @param {any} value - The candidate value.
   * @returns {any} What may be recorded.
   */
  guard(path, value) {
    if (this.matches(path)) {
      this.markApplied(path, value);
      return REDACTED;
    }
    return value;
  }
}

/**
 * A redactor with no rules, shared by callers that have not configured any.
 * @type {Redactor}
 */
export const NO_REDACTION = new Redactor();
