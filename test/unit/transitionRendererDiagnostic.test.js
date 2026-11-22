import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/register-happy-dom.js';

import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { loadComponent } from '../../lib/core/tooling/loadComponent.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { requireStringRenderer, hasStringRenderer, installStringRenderer } from '../../lib/core/renderer/stringRenderer.js';
import { AvenxComponent } from '../../lib/core/index.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';

/**
 * Compiled pages can transition without installing the string renderer.
 * Uncompiled components must still report their missing renderer by name.
 */
console.log('Testing page transitions without the string renderer...');

const saved = hasStringRenderer() ? requireStringRenderer() : null;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-page-transition-'));
let app;

try {
  document.body.innerHTML = '<div id="app"><p>Loading</p></div>';
  installStringRenderer(null);

  app = new AvenxApp({ target: '#app' });
  for (const name of ['one', 'two']) {
    const file = path.join(root, `${name}.page.js`);
    fs.writeFileSync(file, `<div id="${name}">${name}</div>`);
    app.registerPage(name, loadComponent(file));
  }
  assert.doesNotThrow(() => app.mountPage('one', {}, { transition: 'fade' }));
  assert.ok(document.querySelector('.fade-leave-active'), 'existing content leaves');
  assert.doesNotThrow(() => app.mountPage('two', {}, { transition: 'fade' }));
  await nextTick();
  const entering = document.querySelector('#two');
  assert.ok(entering, 'the destination page renders');
  assert.ok(entering.classList.contains('fade-enter-active'), 'the enter animation starts');
  assert.strictEqual(hasStringRenderer(), false, 'transitions do not install a renderer');

  // Component call sites (#renderer, #patcher, #listManager, #deferManager)
  // all pass this.constructor.name, so the message names the component and
  // never the placeholder.
  const captured = [];
  class Plain extends AvenxComponent {
    constructor() {
      super({}, {}, {}, '<div><h1>Plain</h1></div>', {
        onErrorCaptured(error) {
          captured.push(error);
          return false;
        },
      }, {}, {}, {}, {});
    }
  }
  const plainHost = document.createElement('div');
  new Plain().mount(plainHost);
  await nextTick();

  assert.ok(captured.length > 0, 'the uncompiled component should report its render failure');
  assert.strictEqual(captured[0].code, AvenxErrorCodes.RENDERER_UNAVAILABLE, 'a component with no program should raise AVX_R34');
  assert.ok(
    String(captured[0].message).includes('Plain'),
    `the component message should name the component, got: ${captured[0].message}`,
  );
  assert.ok(
    !String(captured[0].message).includes('<a component>'),
    `the component message should not use the placeholder, got: ${captured[0].message}`,
  );
  console.log('  ✅ a component raises AVX_R34 naming the component');

  console.log('✅ All transition diagnostic tests passed!');
} finally {
  for (const component of app?.activeComponents || []) component.unmount();
  installStringRenderer(saved);
  document.body.innerHTML = '';
  fs.rmSync(root, { recursive: true, force: true });
}
