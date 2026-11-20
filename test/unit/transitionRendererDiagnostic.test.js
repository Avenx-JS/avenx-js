import assert from 'assert';

import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { requireStringRenderer, hasStringRenderer, installStringRenderer } from '../../lib/core/renderer/stringRenderer.js';
import { AvenxComponent } from '../../lib/core/index.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

/**
 * AVX_R34 raised by a page transition must name the operation, not the
 * placeholder `<a component>` -- a transition runs on a page wrapper, with no
 * component of its own to name.
 */
console.log('🧪 Testing AVX_R34 names the operation for a page transition...');

class PageTwo extends AvenxPage {
  render() {
    return '<div>Two</div>';
  }
}

const saved = hasStringRenderer() ? requireStringRenderer() : null;

try {
  setupDOMMock();
  installStringRenderer(null);

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Two', PageTwo);

  let thrown = null;
  try {
    app.mountPage('Two', {}, { transition: 'fade' });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'mounting a page with a transition should raise when the string renderer is absent');
  assert.strictEqual(
    thrown.code,
    AvenxErrorCodes.RENDERER_UNAVAILABLE,
    'the transition should raise AVX_R34',
  );
  assert.ok(
    !String(thrown.message).includes('<a component>'),
    `the message should not use the placeholder, got: ${thrown.message}`,
  );
  assert.ok(
    String(thrown.message).includes('page transition'),
    `the message should name the page transition, got: ${thrown.message}`,
  );
  console.log('  ✅ a page transition raises AVX_R34 naming the operation');

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
  installStringRenderer(saved);
  teardownDOMMock();
}
