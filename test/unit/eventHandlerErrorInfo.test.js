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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/register-happy-dom.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { EXPRESSION_OPS } from '../../lib/core/expression/ops.js';
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

/**
 * Compiles component source the way `avenx build` does for production and
 * returns the class, evaluated the same way loadComponent evaluates a
 * development build.
 * @param {string} source - Component source in Avenx authoring format.
 * @param {string} name - The class name.
 * @returns {Function} The compiled class.
 */
function compileForProduction(source, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-r09-'));
  try {
    const file = path.join(dir, `${name}.component.js`);
    fs.writeFileSync(file, source);
    const parser = new ComponentParser(new StyleProcessor({}, {}), [], null);
    parser.production = true;
    const generated = parser.parse(file, 'component');
    const opNames = Object.keys(EXPRESSION_OPS);
    const factory = new Function('AvenxComponent', 'AvenxPage', ...opNames, `${generated}\nreturn ${name};`);
    return factory(AvenxComponent, AvenxPage, ...opNames.map((op) => EXPRESSION_OPS[op]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a production build names the failing action in AVX_R09, not its handler index (#2041)', async (t) => {
  const { errors } = captureLogs(t);
  const Prod = compileForProduction(
    [
      '<state a="1" obj="null" />',
      '<action name="plainBoom">',
      '    this.state.a = 2;',
      "    throw new Error('plain boom');",
      '</action>',
      '<action name="namedHelper">',
      '    this.plainBoom();',
      '</action>',
      '<div>',
      '  <button id="b1" @click="plainBoom()">plain</button>',
      '  <button id="b2" @click="namedHelper()">nested</button>',
      '  <button id="b3" @click="obj.go()">inline</button>',
      '</div>',
    ].join('\n'),
    'Prod',
  );
  assert.strictEqual(Prod.__axProgramStmtSrc, undefined, 'a production build ships no statement sources');

  document.body.innerHTML = '<div id="app"></div>';
  const handlerCalls = [];
  const app = new AvenxApp({ target: '#app' });
  app.onError((error, instance, origin) => handlerCalls.push({ error, instance, origin }));
  app.register('Prod', Prod);
  app.mount('Prod');
  const instance = document.querySelector('#app').__avenx_comp_instance;
  t.after(() => instance.unmount());
  assert.strictEqual(instance.$compiled, true, 'the component should run its compiled program');

  await dispatchClick(document.querySelector('#b1'));
  await dispatchClick(document.querySelector('#b2'));
  await dispatchClick(document.querySelector('#b3'));

  const r09 = errors.filter((line) => line.includes('AVX_R09'));
  assert.strictEqual(r09.length, 3, `expected three AVX_R09 errors, got: ${JSON.stringify(errors)}`);
  assert.ok(r09[0].includes('"plainBoom"'), `AVX_R09 should name plainBoom, got: ${r09[0]}`);
  assert.ok(r09[1].includes('"namedHelper"'), `AVX_R09 should name namedHelper, got: ${r09[1]}`);
  assert.ok(!r09[0].includes('handler #') && !r09[1].includes('handler #'), 'an action call is not named by index');
  // A statement that is not an action call still identifies its handler.
  assert.ok(r09[2].includes('handler #2'), `a non-action statement keeps its index, got: ${r09[2]}`);

  assert.deepStrictEqual(
    handlerCalls.map((call) => call.origin),
    ['eventHandler:plainBoom', 'eventHandler:namedHelper', 'eventHandler'],
    'info should name the action in production as it does in development',
  );
});
