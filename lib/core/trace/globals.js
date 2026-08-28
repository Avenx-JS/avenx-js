/**
 * @file globals.js
 * @description Deterministic substitution for the sandbox's global whitelist.
 *
 * This is the hinge the whole replay story turns on.
 *
 * Avenx evaluates every template expression, computed property and action body
 * as source text under `with(sandbox)`, and the sandbox proxy's `has` trap
 * claims every key. So *every* identifier those expressions resolve — `Date`,
 * `Math`, `state`, anything — passes through one `get` trap, and that trap
 * hands out globals from a single line. Substituting a recording clock there
 * costs nothing and cannot be bypassed from inside a template. Substituting a
 * replaying clock in the same place is what makes a recorded session
 * reproducible.
 *
 * Frameworks that compile expressions to closures have no equivalent point:
 * by the time the code runs, `Date` is a free variable resolved against the
 * real global scope, and the only way back in is to rewrite the program.
 *
 * ## What this does not cover
 *
 * Bridge modules and anything they import are ordinary ES modules. They are
 * not sandboxed, so a `Date.now()` in a bridge action reaches the real clock
 * and is invisible here. That is a genuine hole, and it is why recording does
 * not get the final say on whether a trace is deterministic — replay verifies
 * the claim by comparing observations. See `replay.js`.
 * @module lib/core/trace/globals
 */

import { tracer } from './tracer.js';
import { TraceNodeType } from './schema.js';

/**
 * Causal parents that have already been marked as reading a given
 * non-deterministic global, so a loop reading `Date.now()` a thousand times
 * produces one marker rather than a thousand.
 * @type {Set<string>}
 */
const markedReads = new Set();

/**
 * Records that application code observed a non-deterministic global.
 *
 * The values themselves go into the recorder's compact log; this marker exists
 * so the causal graph knows *where* the read happened. Contract analysis then
 * asks whether any ancestor of that point declared itself `deterministic` —
 * which is how a build-time contract becomes a claim checked against what the
 * code actually did. See `trace/contracts.js`.
 * @param {'now'|'random'} kind - Which source was read.
 */
function markGlobalRead(kind) {
  if (!tracer.sink) {
    return;
  }
  const parent = tracer.current();
  const key = `${parent}:${kind}`;
  if (markedReads.has(key)) {
    return;
  }
  markedReads.add(key);
  tracer.record(TraceNodeType.GLOBAL, {
    source: kind === 'now' ? 'Date.now' : 'Math.random',
    kind,
  });
}

/**
 * Globals currently substituted for sandbox lookups, keyed by identifier.
 *
 * Empty in normal operation, so {@link resolveSandboxGlobal} degenerates to a
 * `Map.size` check and a property read.
 * @type {Map<string, any>}
 */
const overrides = new Map();

/**
 * Resolves a whitelisted global for the expression sandbox.
 *
 * The sandbox calls this instead of reading `globalThis[key]` directly, so a
 * recording or replaying session can substitute a deterministic implementation
 * without patching the page's real globals — which would leak into unrelated
 * scripts and outlive the recording.
 * @param {string} key - The whitelisted global identifier.
 * @returns {any} The value template code should see.
 */
export function resolveSandboxGlobal(key) {
  if (overrides.size > 0 && overrides.has(key)) {
    return overrides.get(key);
  }
  return globalThis[key];
}

/**
 * Whether any global is currently substituted.
 * @returns {boolean}
 */
export function hasGlobalOverrides() {
  return overrides.size > 0;
}

/**
 * Removes every substitution, restoring the real globals.
 */
export function clearGlobalOverrides() {
  overrides.clear();
  markedReads.clear();
}

/**
 * Builds a `Date` stand-in that reports a caller-supplied clock.
 *
 * `prototype` is aliased to the real `Date.prototype` and construction
 * delegates to the real constructor, so instances are genuine `Date` objects
 * and `x instanceof Date` keeps working in application code.
 * @param {function(): number} readClock - Supplies the epoch milliseconds for a "now" reading.
 * @returns {Function} A drop-in replacement for `Date`.
 */
