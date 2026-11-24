import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

const root = document.createElement('div');
document.body.appendChild(root);
root.innerHTML =
  '<template slot="footer"><b id="first">first</b><span id="second">second</span></template>' +
  '<p id="body">default body</p>';
const original = root.querySelector('template').content.firstElementChild;
const component = new AvenxComponent(
  { count: 0 },
  {},
  {},
  '<article><p>{{ count }}</p><slot name="footer"><i id="fallback">fallback</i></slot><slot></slot></article>',
);
const update = (html) => {
  const incoming = document.createElement('div');
  incoming.innerHTML = html;
  component.__updateTranscludedContent(incoming.childNodes);
};

try {
  component.mount(root);
  assert.ok(root.querySelector('#first'), 'named template children must be in the live DOM');
  assert.equal(root.querySelector('#first').textContent, 'first');
  assert.equal(root.querySelector('#second').textContent, 'second');
  assert.equal(root.querySelector('#body').textContent, 'default body');
  assert.equal(root.querySelector('slot[name="footer"] template'), null, 'the grouping wrapper is not projected');
  assert.ok(root.querySelector('#first') === original, 'mount moves the provided nodes without cloning them');
  assert.equal(component.$slots.has('footer'), true);

  component.state.count = 1;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(root.querySelector('#first') === original, 'a child update retains the projected live nodes');

  update('<template slot="footer"><b id="first">updated</b><span id="second">also updated</span></template>');
  assert.ok(root.querySelector('#first') === original, 'a parent update patches existing slot content');
  assert.equal(original.textContent, 'updated');
  assert.equal(root.querySelector('#second').textContent, 'also updated');

  update('<template slot="footer"></template>');
  assert.equal(root.querySelector('#first'), null);
  assert.equal(root.querySelector('#fallback').textContent, 'fallback', 'an empty grouping template uses fallback');
  assert.equal(component.$slots.has('footer'), false);

  update('<template slot="footer"><b id="restored">restored</b></template>');
  assert.equal(root.querySelector('#restored').textContent, 'restored');
  assert.equal(root.querySelector('#fallback'), null);
} finally {
  await component.unmount();
  root.remove();
}

const scopedRoot = document.createElement('div');
document.body.appendChild(scopedRoot);
scopedRoot.innerHTML = '<template slot="footer" data-slot-props="row"><b>{{ row.value }}</b></template>';
const scoped = new AvenxComponent({ count: 7 }, {}, {}, '<slot name="footer" data-props-value="count"></slot>');
try {
  scoped.mount(scopedRoot);
  assert.equal(scopedRoot.querySelector('b').textContent, '7', 'scoped templates keep their scope declaration');
  scoped.state.count = 8;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scopedRoot.querySelector('b').textContent, '8');
} finally {
  await scoped.unmount();
  scopedRoot.remove();
}
console.log('Named template slots render and update live content, restore fallback, and preserve scoped templates.');
