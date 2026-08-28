/**
 * @file resource.js
 * @description Recording and replay of `<resource>` requests.
 *
 * Resources are Avenx's declarative async boundary, which makes them the one
 * place the framework can see network work happening. Recording their
 * settlements — and feeding those settlements back during replay — is what
 * lets a recorded session be reproduced without a server.
 *
 * This deliberately does not intercept `fetch` or `XMLHttpRequest` globally. A
 * trace that silently swallowed every request in the page would be recording
 * work Avenx has no model of, and would report success for reproductions that
 * only appeared to work. Requests made outside a `<resource>` are not
 * reproduced, and a trace whose state depends on them diverges visibly during
 * replay rather than passing by accident.
 * @module lib/core/trace/resource
 */

import { tracer } from './tracer.js';
import { TraceNodeType, NonDeterminismReason } from './schema.js';

/**
 * Recorded settlements queued per resource name, oldest first.
 *
 * Empty outside replay, so {@link takeRecordedResponse} is a `Map.size` check
 * on the recording path.
 * @type {Map<string, object[]>}
 */
const recordedResponses = new Map();

/**
 * Called when replay asks for a response that was never recorded.
 * @type {function(string): void|null}
 */
let onMissingResponse = null;

/**
 * Loads a trace's resource settlements so replay can serve them.
 * @param {object} trace - The trace to replay.
 * @param {function(string): void} [onMissing] - Called when a resource asks for a response the trace does not have.
 */
export function installResourceResponses(trace, onMissing) {
  recordedResponses.clear();
  onMissingResponse = onMissing || null;

  for (const node of trace.nodes || []) {
    if (node.type !== TraceNodeType.RESOURCE || node.phase !== 'settled') {
      continue;
    }
    let queue = recordedResponses.get(node.name);
    if (!queue) {
      queue = [];
      recordedResponses.set(node.name, queue);
    }
    queue.push({ status: node.status, value: node.value, error: node.error });
  }
}

/**
 * Discards any loaded responses, restoring live resource behaviour.
 */
export function clearResourceResponses() {
  recordedResponses.clear();
  onMissingResponse = null;
}

/**
 * Whether replay has responses loaded.
 * @returns {boolean}
 */
export function hasRecordedResponses() {
  return recordedResponses.size > 0;
}

/**
 * Takes the next recorded settlement for a resource.
 *
 * A resource that asks for more settlements than were recorded is reported
 * rather than served a repeat: replay has gone further than the recording did,
 * which is divergence, and inventing a response would hide it.
 * @param {string} name - The resource name.
 * @returns {object|null} `{status, value, error}`, or null when nothing is queued.
 */
export function takeRecordedResponse(name) {
  if (recordedResponses.size === 0) {
    return null;
  }
  const queue = recordedResponses.get(name);
  if (!queue || queue.length === 0) {
    if (onMissingResponse) {
      onMissingResponse(name);
    }
    return null;
  }
  return queue.shift();
}

/**
 * Opens a node for a resource that has started work.
 * @param {string} name - The resource name.
 * @param {object|null} component - The owning component instance.
 * @param {number} pollInterval - The configured poll interval, if any.
 * @returns {object|null} The opened node, for later settlement.
 */
export function traceResourceStart(name, component, pollInterval) {
  const recorder = tracer.sink;
  if (!recorder) {
    return null;
  }

  if (pollInterval > 0) {
    // How many times a polling resource settled depends on wall-clock time, so
    // the sequence cannot be reproduced by replaying inputs.
    recorder.markNonDeterministic(
      NonDeterminismReason.POLLING_RESOURCE,
      `<resource name="${name}"> polls every ${pollInterval}ms`,
    );
  }

  return tracer.record(TraceNodeType.RESOURCE, {
    name,
    phase: 'pending',
    component: component && component.constructor && component.constructor.name,
  });
}

/**
 * Records how a resource settled.
 *
 * Settlements are recorded as their own node rather than by annotating the
 * pending one: a resource settles asynchronously, and a trace that mutated an
 * older node in place would lose the ordering that replay depends on.
 * @param {object|null} pending - The node returned by {@link traceResourceStart}.
 * @param {string} name - The resource name.
 * @param {'resolved'|'rejected'} status - How it settled.
 * @param {any} payload - The value, or the error.
 */
export function traceResourceSettle(pending, name, status, payload) {
  const recorder = tracer.sink;
  if (!recorder) {
    return;
  }

  const node = {
    name,
    phase: 'settled',
    status,
    // Parented to the request rather than to whatever happened to be running
    // when the promise settled, which is a microtask with no causal relation.
    request: pending ? pending.id : undefined,
  };

  if (status === 'rejected') {
    node.error = {
      name: (payload && payload.name) || 'Error',
      message: String((payload && payload.message) || payload),
    };
  } else {
    node.value = recorder.capture(payload, `resource.${name}`);
  }

  tracer.record(TraceNodeType.RESOURCE, node);
}
