import assert from 'assert';
import { tracer } from '../../lib/core/trace/tracer.js';
import {
  TraceRecorder,
  startRecording,
  stopRecording,
  activeRecorder,
  RecorderPhase,
} from '../../lib/core/trace/recorder.js';
import { TraceNodeType, Determinism, NonDeterminismReason, validateTrace } from '../../lib/core/trace/schema.js';
import { REDACTED } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing tracer causal stack and recorder...');

// --- Off by default ---------------------------------------------------------

assert.strictEqual(tracer.on, false, 'the tracer is inert until a recorder attaches');
assert.strictEqual(tracer.sink, null);
assert.strictEqual(tracer.record(TraceNodeType.WRITE, { path: 'a' }), null, 'recording while off is a no-op');
assert.strictEqual(tracer.enter(TraceNodeType.EVENT, {}), -1, 'enter returns a sentinel token while off');
assert.strictEqual(tracer.current(), null);
tracer.leave(-1); // must not throw
tracer.annotate({ x: 1 }); // must not throw
tracer.markNonDeterministic(NonDeterminismReason.TRUNCATED); // must not throw
assert.strictEqual(activeRecorder(), null);

// --- Causal parenting -------------------------------------------------------

const recorder = startRecording({ id: 'trace-test', meta: { url: 'http://x/#/cart' } });
assert.strictEqual(tracer.on, true, 'attaching arms the tracer');
assert.strictEqual(activeRecorder(), recorder);
recorder.arm();

const eventToken = tracer.enter(TraceNodeType.EVENT, { eventType: 'click', selector: 'button.inc' });
assert.strictEqual(eventToken, 0, 'the first enter restores to depth 0');

const actionToken = tracer.enter(TraceNodeType.ACTION, { name: 'incQty', component: 'CartItem' });
tracer.record(TraceNodeType.WRITE, { path: 'cart.items.2.qty', from: 1, to: 2 });
tracer.record(TraceNodeType.WRITE, { path: 'cart.total', from: 24, to: 36 });
tracer.leave(actionToken);

tracer.record(TraceNodeType.DOM, { op: 'text', selector: '.qty' });
tracer.leave(eventToken);

const nodes = recorder.nodes;
assert.strictEqual(nodes.length, 5, 'every node was stored');

const [evt, action, write1, write2, dom] = nodes;
assert.strictEqual(evt.parent, null, 'the event is a causal root');
assert.strictEqual(action.parent, evt.id, 'the action is caused by the event');
assert.strictEqual(write1.parent, action.id, 'writes are caused by the action');
assert.strictEqual(write2.parent, action.id);
assert.strictEqual(dom.parent, evt.id, 'after leaving the action, nodes re-parent to the event');
assert.strictEqual(tracer.current(), null, 'the stack unwound completely');

// Ids and sequence numbers are monotonic and stable
assert.deepStrictEqual(nodes.map((n) => n.id), [1, 2, 3, 4, 5]);
assert.deepStrictEqual(nodes.map((n) => n.seq), [1, 2, 3, 4, 5]);
for (const node of nodes) {
  assert.strictEqual(typeof node.t, 'number', 'every node carries a logical timestamp');
  assert.ok(node.t >= 0);
}

// --- Stack safety under exceptions -----------------------------------------

const outer = tracer.enter(TraceNodeType.EVENT, { eventType: 'submit' });
try {
  const inner = tracer.enter(TraceNodeType.ACTION, { name: 'boom' });
  try {
    throw new Error('handler exploded');
  } finally {
    // Deliberately NOT calling leave(inner) — simulating a hook site that
    // forgot, or an exception that skipped past it.
    void inner;
  }
} catch {
  // swallowed
}
assert.ok(tracer.stack.length > outer, 'the stack is left unbalanced by the missing leave');
tracer.leave(outer);
assert.strictEqual(tracer.current(), null, 'the outer leave repairs the unbalanced stack');

// --- Annotation -------------------------------------------------------------

const annotateToken = tracer.enter(TraceNodeType.COMPUTED, { name: 'total' });
tracer.annotate({ to: 36, expression: 'items.reduce(...)' });
tracer.leave(annotateToken);
const computed = recorder.nodes.find((n) => n.type === TraceNodeType.COMPUTED);
assert.strictEqual(computed.to, 36, 'annotate merges into the open node');
assert.strictEqual(computed.expression, 'items.reduce(...)');

// --- Error recording --------------------------------------------------------

const err = new TypeError('nope');
err.code = 'AVX_R99';
tracer.recordError(err, { component: 'CartItem' });
const errorNode = recorder.nodes.find((n) => n.type === TraceNodeType.ERROR);
assert.strictEqual(errorNode.name, 'TypeError');
assert.strictEqual(errorNode.message, 'nope');
assert.strictEqual(errorNode.code, 'AVX_R99');
assert.strictEqual(errorNode.component, 'CartItem');

// --- Serialization ----------------------------------------------------------

const trace = recorder.toJSON();
assert.strictEqual(validateTrace(trace).ok, true, 'the produced trace validates');
assert.strictEqual(trace.id, 'trace-test');
assert.strictEqual(trace.meta.url, 'http://x/#/cart');
assert.strictEqual(trace.determinism.status, Determinism.DETERMINISTIC, 'nothing downgraded this trace');
const roundTripped = JSON.parse(recorder.serialize());
assert.deepStrictEqual(roundTripped.nodes.length, recorder.nodes.length, 'the trace survives JSON');