function buildDate(readClock) {
  const RealDate = Date;

  /**
   * A `Date` whose zero-argument form is supplied by the trace clock.
   * @param {...any} args - Standard `Date` arguments.
   * @returns {Date} A real Date instance.
   */
  function TracedDate(...args) {
    if (!new.target) {
      return new RealDate(readClock()).toString();
    }
    if (args.length === 0) {
      return new RealDate(readClock());
    }
    return new RealDate(...args);
  }

  TracedDate.prototype = RealDate.prototype;
  TracedDate.now = () => readClock();
  TracedDate.parse = RealDate.parse.bind(RealDate);
  TracedDate.UTC = RealDate.UTC.bind(RealDate);
  return TracedDate;
}

/**
 * Builds a `Math` stand-in whose `random` is supplied by the trace.
 *
 * Created with `Object.create(Math)` so every other member — `max`, `floor`,
 * `PI` — resolves through the prototype chain to the real implementation
 * rather than being copied, which would silently drop anything a future engine
 * adds.
 * @param {function(): number} readRandom - Supplies the next random value.
 * @returns {object} A drop-in replacement for `Math`.
 */
function buildMath(readRandom) {
  return Object.create(Math, {
    random: { value: () => readRandom(), enumerable: false, configurable: true },
  });
}

/**
 * Substitutes globals that log every non-deterministic value they hand out.
 *
 * The values themselves are real — a recording session must behave exactly as
 * an untraced one would — but each is appended to the recorder's global log so
 * replay can hand the same sequence back.
 * @param {object} recorder - The recorder to log into.
 */
export function installRecordingGlobals(recorder) {
  markedReads.clear();
  overrides.set(
    'Date',
    buildDate(() => {
      markGlobalRead('now');
      return recorder.recordGlobal('now', Date.now());
    }),
  );
  overrides.set(
    'Math',
    buildMath(() => {
      markGlobalRead('random');
      return recorder.recordGlobal('random', Math.random());
    }),
  );
}

/**
 * Substitutes globals that replay a recorded sequence of values.
 *
 * When the recorded sequence is exhausted the replay has consumed more
 * non-determinism than the recording produced, which means it has already
 * diverged. That is reported through `onExhausted` rather than papered over by
 * looping or by falling back to the real clock, either of which would let a
 * diverged replay finish looking successful.
 * @param {object} globals - The `globals` block of a trace.
 * @param {number[]} [globals.now] - Recorded `Date.now()` readings, in order.
 * @param {number[]} [globals.random] - Recorded `Math.random()` readings, in order.
 * @param {function(string): void} onExhausted - Called with the source name when a log runs out.
 * @returns {{cursors: {now: number, random: number}}} Live read cursors, for assertions.
 */
export function installReplayGlobals(globals, onExhausted) {
  const nowLog = (globals && globals.now) || [];
  const randomLog = (globals && globals.random) || [];
  const cursors = { now: 0, random: 0 };

  /**
   * Reads the next recorded clock value.
   * @returns {number} Epoch milliseconds.
   */
  const readClock = () => {
    if (cursors.now >= nowLog.length) {
      onExhausted('Date.now');
      // Repeating the final recorded reading keeps replay running so the
      // divergence report can be complete, rather than throwing at the first
      // extra read and hiding everything after it.
      return nowLog.length > 0 ? nowLog[nowLog.length - 1] : 0;
    }
    return nowLog[cursors.now++];
  };

  /**
   * Reads the next recorded random value.
   * @returns {number} A value in [0, 1).
   */
  const readRandom = () => {
    if (cursors.random >= randomLog.length) {
      onExhausted('Math.random');
      return randomLog.length > 0 ? randomLog[randomLog.length - 1] : 0;
    }
    return randomLog[cursors.random++];
  };

  overrides.set('Date', buildDate(readClock));
  overrides.set('Math', buildMath(readRandom));
  return { cursors };
}
