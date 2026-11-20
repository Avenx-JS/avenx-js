import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

let errorsHandled = [];
const originalConsoleError = console.error;

function hookConsoleError() {
  console.error = () => {};
}

function restoreConsoleError() {
  console.error = originalConsoleError;
}

async function runTests() {
  console.log('🧪 Testing Global Error Event Handlers in AvenxApp...');

  setupDOMMock();
  hookConsoleError();

  const container = new MockDOMElement('div');
  global.document.querySelector = (sel) => {
    if (sel === '#app') return container;
    return null;
  };

  // 1. Test registration of onError and execution during lifecycle errors
  errorsHandled = [];
  const app = new AvenxApp({ target: '#app' });
  
  // Verify chaining works
  const chainResult = app.onError((err, comp, origin) => {
    errorsHandled.push({ err, comp, origin, id: 1 });
  });
  assert.strictEqual(chainResult, app, 'onError should return the app instance for chaining');

  // Register a second handler to verify multiple handlers are supported
  app.onError((err, comp, origin) => {
    errorsHandled.push({ err, comp, origin, id: 2 });
  });

  // Register a third handler that throws an error, to verify resiliency
  app.onError(() => {
    throw new Error('Robustness test: Error in error handler');
  });

  class TestComponent extends AvenxComponent {
    constructor(bridges = {}) {
      super({ val: 0 }, {}, bridges, '<button @click="doSomething()">Click me</button>', {
        onBeforeMount() {
          throw new Error('BeforeMount Fail');
        },
        onMount() {
          throw new Error('Mount Fail');
        },
        onBeforeUpdate() {
          throw new Error('BeforeUpdate Fail');
        },
        onUpdate() {
          throw new Error('Update Fail');
        },
        onUnmount() {
          throw new Error('Unmount Fail');
        },
        doSomething() {
          throw new Error('Event Fail');
        }
      });
    }
  }

  app.register('TestComponent', TestComponent);

  // Triggering hooks:
  // Mount the component
  app.mount('TestComponent');

  // Verify that onBeforeMount and onMount threw and triggered both handlers
  const beforeMountErrors = errorsHandled.filter(e => e.origin === 'onBeforeMount');
  assert.strictEqual(beforeMountErrors.length, 2);
  assert.strictEqual(beforeMountErrors[0].err.message, 'BeforeMount Fail');
  assert.strictEqual(beforeMountErrors[0].id, 1);
  assert.strictEqual(beforeMountErrors[1].id, 2);

  const mountErrors = errorsHandled.filter(e => e.origin === 'onMount');
  assert.strictEqual(mountErrors.length, 2);
  assert.strictEqual(mountErrors[0].err.message, 'Mount Fail');
  assert.strictEqual(mountErrors[0].id, 1);
  assert.strictEqual(mountErrors[1].id, 2);

  // Wait a tick so that next update is not deduplicated in the same microtask
  await new Promise(resolve => setTimeout(resolve, 10));

  // Trigger an update
  const compInstance = container.__avenx_comp_instance;
  assert.ok(compInstance, 'Component instance should be registered on target element');
  compInstance.renderWatcher.dirty = true;
  compInstance.update();

  // Verify onBeforeUpdate and onUpdate triggered handlers
  const beforeUpdateErrors = errorsHandled.filter(e => e.origin === 'onBeforeUpdate');
  assert.strictEqual(beforeUpdateErrors.length, 2);
  assert.strictEqual(beforeUpdateErrors[0].err.message, 'BeforeUpdate Fail');

  const updateErrors = errorsHandled.filter(e => e.origin === 'onUpdate');
  assert.strictEqual(updateErrors.length, 2);
  assert.strictEqual(updateErrors[0].err.message, 'Update Fail');

  // Trigger an event handler error
  const button = container.querySelectorAll('button')[0];
  assert.ok(button, 'Button should exist in container');

  const clickCall = container.recordedCalls.find(c => c.method === 'addEventListener' && c.event === 'click');
  assert.ok(clickCall, 'Should have registered a click event listener on the container');
  
  // Call the click callback
  clickCall.callback({ target: button, type: 'click' });

  // Verify event error triggered handlers with origin as the execution phase (#1788)
  const eventErrors = errorsHandled.filter(e => e.origin === 'eventHandler:doSomething');
  assert.strictEqual(eventErrors.length, 2);
  assert.strictEqual(eventErrors[0].err.message, 'Event Fail');
  assert.strictEqual(eventErrors[0].comp, compInstance);

  // Trigger unmount
  compInstance.unmount();

  // Verify onUnmount triggered handlers
  const unmountErrors = errorsHandled.filter(e => e.origin === 'onUnmount');
  assert.strictEqual(unmountErrors.length, 2);
  assert.strictEqual(unmountErrors[0].err.message, 'Unmount Fail');

  // 2. Test registration of onWarn and config.warnHandler
  const warningsHandled = [];
  const warnApp = new AvenxApp({
    target: '#app',
    warnHandler: (msg, comp, code) => {
      warningsHandled.push({ msg, comp, code, source: 'config' });
    }
  });

  const warnChainResult = warnApp.onWarn((msg, comp, code) => {
    warningsHandled.push({ msg, comp, code, source: 'onWarn' });
  });
  assert.strictEqual(warnChainResult, warnApp, 'onWarn should return the app instance for chaining');

  // Trigger a warning via logger.warn
  import('../../lib/core/runtime/AvenxLogger.js').then(({ logger }) => {
    logger.warn('[AVX_W01] Test warning message', { component: compInstance });
    assert.ok(warningsHandled.length >= 2, 'Warnings should be captured by both config and onWarn handlers');
  });

  restoreConsoleError();
  teardownDOMMock();
  console.log('  ✅ Global Error & Warning Event Handlers in AvenxApp tests passed!');
}

(async () => {
  try {
    await runTests();
    process.exit(0);
  } catch (error) {
    restoreConsoleError();
    console.error('❌ Global Error Event Handlers in AvenxApp tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
