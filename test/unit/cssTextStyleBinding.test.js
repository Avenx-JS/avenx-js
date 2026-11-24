// @avenx-no-dev-runtime
import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { compileComponent, cleanup } from '../../benches/support/compileFixture.js';
import { hasExpressionInterpreter } from '../../lib/core/expression/fallback.js';

const Styled = compileComponent(
  '<state cssText="" /><p style="font-weight:700" data-ax-style="cssText">CSS text</p>',
  'CssTextStyleBinding',
);
const component = new Styled({}, {});
const root = document.createElement('div');
document.body.appendChild(root);

try {
  assert.equal(hasExpressionInterpreter(), false);
  component.state.cssText = '--caption: first; color: red !important; background-color: blue';
  component.mount(root);
  assert.equal(component.$compiled, true);
  const style = root.querySelector('p').style;
  assert.equal(style.getPropertyValue('--caption'), 'first');
  assert.equal(style.backgroundColor, 'blue');
  assert.equal(style.color, 'red');
  assert.equal(style.getPropertyPriority('color'), 'important', 'priority is passed separately to CSSOM');
  assert.equal(style.fontWeight, '700', 'the binding preserves unrelated static declarations');

  component.state.cssText = '--caption: after; color: red;';
  await component.$nextTick();
  assert.equal(style.getPropertyValue('--caption'), 'after');
  assert.equal(style.getPropertyPriority('color'), '', 'priority changes even when the color value is unchanged');
  assert.equal(style.backgroundColor, '', 'removed declarations are cleared');
  assert.equal(style.fontWeight, '700');

  component.state.cssText = { color: 'green', backgroundColor: 'white' };
  await component.$nextTick();
  assert.equal(style.color, 'green');
  assert.equal(style.backgroundColor, 'white', 'object bindings still support camelCase names');
  assert.equal(style.getPropertyValue('--caption'), '');

  component.state.cssText = null;
  await component.$nextTick();
  assert.equal(style.color, '');
  assert.equal(style.backgroundColor, '');
  assert.equal(style.fontWeight, '700');
} finally {
  await component.unmount();
  root.remove();
  cleanup();
}
console.log('CSS text bindings preserve priorities, remove old declarations and leave static styles intact.');
