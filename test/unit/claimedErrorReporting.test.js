/**
 * @file claimedErrorReporting.test.js
 * @description A failure claimed by an `onErrorCaptured` hook must not be
 * reported like an unhandled one.
 *
 * A handler or lifecycle-hook failure used to be written to the log at error
 * level before the hooks ran, so the console line was identical whether a
 * parent returned `false` from `onErrorCaptured` or nothing handled the error.
 * The diagnostic is now written once the error's fate is known: at error level
 * when nothing claimed it, at debug level (naming the claimant) when a hook did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

/**
 * Mounts Parent > Child where the child's click handler or onMount throws.
 * @param {object} options - Scenario options.
 * @param {boolean|undefined} options.claim - What the parent's hook returns
 *   (`false` claims the error); `null` means the parent has no hook.
 * @param {'handler'|'mount'} options.source - Where the child fails.
 * @returns {{page: AvenxPage, appErrors: Error[], hookCalls: Error[]}} The app and what it saw.
 */
function mountTree({ claim, source }) {
  document.body.innerHTML = '<div id="app"></div>';
  const hookCalls = [];
  const appErrors = [];

  class Child extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '<button id="boom" @click="boom()">boom</button>',
        {
          boom: 'throw new Error("child exploded")',
          onMount() {
            if (source === 'mount') throw new Error('child exploded');
          },
        },
        props,
      );
    }
  }

  class Parent extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '<div data-avenx-comp="Child"></div>',
        claim === null
          ? {}
          : {
            onErrorCaptured(error) {
              hookCalls.push(error);
              return claim;
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
        '<main><div data-avenx-comp="Parent"></div></main>',
        {},
        new Map([
          ['Child', Child],
          ['Parent', Parent],
        ]),
      );
    }
  }

  const app = new AvenxApp({ target: '#app' });
  app.onError((error) => appErrors.push(error));
  app.register('Child', Child);
  app.register('Parent', Parent);
  app.register('Home', Home);
  app.mount('Home');
  return { app, appErrors, hookCalls, page: document.querySelector('#app').__avenx_comp_instance };
}

/**
 * Records error and debug output of the logger for one test.
 * @param {object} t - The node:test context.
 * @returns {{errors: string[], debugs: string[]}} The recorded lines.
 */
function captureLogs(t) {
  const errors = [];
  const debugs = [];
  t.mock.method(logger, 'error', (...args) => errors.push(args.map(String).join(' ')));
  t.mock.method(logger, 'debug', (...args) => debugs.push(args.map(String).join(' ')));
  return { errors, debugs };
}

for (const [source, code] of [
  ['handler', 'AVX_R09'],
  ['mount', 'AVX_R12'],
]) {
  test(`a ${source} failure claimed by onErrorCaptured is logged below error level`, (t) => {
    const { errors, debugs } = captureLogs(t);
    const { page, appErrors, hookCalls } = mountTree({ claim: false, source });
    t.after(() => page.unmount());
    if (source === 'handler') {
      document.querySelector('#boom').dispatchEvent(new CustomEvent('click', { bubbles: true }));
    }

    assert.equal(hookCalls.length, 1, 'the parent hook runs');
    assert.deepEqual(appErrors, [], 'a claimed error does not reach the app error handler');
    assert.deepEqual(errors, [], `claimed error must not be logged at error level: ${JSON.stringify(errors)}`);
    assert.equal(debugs.length, 1, 'the claimed failure stays available at debug level');
    assert.match(debugs[0], new RegExp(code));
    assert.match(debugs[0], /child exploded/);
    assert.match(debugs[0], /handled: <Parent> claimed it in onErrorCaptured/);
  });

  test(`a ${source} failure no hook claims is still logged at error level`, (t) => {
    const { errors, debugs } = captureLogs(t);
    const { page, appErrors, hookCalls } = mountTree({ claim: undefined, source });
    t.after(() => page.unmount());
    if (source === 'handler') {
      document.querySelector('#boom').dispatchEvent(new CustomEvent('click', { bubbles: true }));
    }

    assert.equal(hookCalls.length, 1, 'the parent hook runs but does not claim');
    assert.equal(appErrors.length, 1, 'an unclaimed error reaches the app error handler');
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(code));
    assert.doesNotMatch(errors[0], /handled:/);
    assert.deepEqual(debugs, []);
  });

  test(`a ${source} failure with no onErrorCaptured hook is logged at error level`, (t) => {
    const { errors } = captureLogs(t);
    const { page, appErrors } = mountTree({ claim: null, source });
    t.after(() => page.unmount());
    if (source === 'handler') {
      document.querySelector('#boom').dispatchEvent(new CustomEvent('click', { bubbles: true }));
    }

    assert.equal(appErrors.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(code));
  });
}
