/**
 * @file recorder.js
 * @description The trace recorder: a bounded buffer plus determinism bookkeeping.
 *
 * The recorder owns everything a trace needs that the {@link tracer} hook
 * surface deliberately does not: node ids, timestamps, the ring buffer, the
 * redaction rules, the log of non-deterministic globals, and the running
 * judgement of whether this session could be replayed.
 *
 * That last part is the reason this class exists rather than an array. A trace
 * that claims to be deterministic and is not produces a regression test that
 * passes for the wrong reason, which is worse than no test. The recorder
 * therefore downgrades eagerly and never upgrades.
 * @module lib/core/trace/recorder
 */

import { captureValue, wasLossy } from './capture.js';
import { Redactor } from './redact.js';
import { tracer } from './tracer.js';
import {
  TRACE_VERSION,
  TraceNodeType,
  Determinism,
  NonDeterminismReason,
  createTrace,
} from './schema.js';

/**
 * How many nodes a recording keeps before it starts dropping the oldest.
 *
 * A minute of interaction on a busy list produces a lot of nodes; an unbounded
 * array would be a memory leak in a dev server that stays open all day. When
 * the buffer wraps, the trace is marked truncated and therefore best-effort,
 * because it no longer starts at the beginning of the session.
 * @type {number}
 */
export const DEFAULT_MAX_NODES = 5000;

/**
 * How deep the serialization scrub walks a node.
 *
 * Captured values are already bounded by {@link captureValue}, so this only has
 * to match that ceiling.
 * @type {number}
 */
const SCRUB_MAX_DEPTH = 8;

/**
 * Where a recorder is in its lifecycle.
 *
 * Writes during `setup` are the application constructing itself and are not
 * evidence of non-determinism. Writes during `recording` with nothing on the
 * causal stack are: something outside the recorded inputs changed state.
 * @readonly
 * @enum {string}
 */
export const RecorderPhase = {
  SETUP: 'setup',
  RECORDING: 'recording',
  STOPPED: 'stopped',
};

/**
 * Generates a short, readable trace id.
 * @returns {string} An id such as `trace-4f2a`.
 */
function generateId() {
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `trace-${suffix}`;
}

/**
 * Reads a monotonic clock, falling back where `performance` is absent.
 * @returns {number} Milliseconds from an arbitrary origin.
 */
function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Records one session's causal trace.
 */
export class TraceRecorder {
  /**
   * @param {object} [options] - Recorder options.
   * @param {string} [options.id] - An explicit trace id. Generated when omitted.
   * @param {number} [options.maxNodes] - Ring-buffer capacity.
   * @param {string[]} [options.redact] - Redaction patterns.
   * @param {object} [options.meta] - Free-form metadata about the session.
   */
  constructor(options = {}) {
    /** @type {string} */
    this.id = options.id || generateId();
    /** @type {number} */
    this.maxNodes = options.maxNodes || DEFAULT_MAX_NODES;
    /** @type {Redactor} */
    this.redactor = new Redactor(options.redact || []);
    /** @type {object} */
    this.meta = { ...(options.meta || {}) };

    /**
     * The ring buffer. Kept as a plain array that is spliced in one block when
     * it overflows, rather than a circular index: traces are read far more
     * often than they overflow, and a linear array keeps every reader simple.
     * @type {object[]}
     */
    this.nodes = [];

    /**
     * Open nodes by id, so {@link TraceRecorder#annotate} can find a node the
     * buffer may since have dropped.
     * @type {Map<number, object>}
     */
    this.index = new Map();

    /** @type {number} */
    this.nextId = 1;
    /** @type {number} */
    this.seq = 0;
    /** @type {number} */
    this.dropped = 0;
    /** @type {number} */
    this.startedAt = now();
    /** @type {string} */
    this.createdAt = new Date().toISOString();
    /** @type {string} */
    this.phase = RecorderPhase.SETUP;

    /**
     * Non-deterministic global values in the order application code observed
     * them, so replay can hand back the same sequence.
     * @type {{now: number[], random: number[]}}
     */
    this.globals = { now: [], random: [] };

    /** @type {string} */
    this.determinism = Determinism.DETERMINISTIC;
    /** @type {Map<string, string>} */
    this.reasons = new Map();
  }

