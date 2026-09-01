import assert from 'assert';
import {
  TRACE_VERSION,
  TraceNodeType,
  Determinism,
  NonDeterminismReason,
  ROOT_TYPES,
  INPUT_TYPES,
  createTrace,
  validateTrace,
  indexNodes,
  groupChildren,
  rootNodes,
} from '../../lib/core/trace/schema.js';
import { REASON_DESCRIPTIONS } from '../../lib/core/trace/format.js';

console.log('🧪 Testing trace schema / data model...');

// 1. Envelope shape
const trace = createTrace({ url: 'http://localhost/#/cart' });
assert.strictEqual(trace.traceVersion, TRACE_VERSION, 'new traces carry the current version');
assert.strictEqual(trace.determinism.status, Determinism.DETERMINISTIC, 'traces start out deterministic');
assert.deepStrictEqual(trace.nodes, [], 'new traces have no nodes');
assert.strictEqual(trace.meta.url, 'http://localhost/#/cart', 'meta is carried through');
assert.strictEqual(trace.dropped, 0);

// 2. Version validation
assert.strictEqual(validateTrace(trace).ok, true);
assert.strictEqual(validateTrace(null).ok, false, 'null is rejected');
assert.strictEqual(validateTrace({}).ok, false, 'a version-less object is rejected');
const future = validateTrace({ traceVersion: TRACE_VERSION + 1, nodes: [] });
assert.strictEqual(future.ok, false, 'a newer format is rejected rather than misread');
assert.ok(/newer than this build/.test(future.error), 'the rejection explains itself');
assert.strictEqual(validateTrace({ traceVersion: 1 }).ok, false, 'nodes must be an array');

// 3. Node types and classification
assert.ok(ROOT_TYPES.has(TraceNodeType.EVENT), 'events start causal chains');
assert.ok(!ROOT_TYPES.has(TraceNodeType.WRITE), 'writes never start a chain');
assert.ok(INPUT_TYPES.has(TraceNodeType.RESOURCE), 'recorded resource settlements are replay inputs');
assert.ok(!INPUT_TYPES.has(TraceNodeType.DOM), 'DOM patches are observations, never driven');
assert.ok(
  !INPUT_TYPES.has(TraceNodeType.GLOBAL),
  'recorded globals travel in the compact globals log, not as driven nodes',
);

// 4. Every non-determinism reason is explainable to a human.
// The prose lives in format.js, not here: schema.js is in the runtime's import
// graph, and a block of text no application renders would ship in every bundle.
for (const reason of Object.values(NonDeterminismReason)) {
  assert.ok(
    typeof REASON_DESCRIPTIONS[reason] === 'string' && REASON_DESCRIPTIONS[reason].length > 20,
    `reason "${reason}" has a usable description`,
  );
}

// 5. Causal indexing
trace.nodes.push(
  { id: 1, parent: null, type: TraceNodeType.EVENT, seq: 1 },
  { id: 2, parent: 1, type: TraceNodeType.ACTION, seq: 2 },
  { id: 3, parent: 2, type: TraceNodeType.WRITE, seq: 3 },
  { id: 4, parent: 2, type: TraceNodeType.WRITE, seq: 4 },
);

const byId = indexNodes(trace);
assert.strictEqual(byId.get(3).type, TraceNodeType.WRITE);
assert.strictEqual(byId.size, 4);

const children = groupChildren(trace);
assert.strictEqual(children.get(2).length, 2, 'both writes hang off the action');
assert.deepStrictEqual(
  children.get(2).map((n) => n.id),
  [3, 4],
  'children keep their recorded order',
);

assert.deepStrictEqual(rootNodes(trace).map((n) => n.id), [1], 'only the event is a root');

// 6. Truncation orphans are treated as roots rather than lost
const truncated = createTrace();
truncated.nodes.push({ id: 9, parent: 7, type: TraceNodeType.WRITE, seq: 9 });
assert.deepStrictEqual(
  rootNodes(truncated).map((n) => n.id),
  [9],
  'a node whose parent was dropped still renders as a root',
);

console.log('✅ All trace schema tests passed.');
