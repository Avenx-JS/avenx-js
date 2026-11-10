/**
 * @file asyncActionErrorReporting.test.js
 * @description An action that fails asynchronously must be reported, not lost.
 *
 * Issue #1699: when an action returns a promise that rejects, there is no
 * AVX_R09 diagnostic, no logger entry, and the app's errorHandler is never
 * called -- the rejection escapes as an unhandled promise rejection. A
 * synchronous throw in the same action IS reported correctly. The same hole
 * exists for lifecycle hooks (onMount), and a rejecting `atomic` action
 * rewinds its writes silently, with no report of the rollback.
 *
 * These tests mount real components under an AvenxApp (so errorHandler is
 * reachable) and assert, for each dispatch path, that a rejection reaches
 * the logger and the app error handler, that the returned promise still
 * rejects for an awaiter, and that no unhandled rejection escapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { EventExecutor } from '../../lib/core/events/eventExecutor.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { flushPromises } from '../../lib/core/testing.js';

// A rejected promise the framework discards would crash the process under
// Node's default unhandledRejection mode. Recording them here keeps the
// process alive AND turns the escape itself into an assertion: after the
// fix, no rejection from a dispatched action may surface here.
const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason);
});

/**
 * Dispatches one click on an element and flushes microtasks.
 *
 * A raw dispatch, not AvenxMock.fireEvent: in this happy-dom setup
 * `fireEvent` invokes the handler twice for one click (its trigger dispatches
 * the event AND walks the listener maps by hand, because the global `Element`
 * is undefined here so the real-DOM branch is never taken). A raw dispatch
 * invokes it exactly once, which is what the "exactly once" assertions need.
 * @param {Element} element - The element to click.
 * @returns {Promise<void>}
 */
async function dispatchClick(element) {
  element.dispatchEvent(new CustomEvent('click', { bubbles: true, cancelable: true }));
  await flushPromises();
}

/**
 * Captures logger.error / logger.info output for one test.
 * @param {object} t - The node:test context.
 * @returns {{errors: string[], infos: string[]}} Captured log lines.
 */
function captureLogs(t) {
  const errors = [];
  const infos = [];
  const originalError = logger.error;
  const originalInfo = logger.info;
  logger.error = (...args) => errors.push(args.map(String).join(' '));
  logger.info = (...args) => infos.push(args.map(String).join(' '));
  t.after(() => {
    logger.error = originalError;
    logger.info = originalInfo;
  });
  return { errors, infos };
}

/**
 * Mounts a component class as the root of a fresh app.
 * @param {Function} ComponentClass - The component to mount.
 * @param {string} name - The registered name.
 * @returns {{app: object, handlerCalls: object[], instance: object}} The app,
 *   the errorHandler calls, and the mounted instance.
 */
function mountUnderApp(ComponentClass, name) {
  document.body.innerHTML = '<div id="app"></div>';
  const handlerCalls = [];
  const app = new AvenxApp({ target: '#app' });
  app.onError((error, instance, origin) => handlerCalls.push({ error, instance, origin }));
  app.register(name, ComponentClass);
  app.mount(name);
  const instance = document.querySelector('#app').__avenx_comp_instance;
  return { app, handlerCalls, instance };
}

test('an async event-handler failure is reported like a sync throw', async (t) => {
  const { errors } = captureLogs(t);
  unhandled.length = 0;

  class AsyncActionPage extends AvenxComponent {
    constructor(bridges, props) {
      super(
        { clicks: 0 },
        {},
        bridges,
        '<button id="async" @click="plain()">async</button><button id="sync" @click="syncThrow()">sync</button>',
        {
          plain: 'return Promise.reject(new Error("plain async failed"))',
          syncThrow: 'throw new Error("sync failed")',
        },
        props,
      );
    }
  }

  const { handlerCalls, instance } = mountUnderApp(AsyncActionPage, 'AsyncActionPage');
  t.after(() => instance.unmount());

  // Control: the synchronous throw is already reported correctly.
  await dispatchClick(document.querySelector('#sync'));
  await flushPromises();
  assert.ok(
    errors.some((line) => line.includes('AVX_R09') && line.includes('sync failed')),
    `sync throw should log AVX_R09, got: ${JSON.stringify(errors)}`,
  );
  assert.strictEqual(handlerCalls.length, 1, 'sync throw should reach errorHandler once');
  assert.strictEqual(handlerCalls[0].error.message, 'sync failed');

  errors.length = 0;
  handlerCalls.length = 0;
  unhandled.length = 0;

  // The bug: the async rejection reaches nobody.
  await dispatchClick(document.querySelector('#async'));
  await flushPromises();
  assert.ok(
    errors.some((line) => line.includes('AVX_R09') && line.includes('plain async failed')),
    `async rejection should log AVX_R09, got: ${JSON.stringify(errors)}`,
  );
  assert.strictEqual(handlerCalls.length, 1, 'async rejection should reach errorHandler once');
  assert.strictEqual(handlerCalls[0].error.message, 'plain async failed');
  assert.strictEqual(handlerCalls[0].instance, instance);
  // The origin is the handler source, exactly as the sync throw reports it.
  assert.strictEqual(handlerCalls[0].origin, 'plain()');
  assert.deepEqual(
    unhandled.map((err) => err && err.message),
    [],
    'the reported rejection must not escape as an unhandled rejection',
  );
});

