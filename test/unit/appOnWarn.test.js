import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

setupDOMMock();
const container = new MockDOMElement('div');
global.document.querySelector = () => container;

try {
  const missingComponent = new MockDOMElement('ghost');
  missingComponent.setAttribute('data-avenx-comp', 'Ghost');
  container.appendChild(missingComponent);
  const received = [];
  const app = new AvenxApp({ target: '#app' });
  app.onWarn((msg, origin, code) => received.push({ msg, origin, code }));
  app.onWarn((msg, origin, code) => received.push({ msg, origin, code }));
  const page = new AvenxPage({}, {}, {}, '', {}, new Map());
  page.runUpdate = () => {};
  page.__setMountTarget(container);
  page.componentName = 'Home';

  page.update();

  assert.strictEqual(received.length, 2, 'all onWarn handlers should receive runtime warnings');
  assert.match(received[0].msg, /\[AVX_W13\] Component 'Ghost' not found in registry\./);
  assert.strictEqual(received[0].origin, page);
  assert.strictEqual(received[0].code, 'AVX_W13');
  assert.deepStrictEqual(received[1], received[0]);
} finally {
  teardownDOMMock();
}
