/**
 * @file schema.js
 * @description The Avenx trace data model.
 *
 * A trace is a flat, ordered array of nodes. Causality is expressed with a
 * `parent` pointer rather than nesting, so a trace stays cheap to append to,
 * cheap to serialize, and stable to truncate: dropping the oldest nodes from a
 * ring buffer can never corrupt the array, only orphan a subtree.
 *
 * The node types mirror Avenx's own execution model — event, action, bridge
 * action, write, watcher, computed, DOM patch, resource, navigation — rather
 * than the browser's. A trace is meant to answer "why did this component
 * re-render", which is a question about the framework, not about the DOM.
 * @module lib/core/trace/schema
 */

/**
 * The trace format version.
 *
 * Bump this whenever the meaning of an existing field changes or a field the
 * reader depends on is removed. Adding a new optional field does not require a
 * bump; readers must tolerate unknown fields.
 * @type {number}
 */
export const TRACE_VERSION = 1;

/**
 * Node types that can appear in a trace.
 *
 * `ROOT_TYPES` below marks the subset that begins a causal chain, and
 * `INPUT_TYPES` marks the subset replay feeds back into the application.
 * @readonly
 * @enum {string}
 */
export const TraceNodeType = {
  /** A DOM event that reached an Avenx handler. Always a causal root. */
  EVENT: 'event',
  /** A component `<action>` body running. */
  ACTION: 'action',
  /** An action declared on a bridge running. */
  BRIDGE_ACTION: 'bridge-action',
  /** An event emitted by a bridge to its subscribers. */
  BRIDGE_EMIT: 'bridge-emit',
  /** A reactive state mutation, identified by its property path. */
  WRITE: 'write',
  /** A watcher waking because a dependency it read was written. */
  WATCHER: 'watcher',
  /** A computed property or bridge getter re-evaluating. */
  COMPUTED: 'computed',
  /** A DOM mutation the patcher applied. */
  DOM: 'dom',
  /** A resource request or its settlement. */
  RESOURCE: 'resource',
  /** A router navigation. */
  NAVIGATION: 'navigation',
  /**
   * A marker that application code read a non-deterministic global. The values
   * themselves travel in the trace's compact `globals` log rather than as one
   * node per read, which would swamp the causal graph.
   */
  GLOBAL: 'global',
  /** An error that escaped application code. */
  ERROR: 'error',
  /** A declared compiler contract that the running code did not honour. */
  CONTRACT: 'contract',
  /**
   * An Avenx Rewind transaction playing its journal backwards.
   *
   * The writes the rewind performs are recorded underneath it as ordinary
   * writes, because that is what they are — which is the point: a value that
   * changed back is otherwise the most confusing thing in a trace.
   */
  REWIND: 'rewind',
};

/**
 * Node types that begin a causal chain rather than continuing one.
 * @type {Set<string>}
 */
export const ROOT_TYPES = new Set([TraceNodeType.EVENT, TraceNodeType.NAVIGATION, TraceNodeType.RESOURCE]);

/**
 * Node types replay feeds back into the application to reproduce a session.
 *
 * Everything else in a trace is an *observation*: replay re-derives it by
 * running the real framework, and compares what it observed against what was
 * recorded. Driving a non-input node directly would make replay a puppet show
 * rather than a reproduction.
 * @type {Set<string>}
 */
export const INPUT_TYPES = new Set([TraceNodeType.EVENT, TraceNodeType.NAVIGATION, TraceNodeType.RESOURCE]);

/**
 * Node types replay compares against the recording to detect divergence.
 * @type {Set<string>}
 */
export const OBSERVATION_TYPES = new Set([TraceNodeType.WRITE, TraceNodeType.DOM, TraceNodeType.NAVIGATION]);

/**
 * Whether a recorded session can be faithfully replayed.
 * @readonly
 * @enum {string}
 */
export const Determinism = {
  /** Nothing was observed that replay cannot reproduce. */
  DETERMINISTIC: 'deterministic',
  /** Something escaped the recording boundary; replay may diverge. */
  BEST_EFFORT: 'best-effort',
};

