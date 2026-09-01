import assert from 'assert';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { AvenxWatcher } from '../../lib/core/reactive/watcher.js';
import { queueJob, nextTick } from '../../lib/core/reactive/scheduler.js';
import { tracer } from '../../lib/core/trace/tracer.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { TraceNodeType, indexNodes } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing reactive causation chains...');

const factory = new StateFactory();

/**
 * Walks a node's ancestry to the root, newest-first.
 * @param {object} recorder - The recorder.
 * @param {object} node - The node to walk up from.
 * @returns {string[]} Ancestor node types, innermost first.
 */
function ancestry(recorder, node) {
  const byId = indexNodes({ nodes: recorder.nodes });
  const chain = [];
  let current = node;
  while (current) {
    chain.push(current.type);
    current = current.parent === null ? null : byId.get(current.parent);
  }
  return chain;
}

// --- A write wakes a watcher, and the watcher is a child of the write -------

const state = factory.create({ count: 0, unrelated: 'x' });
const recorder = startRecording();
recorder.arm();

const seen = [];
const watcher = new AvenxWatcher(
  () => state.count,
  (value) => seen.push(value),
  { name: 'CounterView#render' },
);

state.count = 1;

const write = recorder.nodes.find((n) => n.type === TraceNodeType.WRITE);
const woken = recorder.nodes.find((n) => n.type === TraceNodeType.WATCHER);
assert.ok(write, 'the write was recorded');
assert.ok(woken, 'the woken watcher was recorded');
assert.strictEqual(woken.parent, write.id, 'the watcher hangs off the write that woke it');
assert.strictEqual(woken.name, 'CounterView#render');
assert.strictEqual(woken.kind, 'render', 'a #render watcher is classified as a render');
assert.strictEqual(woken.component, 'CounterView', 'the component is lifted out of the watcher name');
assert.deepStrictEqual(seen, [1], 'instrumentation did not change what the watcher observed');

// A write nothing depends on wakes nothing.
const before = recorder.nodes.filter((n) => n.type === TraceNodeType.WATCHER).length;
state.unrelated = 'y';
const after = recorder.nodes.filter((n) => n.type === TraceNodeType.WATCHER).length;
assert.strictEqual(after, before, 'an undepended-on write wakes no watcher');

watcher.teardown();
stopRecording();

// --- Full chain: action -> write -> watcher --------------------------------

const chainState = factory.create({ qty: 1 });
const chainRecorder = startRecording();
chainRecorder.arm();

const chainWatcher = new AvenxWatcher(() => chainState.qty, () => {}, { name: 'CartItem#render' });
const actionToken = tracer.enter(TraceNodeType.ACTION, { name: 'incQty', component: 'CartItem' });
chainState.qty = 2;
tracer.leave(actionToken);

const chainWoken = chainRecorder.nodes.find((n) => n.type === TraceNodeType.WATCHER);
assert.deepStrictEqual(
  ancestry(chainRecorder, chainWoken),
  [TraceNodeType.WATCHER, TraceNodeType.WRITE, TraceNodeType.ACTION],
  'the chain reads watcher <- write <- action',
);
chainWatcher.teardown();
stopRecording();

// --- Watcher kinds ----------------------------------------------------------

const kindState = factory.create({ v: 0 });
const kindRecorder = startRecording();
kindRecorder.arm();
const effect = new AvenxWatcher(() => kindState.v, { name: 'sideEffect', isEffect: true });
kindState.v = 1;
const effectNode = kindRecorder.nodes.find((n) => n.type === TraceNodeType.WATCHER);
assert.strictEqual(effectNode.kind, 'effect', 'an effect watcher is classified as an effect');
assert.strictEqual(effectNode.component, undefined, 'a non-render watcher carries no component');
effect.teardown();
stopRecording();

// --- Causality survives the scheduler's microtask boundary -----------------

const asyncState = factory.create({ n: 0 });
const asyncRecorder = startRecording();
asyncRecorder.arm();

let ranInFlush = null;
/**
 * A component-style update job, queued by the watcher rather than run inline.
 */
function updateJob() {
  // Whatever the trace records here must still be attributed to the write,
  // even though this runs a microtask later on an otherwise empty stack.
  ranInFlush = tracer.record(TraceNodeType.DOM, { op: 'text', selector: '.n' });
}
updateJob.id = 1;

const asyncWatcher = new AvenxWatcher(
  () => asyncState.n,
  () => queueJob(updateJob),
  { name: 'Async#render' },
);

// Driven from an event, the way a real interaction reaches state.
const eventToken = tracer.enter(TraceNodeType.EVENT, { eventType: 'click', selector: 'button' });
asyncState.n = 5;
tracer.leave(eventToken);

assert.strictEqual(ranInFlush, null, 'the job has not run yet — it is batched');
await nextTick();
assert.ok(ranInFlush, 'the job ran during the flush');

assert.deepStrictEqual(
  ancestry(asyncRecorder, ranInFlush),
  [TraceNodeType.DOM, TraceNodeType.WATCHER, TraceNodeType.WRITE, TraceNodeType.EVENT],
  'a DOM patch applied a microtask later is still attributed back to the click that caused it',
);
assert.strictEqual(
  asyncRecorder.isDeterministic,
  true,
  'work carried across the scheduler is attributed, so it does not look like stray non-determinism',
);
assert.strictEqual(updateJob.__avenxTraceCause, undefined, 'the stamp is cleared after the job runs');
assert.strictEqual(tracer.current(), null, 'the flush left the causal stack clean');

asyncWatcher.teardown();
stopRecording();

// --- A write with no recorded input is exactly what non-determinism looks like

const strayState = factory.create({ tick: 0 });
const strayRecorder = startRecording();
strayRecorder.arm();
// No event, no action: this is the signature of a stray timer or an outside
// listener mutating state, which replay has no way to reproduce.
strayState.tick = 1;
assert.strictEqual(
  strayRecorder.isDeterministic,
  false,
  'a write the recorder cannot attribute downgrades the trace rather than being ignored',
);
stopRecording();

// --- With tracing off, jobs are never stamped -------------------------------

/**
 * A job used to confirm nothing is attached while tracing is off.
 */
function plainJob() {}
plainJob.id = 2;
queueJob(plainJob);
await nextTick();
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(plainJob, '__avenxTraceCause'),
  false,
  'queueing while tracing is off attaches nothing to the job',
);

console.log('✅ All reactive causation tests passed.');
