import assert from 'assert';
import { bridge } from '../../lib/core/runtime/bridge.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent, flushPromises } from '../../lib/core/testing.js';
import { tracer } from '../../lib/core/trace/tracer.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { TraceNodeType, indexNodes } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing bridge action, emit and derived-value tracing...');

/**
 * Builds a cart bridge with an action, a getter and an event.
 * @returns {object} The bridge instance.
 */
function makeCart() {
  return bridge({
    state: { items: [{ id: 'a', price: 12, qty: 1 }, { id: 'b', price: 6, qty: 2 }] },
    get total() {
      return this.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    },
    addQty(id, delta) {
      const item = this.items.find((entry) => entry.id === id);
      if (item) {
        item.qty += delta;
        this.emit('changed', { id, qty: item.qty });
      }
    },
  });
}

// --- Bridge actions are recorded with their arguments -----------------------

const cart = makeCart();
assert.strictEqual(cart.total, 24, 'the getter works before any tracing');

const recorder = startRecording();
recorder.arm();

// Establish the getter baseline the way a render would, so the first read is
// not reported as a change.
void cart.total;

const eventToken = tracer.enter(TraceNodeType.EVENT, { eventType: 'click', selector: 'button.inc' });
cart.addQty('a', 1);
void cart.total;
tracer.leave(eventToken);
stopRecording();

const nodes = recorder.nodes;
const byId = indexNodes({ nodes });
const first = (type) => nodes.find((n) => n.type === type);

const clickNode = first(TraceNodeType.EVENT);
const actionNode = first(TraceNodeType.BRIDGE_ACTION);
assert.ok(actionNode, 'the bridge action was recorded');
assert.strictEqual(actionNode.bridge, 'bridge', 'the bridge name is recorded (the compiler-assigned default here)');
assert.strictEqual(actionNode.name, 'addQty');
assert.deepStrictEqual(actionNode.args, ['a', 1], 'the arguments are captured');
assert.strictEqual(actionNode.parent, clickNode.id, 'the bridge action is caused by the click');

// --- The write inside the bridge is attributed to the bridge action ---------

const writeNode = nodes.find((n) => n.type === TraceNodeType.WRITE && String(n.path).endsWith('qty'));
assert.ok(writeNode, 'the state mutation inside the bridge was recorded');
assert.strictEqual(writeNode.from, 1);
assert.strictEqual(writeNode.to, 2);
assert.strictEqual(
  byId.get(writeNode.parent).type,
  TraceNodeType.BRIDGE_ACTION,
  'the mutation is attributed to the bridge action that made it — the single traceable origin',
);

// --- Emitted events open a scope of their own -------------------------------

const emitNode = first(TraceNodeType.BRIDGE_EMIT);
assert.ok(emitNode, 'the emit was recorded');
assert.strictEqual(emitNode.event, 'changed');
assert.deepStrictEqual(emitNode.payload, { id: 'a', qty: 2 }, 'the payload is captured');
assert.strictEqual(emitNode.listeners, 0, 'the listener count is recorded');
assert.strictEqual(
  byId.get(emitNode.parent).type,
  TraceNodeType.BRIDGE_ACTION,
  'the emit happened inside the action',
);

// --- Getters are recorded only when the derived value changed ---------------

const derived = nodes.filter((n) => n.type === TraceNodeType.COMPUTED);
assert.strictEqual(derived.length, 1, `the getter is recorded once, when it changed (got ${derived.length})`);
assert.strictEqual(derived[0].name, 'total');
assert.strictEqual(derived[0].kind, 'getter');
assert.strictEqual(derived[0].from, 24);
assert.strictEqual(derived[0].to, 36, 'the derived value change is what makes it worth recording');

// --- A getter read that changes nothing records nothing ---------------------

const quiet = makeCart();
const quietRecorder = startRecording();
quietRecorder.arm();
void quiet.total;
void quiet.total;
void quiet.total;
stopRecording();
assert.strictEqual(
  quietRecorder.nodes.filter((n) => n.type === TraceNodeType.COMPUTED).length,
  0,
  'repeated reads of an unchanged getter produce no nodes',
);

// --- Emitting to real listeners nests their work under the emit -------------

const notified = [];
const eventful = makeCart();
const unsubscribe = eventful.on('changed', (payload) => notified.push(payload));

const emitRecorder = startRecording();
emitRecorder.arm();
const t = tracer.enter(TraceNodeType.EVENT, { eventType: 'click' });
eventful.addQty('b', 3);
tracer.leave(t);
stopRecording();

const liveEmit = emitRecorder.nodes.find((n) => n.type === TraceNodeType.BRIDGE_EMIT);
assert.strictEqual(liveEmit.listeners, 1, 'the live listener is counted');
assert.deepStrictEqual(notified, [{ id: 'b', qty: 5 }], 'listeners still ran normally');
unsubscribe();

// --- Component computed properties -----------------------------------------

/**
 * A component with a computed that a click invalidates.
 *
 * The computed is written `state.qty * state.price` rather than `qty * price`.
 * The bare form trips a pre-existing re-entrancy in scope construction
 * (AVX_R04) that leaves the computed without dependencies, so it never updates
 * at all — with or without tracing. That is a framework bug in its own right
 * and is deliberately not worked around here.
 */
class TotalsComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { qty: 2, price: 10 },
      { subtotal: 'state.qty * state.price' },
      bridges,
      '<div><span class="sub">{{ subtotal }}</span><button class="inc" @click="bump()">+</button></div>',
      { bump: 'state.qty = state.qty + 1;' },
      props,
    );
  }
}

const wrapper = await mountTestComponent(TotalsComponent, {});
assert.ok(wrapper.element.outerHTML.includes('20'), 'the computed rendered before tracing');

const compRecorder = startRecording();
compRecorder.arm();
const incButton = wrapper.find('button.inc');
incButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
incButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
stopRecording();

const computedNodes = compRecorder.nodes.filter((n) => n.type === TraceNodeType.COMPUTED);
const subtotal = computedNodes.find((n) => n.name === 'subtotal' && n.to === 40);
assert.ok(subtotal, 'the recomputed computed property was recorded');
assert.strictEqual(subtotal.kind, 'computed');
assert.strictEqual(subtotal.component, 'TotalsComponent');
assert.strictEqual(subtotal.expression, 'state.qty * state.price', 'the expression source is recorded');
assert.strictEqual(subtotal.from, 30, 'the previous cached value is the honest "from" side');
assert.strictEqual(subtotal.to, 40);
assert.ok(wrapper.element.outerHTML.includes('40'), 'the DOM reflects the new value');
// The template reads `subtotal` on every render, and both clicks re-rendered.
// At most one node per actual change is recorded, never one per read.
const subtotalNodes = computedNodes.filter((n) => n.name === 'subtotal');
assert.ok(
  subtotalNodes.length >= 1 && subtotalNodes.length <= 2,
  `at most one node per change, got ${subtotalNodes.length}`,
);
assert.deepStrictEqual(
  subtotalNodes.map((n) => n.to),
  [...new Set(subtotalNodes.map((n) => n.to))],
  'the same value is never reported as a change twice',
);
wrapper.unmount();

console.log('✅ All bridge and derived-value tracing tests passed.');