/**
 * Stable reasons a trace was downgraded to {@link Determinism.BEST_EFFORT}.
 *
 * These are the *detectable* escapes. They are not exhaustive, which is why
 * replay independently verifies determinism by comparing observations rather
 * than trusting this list. See `replay.js`.
 * @readonly
 * @enum {string}
 */
export const NonDeterminismReason = {
  /** State changed without any recorded input to explain it (a stray timer, an outside listener). */
  UNATTRIBUTED_WRITE: 'unattributed-write',
  /** A resource polls on a timer, so its settlement order is wall-clock dependent. */
  POLLING_RESOURCE: 'polling-resource',
  /** A recorded value could not be represented in JSON, so replay cannot restore it. */
  UNSERIALIZABLE_VALUE: 'unserializable-value',
  /** A redaction rule removed a value that replay would need as an input. */
  REDACTED_INPUT: 'redacted-input',
  /** The ring buffer dropped nodes, so the recording is not a complete history. */
  TRUNCATED: 'truncated',
  /** Application code reached a non-deterministic global outside the sandbox boundary. */
  UNSANDBOXED_GLOBAL: 'unsandboxed-global',
};

/**
 * The placeholder substituted for a value a redaction rule matched.
 * @type {string}
 */
export const REDACTED = '[redacted]';

/**
 * Creates an empty trace envelope.
 * @param {object} [meta] - Free-form metadata describing where the trace came from.
 * @returns {object} A trace with no nodes.
 */
export function createTrace(meta = {}) {
  return {
    traceVersion: TRACE_VERSION,
    id: '',
    createdAt: '',
    determinism: { status: Determinism.DETERMINISTIC, reasons: [] },
    meta: { ...meta },
    /** Recorded non-deterministic global values, keyed by source (`now`, `random`). */
    globals: {},
    /** Property path patterns whose values were withheld from this trace. */
    redactions: [],
    /** How many nodes the ring buffer dropped, if any. */
    dropped: 0,
    nodes: [],
  };
}

/**
 * Validates that a value looks like a trace this build can read.
 * @param {any} trace - The candidate trace.
 * @returns {{ok: boolean, error: string}} Why it was rejected, when it was.
 */
export function validateTrace(trace) {
  if (!trace || typeof trace !== 'object') {
    return { ok: false, error: 'Trace is not an object.' };
  }
  if (typeof trace.traceVersion !== 'number') {
    return { ok: false, error: 'Trace is missing a numeric "traceVersion".' };
  }
  if (trace.traceVersion > TRACE_VERSION) {
    return {
      ok: false,
      error: `Trace format version ${trace.traceVersion} is newer than this build understands (${TRACE_VERSION}). Upgrade avenx-core.`,
    };
  }
  if (!Array.isArray(trace.nodes)) {
    return { ok: false, error: 'Trace is missing a "nodes" array.' };
  }
  return { ok: true };
}

/**
 * Indexes a trace's nodes by id, so callers can walk `parent` pointers.
 * @param {object} trace - A trace.
 * @returns {Map<number, object>} Nodes keyed by id.
 */
export function indexNodes(trace) {
  const byId = new Map();
  for (const node of trace.nodes) {
    byId.set(node.id, node);
  }
  return byId;
}

/**
 * Groups a trace's nodes into `parentId -> children` order-preserving lists.
 * @param {object} trace - A trace.
 * @returns {Map<number|null, object[]>} Children keyed by parent id.
 */
export function groupChildren(trace) {
  const children = new Map();
  for (const node of trace.nodes) {
    const key = node.parent === undefined ? null : node.parent;
    let bucket = children.get(key);
    if (!bucket) {
      bucket = [];
      children.set(key, bucket);
    }
    bucket.push(node);
  }
  return children;
}

/**
 * Returns the trace's causal roots: nodes whose parent is absent from the
 * trace, either because they started a chain or because truncation orphaned
 * them.
 * @param {object} trace - A trace.
 * @returns {object[]} Root nodes, in recorded order.
 */
export function rootNodes(trace) {
  const byId = indexNodes(trace);
  return trace.nodes.filter((node) => node.parent === null || node.parent === undefined || !byId.has(node.parent));
}