const finished = stopRecording();
assert.strictEqual(tracer.on, false, 'stopping detaches the tracer');
assert.strictEqual(finished.id, 'trace-test');
assert.strictEqual(stopRecording(), null, 'stopping twice is harmless');

// --- Unattributed writes downgrade determinism ------------------------------

const stray = startRecording({ id: 'trace-stray' });
// During setup, an unattributed write is the app initialising itself.
tracer.record(TraceNodeType.WRITE, { path: 'app.ready', from: false, to: true });
assert.strictEqual(stray.isDeterministic, true, 'setup writes do not count against determinism');

stray.arm();
tracer.record(TraceNodeType.WRITE, { path: 'clock.tick', from: 0, to: 1 });
assert.strictEqual(stray.isDeterministic, false, 'a write with no cause downgrades the trace');
assert.ok(
  stray.reasons.has(NonDeterminismReason.UNATTRIBUTED_WRITE),
  'the downgrade names the reason',
);
assert.ok(
  stray.reasons.get(NonDeterminismReason.UNATTRIBUTED_WRITE).includes('clock.tick'),
  'the reason names an example path',
);
assert.strictEqual(stray.toJSON().determinism.status, Determinism.BEST_EFFORT);
stopRecording();

// --- Determinism never upgrades --------------------------------------------

const downgraded = new TraceRecorder();
downgraded.markNonDeterministic(NonDeterminismReason.POLLING_RESOURCE, 'first');
downgraded.markNonDeterministic(NonDeterminismReason.POLLING_RESOURCE, 'second');
assert.strictEqual(downgraded.reasons.size, 1, 'repeat reasons are collapsed');
assert.strictEqual(downgraded.reasons.get(NonDeterminismReason.POLLING_RESOURCE), 'first', 'the first detail is kept');
assert.strictEqual(downgraded.isDeterministic, false);

// --- Ring buffer ------------------------------------------------------------

const bounded = new TraceRecorder({ maxNodes: 100 });
bounded.arm();
for (let i = 0; i < 500; i++) {
  bounded.push(TraceNodeType.DOM, { op: 'text', selector: `#n${i}` }, null);
}
assert.ok(bounded.nodes.length <= 100, `buffer stays bounded (was ${bounded.nodes.length})`);
assert.ok(bounded.dropped > 0, 'dropped nodes are counted');
assert.strictEqual(bounded.isDeterministic, false, 'a truncated trace cannot be deterministic');
assert.ok(bounded.reasons.has(NonDeterminismReason.TRUNCATED));
assert.strictEqual(
  bounded.index.size,
  bounded.nodes.length,
  'the annotation index is pruned alongside the buffer, so it cannot leak',
);
// The surviving nodes are the most recent ones.
const last = bounded.nodes[bounded.nodes.length - 1];
assert.strictEqual(last.selector, '#n499', 'the newest node survives eviction');

// --- Lossy capture downgrades determinism -----------------------------------

const lossy = new TraceRecorder();
assert.strictEqual(lossy.capture(42), 42);
assert.strictEqual(lossy.isDeterministic, true, 'capturing plain data keeps the trace deterministic');
lossy.capture(() => {}, 'state.callback');
assert.strictEqual(lossy.isDeterministic, false, 'an unserializable value downgrades the trace');
assert.ok(lossy.reasons.has(NonDeterminismReason.UNSERIALIZABLE_VALUE));

// --- Redaction is wired through the recorder --------------------------------

const secure = new TraceRecorder({ redact: ['auth.token'] });
const captured = secure.capture({ token: 'hunter2', name: 'ada' }, 'auth');
assert.strictEqual(captured.token, REDACTED);
assert.strictEqual(captured.name, 'ada');
const secureTrace = secure.toJSON();
assert.deepStrictEqual(secureTrace.redactions, ['auth.token'], 'the trace declares what was withheld');
assert.strictEqual(secureTrace.redacted, true);
assert.ok(!JSON.stringify(secureTrace).includes('hunter2'), 'the secret is absent from the serialized trace');

// --- Recorded globals -------------------------------------------------------

const clocked = new TraceRecorder();
assert.strictEqual(clocked.recordGlobal('now', 1000), 1000, 'recordGlobal is transparent');
clocked.recordGlobal('now', 1016);
clocked.recordGlobal('random', 0.5);
assert.deepStrictEqual(clocked.toJSON().globals, { now: [1000, 1016], random: [0.5] });

// --- Phase & counts ---------------------------------------------------------

const phased = new TraceRecorder();
assert.strictEqual(phased.phase, RecorderPhase.SETUP);
phased.arm();
assert.strictEqual(phased.phase, RecorderPhase.RECORDING);
phased.push(TraceNodeType.ACTION, { component: 'A' }, null);
phased.push(TraceNodeType.ACTION, { component: 'B' }, null);
phased.push(TraceNodeType.ACTION, { component: 'A' }, null);
assert.strictEqual(phased.componentCount, 2, 'distinct components are counted');
phased.stop();
assert.strictEqual(phased.phase, RecorderPhase.STOPPED);

console.log('✅ All tracer and recorder tests passed.');
