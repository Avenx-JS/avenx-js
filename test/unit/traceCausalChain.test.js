import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent, flushPromises } from '../../lib/core/testing.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { TraceNodeType, indexNodes, rootNodes } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing end-to-end causal chain on a mounted component...');

/**
 * A counter whose button runs a named action rather than an inline expression,
 * so the trace has an action node to attribute the write to.
 */
class CounterComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { count: 0 },
      {},
      bridges,
      '<div class="counter"><span class="value">{{ count }}</span>' +
        '<button class="inc" @click="increment()">+</button></div>',
      { increment: 'state.count = state.count + 1;' },
      props,
    );
  }
}

const wrapper = await mountTestComponent(CounterComponent, {});

// Recording starts after mount, so the component constructing itself is not
// mistaken for stray non-determinism.
const recorder = startRecording({ id: 'trace-counter', meta: { component: 'Counter' } });
recorder.arm();

const button = wrapper.find('button.inc');
assert.ok(button, 'the button mounted');
button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();

stopRecording();

const nodes = recorder.nodes;
const byId = indexNodes({ nodes });
const typeOf = (type) => nodes.filter((n) => n.type === type);

// 1. The click is the one causal root.
const roots = rootNodes({ nodes });
assert.strictEqual(roots.length, 1, `exactly one causal root, got ${roots.length}`);
const event = roots[0];
assert.strictEqual(event.type, TraceNodeType.EVENT, 'the root is the click');
assert.strictEqual(event.eventType, 'click');
assert.strictEqual(event.handler, 'increment()', 'the handler source is recorded verbatim');
assert.ok(event.target, 'the clicked element is described');
assert.ok(event.target.selector.includes('button'), `the selector names the button: ${event.target.selector}`);
assert.strictEqual(event.component, 'CounterComponent', 'the owning component is identified');

// 2. The action ran because of the click.
const actions = typeOf(TraceNodeType.ACTION);
assert.strictEqual(actions.length, 1, `one action ran, got ${actions.length}`);
const action = actions[0];
assert.strictEqual(action.name, 'increment');
assert.strictEqual(action.component, 'CounterComponent', 'the owning component is recorded');
assert.strictEqual(action.source, 'state.count = state.count + 1;', 'the action body is recorded verbatim');
assert.strictEqual(action.parent, event.id, 'the action is caused by the click');

// 3. The write happened because of the action.
const writes = typeOf(TraceNodeType.WRITE);
assert.strictEqual(writes.length, 1, `one write, got ${writes.length}`);
const write = writes[0];
assert.strictEqual(write.path, 'count');
assert.strictEqual(write.from, 0);
assert.strictEqual(write.to, 1);
assert.strictEqual(write.parent, action.id, 'the write is caused by the action');

// 4. The render watcher woke because of the write.
const watchers = typeOf(TraceNodeType.WATCHER);
assert.ok(watchers.length >= 1, 'at least one watcher woke');
const render = watchers.find((w) => w.kind === 'render');
assert.ok(render, 'the component render watcher woke');
assert.strictEqual(render.component, 'CounterComponent');
assert.strictEqual(render.parent, write.id, 'the render was caused by the write');

// 5. Every node traces back to the click — nothing is unexplained.
/**
 * Walks a node up to its causal root.
 * @param {object} node - Starting node.
 * @returns {object} The root node.
 */
function rootOf(node) {
  let current = node;
  while (current.parent !== null && byId.has(current.parent)) {
    current = byId.get(current.parent);
  }
  return current;
}
for (const node of nodes) {
  assert.strictEqual(rootOf(node).id, event.id, `node ${node.id} (${node.type}) traces back to the click`);
}

// 6. The application behaved exactly as it would untraced.
assert.strictEqual(wrapper.instance.state.count, 1, 'the click still incremented the counter');
assert.ok(wrapper.element.outerHTML.includes('>1<'), 'the DOM still updated');

// 7. Everything is explained, so the trace stands as deterministic.
assert.strictEqual(
  recorder.isDeterministic,
  true,
  `a fully attributed interaction is deterministic; reasons: ${[...recorder.reasons.keys()].join(', ')}`,
);

// 8. The trace survives a JSON round trip with its causality intact.
const parsed = JSON.parse(recorder.serialize());
assert.strictEqual(parsed.traceVersion, 1);
assert.strictEqual(parsed.nodes.length, nodes.length);
assert.strictEqual(
  parsed.nodes.find((n) => n.type === TraceNodeType.WRITE).parent,
  action.id,
  'causality survives serialization',
);

wrapper.unmount();

// 9. With tracing stopped, the runtime records nothing and still works.
const sizeAfterStop = recorder.nodes.length;
const second = await mountTestComponent(CounterComponent, {});
second.find('button.inc').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
assert.strictEqual(recorder.nodes.length, sizeAfterStop, 'a stopped recorder receives nothing');
assert.strictEqual(second.instance.state.count, 1, 'the untraced component behaves identically');
second.unmount();

console.log('✅ End-to-end causal chain tests passed.');
