import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { TemplateRenderer } from '../../lib/core/renderer/renderTemplate.js';
import { DomPatcher } from '../../lib/core/renderer/domPatch.js';

const renderer = new TemplateRenderer();
const patcher = new DomPatcher();
const target = document.createElement('div');
document.body.appendChild(target);
let styles = { color: 'red', fontWeight: '700', '--tone': 'warm' };
let text = 'initial';
const resolve = (expression) => {
  switch (expression.trim()) {
    case 'styles':
      return styles;
    case 'text':
      return text;
    case 'label':
      return 'example';
    default:
      throw new Error(`Unexpected expression: ${expression}`);
  }
};
const template =
  '<p style="padding-left: 4px; color: green" data-ax-style="{{ styles }}">{{ text }}</p>';
const render = (source = template) => patcher.patch(target, renderer.render(source, resolve), resolve);

try {
  render();
  const paragraph = target.firstElementChild;
  assert.equal(paragraph.style.color, 'red', 'an object style applies on the first fallback render');
  assert.equal(paragraph.style.fontWeight, '700');
  assert.equal(paragraph.style.getPropertyValue('--tone'), 'warm');
  assert.equal(paragraph.style.paddingLeft, '4px', 'authored styles survive the binding');

  text = 'unrelated update';
  render();
  assert.ok(target.firstElementChild === paragraph, 'patching retains the live element');
  assert.equal(paragraph.textContent, text);
  assert.equal(paragraph.style.color, 'red', 'an unchanged style survives an unrelated patch');
  assert.equal(paragraph.style.fontWeight, '700');

  styles = { backgroundColor: 'blue', color: null };
  render();
  assert.equal(paragraph.style.backgroundColor, 'blue');
  assert.equal(paragraph.style.color, 'green', 'removing a dynamic override restores the authored style');
  assert.equal(paragraph.style.fontWeight, '');
  assert.equal(paragraph.style.getPropertyValue('--tone'), '');
  assert.equal(paragraph.style.paddingLeft, '4px');

  styles = 'color: purple; --tone: next;';
  render();
  assert.equal(paragraph.style.color, 'purple', 'CSS text works as well as an object');
  assert.equal(paragraph.style.getPropertyValue('--tone'), 'next');
  assert.equal(paragraph.style.backgroundColor, '');
  styles = null;
  render();
  assert.equal(paragraph.style.color, 'green');
  assert.equal(paragraph.style.getPropertyValue('--tone'), '');

  styles = { color: 'blue' };
  for (const attribute of ['data-ax-style="styles"', 'data-ax-style={{ styles }}']) {
    render(`<p ${attribute}>bare or unquoted</p>`);
    assert.equal(target.firstElementChild.style.color, 'blue');
    render(`<p ${attribute}>unrelated text</p>`);
    assert.equal(target.firstElementChild.style.color, 'blue');
  }
  render('<p title=\'data-ax-style="{{ label }}"\' data-ax-style="{{ styles }}">nested attribute text</p>');
  assert.equal(target.firstElementChild.title, 'data-ax-style="example"');
  assert.equal(target.firstElementChild.style.color, 'blue');

  render('<p style="color: green">binding removed</p>');
  assert.equal(target.firstElementChild.style.color, 'green');
  console.log('Fallback style bindings apply objects and CSS text, survive patches, and preserve authored styles.');
} finally {
  target.remove();
}
