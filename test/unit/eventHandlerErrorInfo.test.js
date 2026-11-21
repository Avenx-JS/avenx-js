/**
 * @file eventHandlerErrorInfo.test.js
 * @description An event handler failure must report its execution phase as
 * the `info` argument, not the handler statement.
 *
 * Issue #1788: `onErrorCaptured` and the application `errorHandler` received
 * `"handler #0"` as `info` for a failing event handler -- an internal handler
 * index in the production build, the raw statement source in a development
 * build -- instead of the documented execution-phase string. The docs promise
 * `'eventHandler'` (or `'eventHandler:<action>'`, as in
 * `app.md`'s `'eventHandler:submitForm'`), the form lifecycle hooks already
 * use (`'onMount'`, `'onUpdate'`).
 *
 * These tests mount real components under an AvenxApp and assert, for a
 * failing handler, that the parent hook and the app handler both receive the
 * phase, while the AVX_R09 diagnostic still names the statement itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { flushPromises } from '../../lib/core/testing.js';

/**
 * Dispatches one click on an element and flushes microtasks.
 *
 * A raw dispatch, not AvenxMock.fireEvent: in this happy-dom setup
 * `fireEvent` invokes the handler twice for one click (its trigger dispatches
 * the event AND walks the listener maps by hand, because the global `Element`
 * is undefined here so the real-DOM branch is never taken). A raw dispatch
 * invokes it exactly once.
 * @param {Element} element - The element to click.
 * @returns {Promise<void>}
 */
async function dispatchClick(element) {
  element.dispatchEvent(new CustomEvent('click', { bubbles: true, cancelable: true }));
  await flushPromises();
}

/**
 * Captures logger.error and logger.debug output for one test. A failure a
 * hook claims is written at debug level, not error level, so both are needed.
 * @param {object} t - The node:test context.
 * @returns {{errors: string[], debugs: string[]}} Captured log lines.
 */
function captureLogs(t) {
  const errors = [];
  const debugs = [];
  const originalError = logger.error;
  const originalDebug = logger.debug;
  logger.error = (...args) => errors.push(args.map(String).join(' '));
  logger.debug = (...args) => debugs.push(args.map(String).join(' '));
  t.after(() => {
    logger.error = originalError;
    logger.debug = originalDebug;
  });
  return { errors, debugs };
}

/**
 * Mounts a child with a throwing button action under a middle component with
 * an `onErrorCaptured` hook, under a page, in a fresh app -- the same tree
 * shape as componentErrorCapture.test.js, so the hook chain is exercised
 * exactly as the framework mounts it.
 * @param {string} handler - The handler statement on the child's button.
 * @returns {{captured: object[], handlerCalls: object[], page: object}} The
 *   hook calls, the app errorHandler calls, and the mounted page.
 */
function mountTree(handler) {
  document.body.innerHTML = '<div id="app"></div>';
  const captured = [];
  const handlerCalls = [];
  const app = new AvenxApp({ target: '#app' });
  app.onError((error, instance, origin) => handlerCalls.push({ error, instance, origin }));

  class Child extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        `<button id="boom" @click="${handler}">boom</button>`,
        {
          boom: 'throw new Error("child exploded")',
        },
        props,
      );
    }
  }

  class Middle extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '<section><div data-avenx-comp="Child"></div></section>',
        {
          onErrorCaptured(error, instance, origin) {
            captured.push({ error, instance, origin });
            return false;
          },
        },
        props,
      );
    }
  }

  class Home extends AvenxPage {
    constructor(bridges) {
      super(
        {},
        {},
        bridges,
        '<main><div data-avenx-comp="Middle"></div></main>',
        {},
        new Map([
          ['Child', Child],
          ['Middle', Middle],
        ]),
      );
    }
  }

  app.register('Child', Child);
  app.register('Middle', Middle);
  app.register('Home', Home);
  app.mount('Home');
  const page = document.querySelector('#app').__avenx_comp_instance;
  return { captured, handlerCalls, page };
}

test('a failing action reports eventHandler:<action> as info', async (t) => {
  const { debugs } = captureLogs(t);
  const { captured, handlerCalls, page } = mountTree('boom()');
  t.after(() => page.unmount());

  await dispatchClick(document.querySelector('#boom'));

  assert.strictEqual(captured.length, 1, 'parent hook should capture the failure once');
  assert.strictEqual(captured[0].error.message, 'child exploded');
  assert.strictEqual(
    captured[0].origin,
    'eventHandler:boom',
    `info should name the phase and action, got: ${JSON.stringify(captured[0].origin)}`,
  );
  // The hook stopped propagation, so the app handler must not see it.
  assert.strictEqual(handlerCalls.length, 0, 'a claimed error must not reach the app handler');
  // The diagnostic still names the statement itself (at debug level: claimed).
  assert.ok(
    debugs.some((line) => line.includes('AVX_R09') && line.includes('boom()')),
    `AVX_R09 should still name the statement, got: ${JSON.stringify(debugs)}`,
  );
});

test('a failing handler that is not a bare action call reports plain eventHandler', async (t) => {
  const { debugs } = captureLogs(t);
  const { captured, page } = mountTree('boom.call()');
  t.after(() => page.unmount());

  await dispatchClick(document.querySelector('#boom'));

  assert.strictEqual(captured.length, 1, 'parent hook should capture the failure once');
  assert.strictEqual(captured[0].error.message, 'child exploded');
  assert.strictEqual(
    captured[0].origin,
    'eventHandler',
    `info should be the plain phase, got: ${JSON.stringify(captured[0].origin)}`,
  );
  assert.ok(
    debugs.some((line) => line.includes('AVX_R09') && line.includes('boom.call()')),
    `AVX_R09 should still name the statement, got: ${JSON.stringify(debugs)}`,
  );
});

test('an unclaimed failing action reaches the app errorHandler with the phase as info', async (t) => {
  document.body.innerHTML = '<div id="app"></div>';
  const handlerCalls = [];
  const app = new AvenxApp({ target: '#app' });
  app.onError((error, instance, origin) => handlerCalls.push({ error, instance, origin }));

  class Solo extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '<button id="boom" @click="boom()">boom</button>',
        {
          boom: 'throw new Error("child exploded")',
        },
        props,
      );
    }
  }

  app.register('Solo', Solo);
  app.mount('Solo');
  const instance = document.querySelector('#app').__avenx_comp_instance;
  t.after(() => instance.unmount());

  await dispatchClick(document.querySelector('#boom'));

  assert.strictEqual(handlerCalls.length, 1, 'app handler should receive the failure once');
  assert.strictEqual(handlerCalls[0].error.message, 'child exploded');
  assert.strictEqual(
    handlerCalls[0].origin,
    'eventHandler:boom',
    `info should name the phase and action, got: ${JSON.stringify(handlerCalls[0].origin)}`,
  );
});
