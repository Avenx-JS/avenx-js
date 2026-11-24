import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

for (const [provided, outlet] of [
  ['constructor', 'constructor'],
  ['toString', 'toString'],
  ['__proto__', '__proto__'],
  ['hasOwnProperty', 'hasOwnProperty'],
  ['  footer  ', 'footer'],
  ['', null],
  ['   ', null],
]) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = `<b slot="${provided}">provided</b>`;
  const slot = outlet === null ? '<slot>' : `<slot name="${outlet}">`;
  const component = new AvenxComponent({}, {}, {}, `${slot}<i>fallback</i></slot>`);
  try {
    component.mount(root);
    assert.equal(root.querySelector('slot').textContent, 'provided', `slot name ${JSON.stringify(provided)} resolves`);
    assert.equal(component.$slots.has(outlet || 'default'), true);
    const incoming = document.createElement('div');
    incoming.innerHTML = `<b slot="${provided}">updated</b>`;
    component.__updateTranscludedContent(incoming.childNodes);
    assert.equal(root.querySelector('slot').textContent, 'updated');
    component.__updateTranscludedContent([]);
    assert.equal(root.querySelector('slot').textContent, 'fallback', 'removing content restores the outlet fallback');
    assert.equal(component.$slots.has(outlet || 'default'), false);
  } finally {
    await component.unmount();
    root.remove();
  }
}

const root = document.createElement('div');
const missing = new AvenxComponent({}, {}, {}, '<slot name="constructor"><i>fallback</i></slot>');
try {
  missing.mount(root);
  assert.equal(root.textContent, 'fallback', 'an inherited object property is never projected as slot content');
  assert.equal(missing.$slots.has('constructor'), false);
} finally {
  await missing.unmount();
}
console.log('Empty, whitespace-padded and Object prototype slot names resolve without collisions.');