  /**
   * Switches from application startup to recording user interaction.
   *
   * Until this is called, state writes with no recorded cause are treated as
   * the application initialising itself rather than as non-determinism.
   * @returns {TraceRecorder} This recorder.
   */
  arm() {
    this.phase = RecorderPhase.RECORDING;
    return this;
  }

  /**
   * Ends the recording.
   * @returns {TraceRecorder} This recorder.
   */
  stop() {
    this.phase = RecorderPhase.STOPPED;
    return this;
  }

  /**
   * Appends a node.
   * @param {string} type - A {@link TraceNodeType}.
   * @param {object} data - Type-specific fields.
   * @param {number|null} parent - The causal parent id.
   * @returns {object} The stored node.
   */
  push(type, data, parent) {
    const node = {
      id: this.nextId++,
      parent: parent === undefined ? null : parent,
      seq: ++this.seq,
      t: Math.round((now() - this.startedAt) * 1000) / 1000,
      type,
      ...data,
    };

    this.nodes.push(node);
    this.index.set(node.id, node);

    if (type === TraceNodeType.WRITE && parent === null && this.phase === RecorderPhase.RECORDING) {
      this.markNonDeterministic(
        NonDeterminismReason.UNATTRIBUTED_WRITE,
        `${data.path || 'unknown path'} changed with no recorded input to explain it`,
      );
    }

    if (this.nodes.length > this.maxNodes) {
      this.#evict();
    }

    return node;
  }