test('an async lifecycle-hook failure is reported like a sync throw', async (t) => {
  const { errors } = captureLogs(t);
  unhandled.length = 0;

  class AsyncMountPage extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '<span>mounted</span>',
        { onMount: 'return Promise.reject(new Error("mount failed"))' },
        props,
      );
    }
  }

  const { handlerCalls, instance } = mountUnderApp(AsyncMountPage, 'AsyncMountPage');
  t.after(() => instance.unmount());
  await flushPromises();

  assert.ok(
    errors.some((line) => line.includes('AVX_R12') && line.includes('mount failed')),
    `async onMount rejection should log AVX_R12, got: ${JSON.stringify(errors)}`,
  );
  assert.strictEqual(handlerCalls.length, 1, 'async onMount rejection should reach errorHandler once');
  assert.strictEqual(handlerCalls[0].error.message, 'mount failed');
  assert.strictEqual(handlerCalls[0].instance, instance);
  assert.strictEqual(handlerCalls[0].origin, 'onMount');
  assert.deepEqual(
    unhandled.map((err) => err && err.message),
    [],
    'the reported rejection must not escape as an unhandled rejection',
  );
});

test('a rejecting atomic action reports the failure and the rollback', async (t) => {
  const { errors, infos } = captureLogs(t);
  unhandled.length = 0;

  class AtomicPage extends AvenxComponent {
    constructor(bridges, props) {
      super(
        { qty: 1, note: '' },
        {},
        bridges,
        '<button id="bump" @click="bump()">bump</button>',
        {
          bump: 'this.state.qty++; this.state.note = "changed"; return Promise.reject(new Error("server said no"))',
        },
        props,
        {}, // styles
        {}, // resources
        { atomic: { bump: {} } }, // options: the compiler's atomic declaration
      );
    }
  }

  const { handlerCalls, instance } = mountUnderApp(AtomicPage, 'AtomicPage');
  t.after(() => instance.unmount());

  await dispatchClick(document.querySelector('#bump'));
  await flushPromises();

  // The failure itself: same reporting as any other action failure.
  assert.ok(
    errors.some((line) => line.includes('AVX_R09') && line.includes('server said no')),
    `atomic rejection should log AVX_R09, got: ${JSON.stringify(errors)}`,
  );
  assert.strictEqual(handlerCalls.length, 1, 'atomic rejection should reach errorHandler once');
  assert.strictEqual(handlerCalls[0].error.message, 'server said no');

  // The rollback: the writes the action made must be undone...
  assert.strictEqual(instance.state.qty, 1, 'qty must be rewound to 1');
  assert.strictEqual(instance.state.note, '', 'note must be rewound to empty');
  // ...and the rollback itself must be reported, not silent.
  assert.ok(
    infos.some((line) => line.toLowerCase().includes('rewound') || line.toLowerCase().includes('rewind')),
    `the rollback should be logged, got: ${JSON.stringify(infos)}`,
  );
  assert.deepEqual(
    unhandled.map((err) => err && err.message),
    [],
    'the reported rejection must not escape as an unhandled rejection',
  );
});

test('the event executor does not swallow a rejecting handler', async (t) => {
  // Guard, not a repro: execute() never swallowed, and the fix must keep it
  // that way. A caller that awaits the dispatch must still see the rejection
  // after reporting has observed it.
  captureLogs(t);
  unhandled.length = 0;

  const failure = new Error('executor still rejects');
  const executor = new EventExecutor(() => Promise.reject(failure));
  const event = {
    type: 'click',
    target: {
      tagName: 'BUTTON',
      __avenx_comp_instance: { $logContext: { componentName: 'AwaitedPage' } },
    },
  };

  await assert.rejects(
    executor.execute('go()', event),
    (err) => err === failure,
    'execute() must return a promise that rejects with the same error',
  );
  await flushPromises();
  assert.deepEqual(
    unhandled.map((err) => err && err.message),
    [],
    'the awaited rejection must not surface as an unhandled rejection',
  );
});
