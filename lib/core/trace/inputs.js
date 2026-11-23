import { INPUT_TYPES, TraceNodeType, indexNodes } from './schema.js';

/**
 * Groups observations by the recorded input at the root of their causal chain.
 * Shared by replay and recording comparison so both assign the same step index.
 * Missing parents and cycles are collected as orphans rather than guessed.
 * @param {object} trace - The recording.
 * @param {Function} [project] - Maps a node to an observation; null skips it.
 * @returns {{steps: object[], orphans: any[]}} Steps in recorded input order.
 */
export function groupByInput(trace, project = (node) => node) {
  const byId = indexNodes(trace);
  const stepOf = new Map();
  const steps = [];
  const orphans = [];

  for (const node of trace.nodes) {
    if (INPUT_TYPES.has(node.type) && (node.parent === null || node.parent === undefined)) {
      if (node.type === TraceNodeType.RESOURCE && node.phase === 'settled') continue;
      stepOf.set(node.id, steps.length);
      steps.push({ index: steps.length, input: node, observations: [] });
    }
  }

  for (const node of trace.nodes) {
    const observation = project(node);
    if (observation === null) continue;
    let current = node;
    const trail = new Set();
    while (current && !stepOf.has(current.id) && !trail.has(current.id)) {
      trail.add(current.id);
      current = byId.get(current.parent);
    }
    const index = current && stepOf.has(current.id) ? stepOf.get(current.id) : null;
    for (const id of trail) stepOf.set(id, index);
    if (index === null) orphans.push(observation);
    else steps[index].observations.push(observation);
  }
  return { steps, orphans };
}
