import assert from 'assert';
import { diffTraces, formatTraceDiff } from '../../lib/core/trace/diff.js';
import { groupByInput } from '../../lib/core/trace/inputs.js';
import { createTrace, REDACTED } from '../../lib/core/trace/schema.js';

/**
 * Makes a causal tree with a stable input and action.
 * @param {object[]} [children] - Additional children of the action.
 * @returns {object} A trace.
 */
function trace(children = []) {
  return {
    ...createTrace(),
    nodes: [
      {
        id: 1,
        parent: null,
        type: 'event',
        eventType: 'click',
        target: { selector: '#inc', nth: 0, uid: 1 },
        component: 'Counter',
      },
      { id: 2, parent: 1, type: 'action', name: 'inc', component: 'Counter', source: 'state.count++;' },
      ...children.map((node, index) => ({ id: index + 3, parent: 2, ...node })),
    ],
  };
}

const before = trace([
  { type: 'write', path: 'count', from: 0, to: 1 },
  { type: 'dom', op: 'text', target: { selector: '#count', nth: 0, uid: 1 }, from: '0', to: '1' },
]);
const same = structuredClone(before);
same.id = 'another-recording';
same.createdAt = '2099-01-01';
for (const node of same.nodes) {
  node.id += 50;
  if (node.parent !== null) node.parent += 50;
  node.t = 400;
  node.seq = 100;
  node.loc = { file: 'changed.js', line: 99 };
  if (node.target) node.target.uid = 99;
  if (node.type === 'action') node.source = 'state.count += 1;';
}
assert.strictEqual(diffTraces(before, same).changed, false, 'recording ids, clocks and source text are not behaviour');
assert.ok(formatTraceDiff(diffTraces(before, same)).includes('No recorded behaviour changes'));

const after = trace([
  { type: 'write', path: 'analytics.clicks', from: 0, to: 1 },
  { type: 'write', path: 'count', from: 0, to: 2 },
  { type: 'dom', op: 'text', target: { selector: '#count', nth: 0 }, from: '0', to: '2' },
  { type: 'dom', op: 'text', target: { selector: '#badge', nth: 0 }, from: '', to: '1' },
]);
const comparison = diffTraces(before, after);
assert.strictEqual(comparison.comparable, true);
assert.deepStrictEqual(comparison.summary, {
  before: 4,
  after: 6,
  added: 2,
  removed: 0,
  changed: 2,
  unchanged: 2,
  domBefore: 1,
  domAfter: 2,
});
assert.strictEqual(diffTraces(after, before).summary.removed, 2);
assert.ok(formatTraceDiff(comparison).includes('analytics.clicks'));
assert.ok(formatTraceDiff(comparison).includes('DOM patches: 1 -> 2'));

for (const change of [
  (recording) => {
    recording.nodes[0].eventType = 'input';
  },
  (recording) => {
    recording.nodes[0].target.selector = '#other';
  },
  (recording) => {
    recording.nodes[0].key = 'Enter';
  },
  (recording) => {
    recording.nodes[0].value = 'new input';
  },
  (recording) => {
    recording.nodes.push({ id: 99, type: 'navigation', parent: null, to: '/other' });
  },
]) {
  const other = structuredClone(before);
  change(other);
  const result = diffTraces(before, other);
  assert.strictEqual(result.comparable, false);
  assert.match(result.reason, /Different interactions/);
}

const moved = structuredClone(before);
moved.nodes[3].parent = moved.nodes[2].id;
assert.strictEqual(diffTraces(before, moved).summary.added, 1, 'a causal parent change is visible');
assert.strictEqual(diffTraces(before, moved).summary.removed, 1);

const publicTrace = trace([{ type: 'write', path: 'auth.token', from: 'old-secret', to: 'new-secret' }]);
const redacted = trace([{ type: 'write', path: 'auth.token', from: REDACTED, to: REDACTED }]);
redacted.redacted = true;
redacted.redactions = ['auth.**'];
const masked = diffTraces(publicTrace, redacted);
assert.strictEqual(masked.changed, false);
assert.strictEqual(masked.partial, true);
assert.ok(!JSON.stringify(masked).includes('secret'), 'neither side exposes a value the other side withheld');
assert.ok(
  !JSON.stringify(diffTraces(publicTrace, { ...redacted, nodes: redacted.nodes.slice(0, 2) })).includes('secret'),
);

const nested = trace([
  { type: 'write', path: 'profile', from: {}, to: { id: 'application-id', timestamp: 1, token: 'secret' } },
]);
const nestedMasked = structuredClone(nested);
nestedMasked.redacted = true;
nestedMasked.nodes[2].to.token = REDACTED;
assert.strictEqual(diffTraces(nested, nestedMasked).changed, false);
nestedMasked.nodes[2].to.timestamp = 2;
assert.strictEqual(diffTraces(nested, nestedMasked).summary.changed, 1, 'application timestamps are data');
assert.ok(!JSON.stringify(diffTraces(nested, nestedMasked)).includes('secret'));

const reordered = trace([{ type: 'write', path: 'object', from: {}, to: { a: 1, b: 2 } }]);
const reorderedAfter = trace([{ type: 'write', path: 'object', from: {}, to: { b: 2, a: 1 } }]);
assert.strictEqual(diffTraces(reordered, reorderedAfter).changed, false, 'object key insertion order is not a change');

const orphan = { ...createTrace(), nodes: [{ id: 1, parent: 999, type: 'write', path: 'stray', from: 1, to: 2 }] };
assert.strictEqual(diffTraces(orphan, createTrace()).orphans.summary.removed, 1, 'orphan nodes are not dropped');
assert.strictEqual(diffTraces(createTrace(), createTrace()).changed, false);
assert.throws(() => diffTraces({ nodes: [] }, before), /AVX_R/);
assert.throws(() => diffTraces({ ...before, nodes: [before.nodes[0], before.nodes[0]] }, before), /unique ids/);
const cycle = {
  ...createTrace(),
  nodes: [
    { id: 1, parent: 2, type: 'write' },
    { id: 2, parent: 1, type: 'write' },
  ],
};
assert.throws(() => diffTraces(cycle, before), /parent cycle/);
assert.strictEqual(groupByInput(cycle).orphans.length, 2, 'the shared replay walk terminates on malformed cycles');

const long = trace(
  Array.from({ length: 5000 }, (_, index) => ({ type: 'write', path: `values.${index}`, from: 0, to: 1 })),
);
const longAfter = structuredClone(long);
longAfter.nodes.splice(2500, 0, { id: 99999, parent: 2, type: 'write', path: 'inserted', from: 0, to: 1 });
assert.strictEqual(diffTraces(long, longAfter).summary.added, 1, 'a long sequence has one insertion, not a cascade');

console.log('Trace comparison tests passed.');
