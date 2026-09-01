import assert from 'assert';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent, flushPromises } from '../../lib/core/testing.js';
import { tracer } from '../../lib/core/trace/tracer.js';
import { startRecording, stopRecording, TraceRecorder } from '../../lib/core/trace/recorder.js';
import { TraceNodeType } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing trace performance and memory bounds...');

const factory = new StateFactory();

/**
 * Times a function, taking the best of several runs to blunt GC noise.
 * @param {Function} fn - What to time.
 * @param {number} [runs] - How many attempts.
 * @returns {number} The fastest run, in milliseconds.
 */
function best(fn, runs = 5) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

// --- Tracing off must be free ------------------------------------------------

assert.strictEqual(tracer.on, false, 'tracing starts off');

const WRITES = 40_000;

/**
 * A tight write loop, the hottest path instrumentation touches.
 */
function hammer() {
  const state = factory.create({ count: 0, nested: { value: 0 } });
  for (let i = 0; i < WRITES; i++) {
    state.count = i;
    state.nested.value = i;
  }
}

const offMs = best(hammer);
assert.ok(offMs >= 0, 'the untraced baseline ran');
assert.strictEqual(tracer.on, false, 'and left tracing off');

// The guard on each hook site is one property read and one comparison, so the
// untraced path should stay in the same order of magnitude it always was.
// Asserting a wall-clock number would be flaky on shared CI, so this asserts
// the shape instead: no node is produced, and no state is retained.
const recorderBefore = tracer.sink;
hammer();
assert.strictEqual(tracer.sink, recorderBefore, 'writing while off touches no recorder');

// --- Tracing on is bounded, not free ----------------------------------------

const recorder = startRecording({ maxNodes: 2000 });
recorder.arm();
const onMs = best(() => {
  const state = factory.create({ count: 0 });
  const token = tracer.enter(TraceNodeType.EVENT, { eventType: 'click' });
  for (let i = 0; i < 2000; i++) {
    state.count = i;
  }
  tracer.leave(token);
}, 3);
stopRecording();

assert.ok(onMs >= 0, 'the traced run completed');
// The real guarantee is memory, not speed: a long session must not grow without
// limit, whatever the machine's clock says.
assert.ok(recorder.nodes.length <= 2000, `the buffer stayed bounded (${recorder.nodes.length})`);
assert.ok(recorder.dropped > 0, 'and dropped what did not fit');

console.log(`  baseline ${offMs.toFixed(1)}ms for ${WRITES * 2} untraced writes`);
console.log(`  traced   ${onMs.toFixed(1)}ms for 2000 traced writes (bounded to 2000 nodes)`);

// --- The annotation index is pruned with the buffer -------------------------

const bounded = new TraceRecorder({ maxNodes: 500 });
bounded.arm();
for (let i = 0; i < 20_000; i++) {
  bounded.push(TraceNodeType.DOM, { op: 'text', selector: `#n${i}` }, null);
}
assert.ok(bounded.nodes.length <= 500, 'the buffer holds its ceiling under sustained load');
assert.strictEqual(
  bounded.index.size,
  bounded.nodes.length,
  'the id index is pruned alongside the buffer, so it cannot become the leak the buffer prevents',
);
assert.strictEqual(bounded.dropped, 20_000 - bounded.nodes.length, 'every dropped node is accounted for');

// --- Collections are summarised, not cloned ---------------------------------

const listRecorder = startRecording();
listRecorder.arm();
const listState = factory.create({ items: [] });
const listToken = tracer.enter(TraceNodeType.EVENT, { eventType: 'click' });
for (let i = 0; i < 500; i++) {
  listState.items.push(i);
}
tracer.leave(listToken);
stopRecording();

const pushes = listRecorder.nodes.filter((n) => n.op === 'push');
assert.strictEqual(pushes.length, 500, 'every push was recorded');
assert.ok(
  pushes.every((node) => node.to === undefined && typeof node.size === 'number'),
  'a push records the resulting size, never a clone of the array — otherwise tracing a growing list is quadratic',
);
const serializedSize = listRecorder.serialize().length;
assert.ok(
  serializedSize < 200_000,
  `500 pushes serialize to a bounded trace (${serializedSize} bytes), not a copy of the list each time`,
);

// --- A single value capture cannot blow up ----------------------------------

const wide = { items: Array.from({ length: 5000 }, (_, i) => ({ id: i, label: `row ${i}`.repeat(20) })) };
const captureRecorder = new TraceRecorder();
const capturedJson = JSON.stringify(captureRecorder.capture(wide, 'state.table'));
assert.ok(
  capturedJson.length < 60_000,
  `a large value is bounded in depth, breadth and string length (${capturedJson.length} bytes)`,
);
assert.strictEqual(
  captureRecorder.isDeterministic,
  false,
  'and truncating it is reported, not hidden — replay cannot restore what was summarised',
);

// --- Behaviour is identical traced and untraced -----------------------------

/**
 * A component with enough moving parts to notice a behavioural difference.
 */
class ListComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { items: [1, 2, 3], label: 'idle' },
      {},
      bridges,
      '<div><span class="label">{{ label }}</span><span class="count">{{ items.length }}</span>' +
        '<button class="add" @click="add()">+</button></div>',
      { add: "state.items.push(state.items.length + 1); state.label = 'added';" },
      props,
    );
  }
}

/**
 * Clicks a component three times and reports what it ended up rendering.
 * @param {boolean} traced - Whether to record while doing it.
 * @returns {Promise<string>} The rendered HTML.
 */
async function run(traced) {
  const wrapper = await mountTestComponent(ListComponent, {});
  if (traced) {
    startRecording().arm();
  }
  for (let i = 0; i < 3; i++) {
    wrapper.find('button.add').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flushPromises();
  }
  if (traced) {
    stopRecording();
  }
  const html = wrapper.element.outerHTML;
  const state = JSON.stringify({ items: [...wrapper.instance.state.items], label: wrapper.instance.state.label });
  wrapper.unmount();
  return `${html}|${state}`;
}

const untracedResult = await run(false);
const tracedResult = await run(true);
assert.strictEqual(
  tracedResult,
  untracedResult,
  'recording must not change what the application does, only observe it',
);

// --- The tracer is left clean ------------------------------------------------

assert.strictEqual(tracer.on, false, 'tracing is off again');
assert.strictEqual(tracer.sink, null, 'no recorder is retained');
assert.strictEqual(tracer.stack.length, 0, 'the causal stack unwound completely');

console.log('✅ All trace performance and memory tests passed.');
