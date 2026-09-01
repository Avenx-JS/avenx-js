import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent, flushPromises } from '../../lib/core/testing.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { TraceNodeType, indexNodes } from '../../lib/core/trace/schema.js';
import { describeNode, resolveNode, formatNodeRef } from '../../lib/core/trace/dom.js';

console.log('🧪 Testing DOM patch tracing...');

// --- Node references are resolvable, which is what replay needs -------------

document.body.innerHTML =
  '<div id="app"><button class="qty-inc">+</button><button class="qty-inc">+</button>' +
  '<span id="named">x</span></div>';

const buttons = document.querySelectorAll('button.qty-inc');
const firstRef = describeNode(buttons[0]);
const secondRef = describeNode(buttons[1]);

assert.strictEqual(firstRef.selector, 'button.qty-inc');
assert.strictEqual(firstRef.nth, 0);
assert.strictEqual(secondRef.nth, 1, 'identical elements are distinguished by index');
assert.strictEqual(resolveNode(firstRef), buttons[0], 'the first reference resolves back');
assert.strictEqual(resolveNode(secondRef), buttons[1], 'the second reference resolves back');

const namedRef = describeNode(document.getElementById('named'));
assert.strictEqual(namedRef.selector, '#named', 'an id is preferred over a tag/class selector');
assert.strictEqual(resolveNode(namedRef), document.getElementById('named'));

// Internal bookkeeping attributes never leak into a selector.
document.body.innerHTML = '<i class="data-ax-internal real-class"></i>';
const filtered = describeNode(document.querySelector('i'));
assert.ok(!filtered.selector.includes('data-ax'), `internal classes are filtered: ${filtered.selector}`);
assert.ok(filtered.selector.includes('real-class'));

// A text node is addressed through its containing element.
document.body.innerHTML = '<p class="msg">hello</p>';
const textRef = describeNode(document.querySelector('p.msg').firstChild);
assert.strictEqual(textRef.selector, 'p.msg', 'text nodes are described by their parent element');

assert.strictEqual(describeNode(null), null, 'a missing node yields no reference');
assert.strictEqual(resolveNode(null), null);
assert.strictEqual(resolveNode({ selector: 'nope.missing', nth: 0 }), null, 'an unmatched reference resolves to null');
assert.strictEqual(formatNodeRef(firstRef), '<button.qty-inc>');
assert.strictEqual(formatNodeRef(secondRef), '<button.qty-inc[1]>');
assert.strictEqual(formatNodeRef(null), '<unknown>');

document.body.innerHTML = '';

// --- Patches are recorded and attributed ------------------------------------

/**
 * A component whose click changes text, an attribute, and list length.
 */
class PanelComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { label: 'off', items: ['a'] },
      {},
      bridges,
      '<div class="panel"><span class="label" title="{{ label }}">{{ label }}</span>' +
        '<button class="toggle" @click="flip()">go</button></div>',
      { flip: "state.label = state.label === 'off' ? 'on' : 'off';" },
      props,
    );
  }
}

const wrapper = await mountTestComponent(PanelComponent, {});
assert.ok(wrapper.element.outerHTML.includes('off'), 'the initial render happened');

const recorder = startRecording();
recorder.arm();
wrapper.find('button.toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
stopRecording();

const nodes = recorder.nodes;
const byId = indexNodes({ nodes });
const domNodes = nodes.filter((n) => n.type === TraceNodeType.DOM);
assert.ok(domNodes.length > 0, 'DOM mutations were recorded');

// The text change is recorded with both sides of the value.
const textOp = domNodes.find((n) => n.op === 'text');
assert.ok(textOp, 'the text mutation was recorded');
assert.strictEqual(textOp.from, 'off');
assert.strictEqual(textOp.to, 'on');
assert.strictEqual(textOp.target.selector, 'span.label', 'the changed element is identified');
assert.strictEqual(textOp.component, 'PanelComponent', 'the owning component is identified');

// The attribute change is recorded with its name.
const attrOp = domNodes.find((n) => n.op === 'attr' && n.name === 'title');
assert.ok(attrOp, 'the attribute mutation was recorded');
assert.strictEqual(attrOp.from, 'off');
assert.strictEqual(attrOp.to, 'on');

// Every DOM mutation traces back through the write to the click. This is the
// question the feature exists to answer: which state change caused this node
// to change?
/**
 * Collects a node's ancestor types.
 * @param {object} node - Starting node.
 * @returns {string[]} Ancestor types, innermost first.
 */
function chain(node) {
  const out = [];
  let current = node;
  while (current) {
    out.push(current.type);
    current = current.parent === null ? null : byId.get(current.parent);
  }
  return out;
}

for (const op of domNodes) {
  const types = chain(op);
  assert.ok(types.includes(TraceNodeType.WRITE), `DOM op "${op.op}" traces back to a write: ${types.join(' <- ')}`);
  assert.ok(types.includes(TraceNodeType.EVENT), `DOM op "${op.op}" traces back to the click`);
}

const write = nodes.find((n) => n.type === TraceNodeType.WRITE);
assert.strictEqual(write.path, 'label');
assert.strictEqual(write.from, 'off');
assert.strictEqual(write.to, 'on');

// The DOM genuinely changed — tracing observed it rather than inventing it.
assert.ok(wrapper.element.outerHTML.includes('title="on"'), 'the attribute really changed');
assert.ok(wrapper.element.outerHTML.includes('>on<'), 'the text really changed');
wrapper.unmount();

// --- Tracing off records nothing but behaves identically --------------------

const untraced = await mountTestComponent(PanelComponent, {});
untraced.find('button.toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
assert.ok(untraced.element.outerHTML.includes('title="on"'), 'the untraced component patches identically');
untraced.unmount();

console.log('✅ All DOM patch tracing tests passed.');