  /**
   * Drops the oldest tenth of the buffer.
   *
   * Evicting in blocks rather than one node at a time keeps the amortised cost
   * of a splice off the hot path once a long session settles into steady state.
   * @private
   */
  #evict() {
    const removeCount = Math.max(1, Math.floor(this.maxNodes / 10));
    const removed = this.nodes.splice(0, removeCount);
    for (const node of removed) {
      this.index.delete(node.id);
    }
    this.dropped += removed.length;
    this.markNonDeterministic(
      NonDeterminismReason.TRUNCATED,
      `${this.dropped} node(s) dropped; the buffer holds ${this.maxNodes}`,
    );
  }

  /**
   * Merges fields into a node that is still in the buffer.
   * @param {number} id - The node id.
   * @param {object} fields - Fields to merge.
   */
  annotate(id, fields) {
    const node = this.index.get(id);
    if (node) {
      Object.assign(node, fields);
    }
  }

  /**
   * Captures a value under this recorder's redaction and bounds.
   * @param {any} value - The value.
   * @param {string} [path] - The property path, for redaction matching.
   * @returns {any} A JSON-representable capture.
   */
  capture(value, path = '') {
    const captured = captureValue(value, { path, redactor: this.redactor });
    if (wasLossy()) {
      this.markNonDeterministic(
        NonDeterminismReason.UNSERIALIZABLE_VALUE,
        path ? `at ${path}` : 'a recorded value could not be represented in JSON',
      );
    }
    return captured;
  }

  /**
   * Records a non-deterministic global value the sandbox handed to application
   * code, so replay can hand back the same one.
   * @param {'now'|'random'} kind - Which source produced it.
   * @param {number} value - The value.
   * @returns {number} The same value, so callers can record inline.
   */
  recordGlobal(kind, value) {
    const log = this.globals[kind];
    if (log) {
      log.push(value);
    }
    return value;
  }

  /**
   * Downgrades the trace to best-effort.
   *
   * Reasons are de-duplicated by kind: a session that made a thousand
   * unattributed writes should say so once, with an example.
   * @param {string} reason - A {@link NonDeterminismReason}.
   * @param {string} [detail] - Context for the developer.
   */
  markNonDeterministic(reason, detail = '') {
    this.determinism = Determinism.BEST_EFFORT;
    if (!this.reasons.has(reason)) {
      this.reasons.set(reason, detail);
    }
  }

  /**
   * Whether this recording is currently believed to be replayable.
   *
   * "Believed" is doing real work in that sentence: this reflects only the
   * escapes the runtime could observe. Replay verifies the claim independently
   * by comparing what it observes against what was recorded.
   * @returns {boolean}
   */
  get isDeterministic() {
    return this.determinism === Determinism.DETERMINISTIC;
  }

  /**
   * How many distinct components appear in the trace.
   * @returns {number}
   */
  get componentCount() {
    const seen = new Set();
    for (const node of this.nodes) {
      if (node.component) {
        seen.add(node.component);
      }
    }
    return seen.size;
  }

  /**
   * Produces the serializable trace.
   * @returns {object} A trace matching {@link TRACE_VERSION}.
   */
  toJSON() {
    const trace = createTrace(this.meta);
    trace.traceVersion = TRACE_VERSION;
    trace.id = this.id;
    trace.createdAt = this.createdAt;
    trace.dropped = this.dropped;
    trace.globals = { now: [...this.globals.now], random: [...this.globals.random] };
    trace.redactions = [...this.redactor.patterns];
    trace.redacted = this.redactor.applied;
    trace.determinism = {
      status: this.determinism,
      reasons: [...this.reasons.entries()].map(([reason, detail]) => ({ reason, detail })),
    };
    // Withheld values are scrubbed here rather than when a node is recorded: an
    // action's body and a call's arguments are captured before the writes that
    // identify a value as a secret, so at record time it is not yet known to be
    // one. Serialization is the moment the trace leaves this process, which
    // makes it the right last line of defence.
    trace.nodes = this.redactor.withheldValues.size > 0 ? this.nodes.map((node) => this.#scrubNode(node)) : this.nodes;
    return trace;
  }

  /**
   * Returns a copy of a node with withheld values removed from its source text.
   * @param {object} node - The node.
   * @returns {object} The node, or a scrubbed copy of it.
   * @private
   */
  #scrubNode(node) {
    return this.#scrubValue(node, SCRUB_MAX_DEPTH);
  }

  /**
   * Replaces withheld values anywhere inside a captured structure.
   *
   * Path rules are the primary mechanism and this is the backstop: a value the
   * rules withheld in one place must not survive somewhere the rules did not
   * anticipate — an action's verbatim source, or the arguments of a call that
   * was recorded before the write that identified the value as a secret.
   *
   * The original object is returned untouched when nothing changed, so a trace
   * with no matches is not needlessly copied.
   * @param {any} value - The value to scrub.
   * @param {number} depth - Remaining depth budget.
   * @returns {any} The value, or a scrubbed copy.
   * @private
   */
  #scrubValue(value, depth) {
    if (typeof value === 'string') {
      return this.redactor.scrub(value);
    }
    if (depth <= 0 || value === null || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      let copy = value;
      for (let i = 0; i < value.length; i++) {
        const scrubbed = this.#scrubValue(value[i], depth - 1);
        if (scrubbed !== value[i]) {
          if (copy === value) {
            copy = [...value];
          }
          copy[i] = scrubbed;
        }
      }
      return copy;
    }

    let copy = value;
    for (const key of Object.keys(value)) {
      const scrubbed = this.#scrubValue(value[key], depth - 1);
      if (scrubbed !== value[key]) {
        if (copy === value) {
          copy = { ...value };
        }
        copy[key] = scrubbed;
      }
    }
    return copy;
  }

  /**
   * Serializes the trace to a JSON string.
   * @param {number} [indent] - Indentation passed to `JSON.stringify`.
   * @returns {string}
   */
  serialize(indent = 0) {
    return JSON.stringify(this.toJSON(), null, indent);
  }
}

/**
 * Starts recording, replacing any recording already in progress.
 * @param {object} [options] - Options forwarded to {@link TraceRecorder}.
 * @returns {TraceRecorder} The active recorder.
 */
export function startRecording(options = {}) {
  const recorder = new TraceRecorder(options);
  tracer.attach(recorder);
  return recorder;
}

/**
 * Stops the active recording.
 * @returns {object|null} The finished trace, or null if nothing was recording.
 */
export function stopRecording() {
  const recorder = tracer.detach();
  if (!recorder) {
    return null;
  }
  recorder.stop();
  return recorder.toJSON();
}

/**
 * The recorder currently attached to the tracer, if any.
 * @returns {TraceRecorder|null}
 */
export function activeRecorder() {
  return tracer.sink;
}
