/**
 * @file tracer.js
 * @description The causal stack and hook surface the runtime records through.
 *
 * Every instrumented site in the runtime talks to this one module. It holds
 * two things: a pointer to the active recorder, and the *causal stack* — the
 * chain of nodes currently being executed, innermost last. A node emitted
 * while that stack is non-empty is attributed to whatever sits on top of it,
 * which is what turns a flat log into "this DOM patch happened because that
 * click ran that action which wrote that property".
 *
 * ## Cost when tracing is off
 *
 * Tracing is off by default and must stay free. Every hook site is written as
 * a guarded pair:
 *
 * ```js
 * const token = tracer.on ? tracer.enter(TYPE, data) : -1;
 * try { ... } finally { if (token >= 0) tracer.leave(token); }
 * ```
 *
 * With `on === false` that is one property read and one comparison; the
 * descriptor object is never allocated, because it only appears inside the
 * conditional. Nothing else in the runtime changes shape.
 *
 * ## Stack safety
 *
 * `enter` returns a restore token rather than expecting a balanced `leave`.
 * `leave` truncates the stack back to that depth, so an exception unwinding
 * past a `leave` cannot leave the tracer permanently mis-parented — the next
 * outer `leave` repairs it.
 * @module lib/core/trace/tracer
 */

import { TraceNodeType } from './schema.js';

/**
 * The active tracer.
 *
 * A singleton rather than a per-app instance: the reactive system, the
 * sandbox and the patcher are all module-scoped, so a per-app tracer would
 * need threading through call sites that have no app reference. Recording more
 * than one application at a time is not a use case V1 supports.
 */
class Tracer {
  /**
   * Constructs the inactive tracer installed at import time.
   */
  constructor() {
    /**
     * Hot-path flag. Read by every instrumented site in the runtime, so it is a
     * plain own property rather than a getter.
     * @type {boolean}
     */
    this.on = false;

    /**
     * The recorder receiving nodes, or null when tracing is off.
     * @type {object|null}
     */
    this.sink = null;

    /**
     * Ids of the nodes currently executing, innermost last.
     * @type {number[]}
     */
    this.stack = [];
  }

  /**
   * Begins recording into a sink.
   * @param {object} sink - The recorder to feed.
   * @returns {Tracer} This tracer.
   */
  attach(sink) {
    this.sink = sink;
    this.stack.length = 0;
    this.on = !!sink;
    return this;
  }

  /**
   * Stops recording and drops the sink.
   * @returns {object|null} The detached recorder.
   */
  detach() {
    const previous = this.sink;
    this.sink = null;
    this.on = false;
    this.stack.length = 0;
    return previous;
  }

  /**
   * The id of the node currently being executed, or null at the top level.
   * @returns {number|null} The causal parent for anything emitted right now.
   */
  current() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  /**
   * Records a leaf node — something that happened, but that nothing else
   * happened *inside*.
   * @param {string} type - A {@link TraceNodeType}.
   * @param {object} data - Type-specific fields.
   * @returns {object|null} The stored node, or null when tracing is off.
   */
  record(type, data) {
    if (!this.sink) {
      return null;
    }
    return this.sink.push(type, data, this.current());
  }

  /**
   * Records a node and makes it the causal parent of everything emitted until
   * the matching {@link Tracer#leave}.
   * @param {string} type - A {@link TraceNodeType}.
   * @param {object} data - Type-specific fields.
   * @returns {number} A restore token to hand to `leave`, or -1 when tracing is off.
   */
  enter(type, data) {
    if (!this.sink) {
      return -1;
    }
    const token = this.stack.length;
    const node = this.sink.push(type, data, this.current());
    if (node) {
      this.stack.push(node.id);
    }
    return token;
  }

  /**
   * Re-enters an existing node's causal scope without recording a new node.
   *
   * The scheduler batches component updates into a microtask, so the DOM patch
   * caused by a click happens on an empty causal stack — long after the click
   * handler returned. Stamping the queued job with the node that queued it and
   * resuming that scope here is what keeps a patch attributed to the write
   * that caused it, rather than appearing as an unexplained root.
   * @param {number|null} id - The node id to continue from.
   * @returns {number} A restore token for `leave`, or -1 when tracing is off.
   */
  continueFrom(id) {
    if (!this.sink || id === null || id === undefined) {
      return -1;
    }
    const token = this.stack.length;
    this.stack.push(id);
    return token;
  }

  /**
   * Restores the causal stack to the depth a matching `enter` returned.
   * @param {number} token - The token from `enter`.
   */
  leave(token) {
    if (token >= 0 && this.stack.length > token) {
      this.stack.length = token;
    }
  }

  /**
   * Attaches a field to the node most recently entered.
   *
   * Used where the interesting value is only known once the node's body has
   * run — a computed's new value, an action's return, a resource's outcome.
   * @param {object} fields - Fields to merge into the open node.
   */
  annotate(fields) {
    if (!this.sink) {
      return;
    }
    const id = this.current();
    if (id !== null) {
      this.sink.annotate(id, fields);
    }
  }

  /**
   * Reports that something happened which replay cannot reproduce.
   * @param {string} reason - A non-determinism reason.
   * @param {string} [detail] - Extra context shown to the developer.
   */
  markNonDeterministic(reason, detail) {
    if (this.sink) {
      this.sink.markNonDeterministic(reason, detail);
    }
  }

  /**
   * Records an error that escaped application code.
   * @param {Error} error - The error.
   * @param {object} [context] - Where it came from.
   * @returns {object|null} The stored node.
   */
  recordError(error, context = {}) {
    if (!this.sink) {
      return null;
    }
    return this.record(TraceNodeType.ERROR, {
      name: (error && error.name) || 'Error',
      message: String((error && error.message) || error),
      code: error && error.code,
      ...context,
    });
  }
}

/**
 * The process-wide tracer. Inactive until a recorder attaches to it.
 * @type {Tracer}
 */
export const tracer = new Tracer();

export { Tracer };
