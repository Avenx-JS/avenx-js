import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxError, AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

const mountTarget = document.createElement('div');
mountTarget.id = 'app';
document.body.appendChild(mountTarget);

/**
 * Creates an app bound to the test mount target.
 * @returns {AvenxApp}
 */
const createApp = () => new AvenxApp({ target: '#app' });

/**
 * Regression coverage for app.use() retrying a failed plugin. The functional
 * branch called `plugin(this, options)` inside a try and, on any throw, called
 * `plugin()` again with the original error discarded. A plugin that failed part
 * way through re-ran every side effect it had already performed, and the real
 * error never reached the developer.
 */

/**
 * A plugin must be invoked exactly once, even when it throws.
 */
function testFailingPluginIsNotRetried() {
  console.log('🧪 Testing a failing plugin is invoked only once...');

  const app = createApp();
  let calls = 0;
  const registrations = [];

  const brokenPlugin = (instance) => {
    calls++;
    // A side effect performed before the failure.
    registrations.push('directive');
    instance.directive('demo', {});
    throw new Error('plugin blew up');
  };

  assert.throws(
    () => app.use(brokenPlugin),
    /plugin blew up/,
    'the original plugin error should reach the caller',
  );
  assert.strictEqual(calls, 1, `plugin should be invoked once, was invoked ${calls} times`);
  assert.strictEqual(registrations.length, 1, 'side effects must not be replayed');

  console.log('  ✅ Failing plugin invoked once and its error surfaced.');
}

/**
 * The diagnostic keeps the plugin identity and original error as its cause.
 */
function testOriginalErrorIsPreserved() {
  console.log('🧪 Testing the original error is preserved...');

  const app = createApp();
  const original = new TypeError('missing configuration');

  const brokenPlugin = {
    name: 'BrokenPlugin',
    install() {
      throw original;
    },
  };

  let caught = null;
  try {
    app.use(brokenPlugin);
  } catch (err) {
    caught = err;
  }

  assert.ok(caught instanceof AvenxError, 'a failed plugin should raise an Avenx diagnostic');
  assert.strictEqual(caught.code, AvenxErrorCodes.PLUGIN_INSTALL_FAILED);
  assert.strictEqual(caught.cause, original, 'the original error should be preserved as cause');
  assert.match(caught.message, /BrokenPlugin.*missing configuration/);

  console.log('  ✅ Original error instance preserved.');
}

/**
 * Working plugins must be unaffected in every supported shape.
 */
async function testWorkingPluginsStillInstall() {
  console.log('🧪 Testing working plugins still install normally...');

  const app = createApp();

  let functionalCalls = 0;
  let functionalOptions = null;
  const functional = (instance, options) => {
    functionalCalls++;
    functionalOptions = options;
    assert.strictEqual(instance, app, 'the app instance should be passed through');
  };
  assert.strictEqual(app.use(functional, { a: 1 }), app, 'use() should return the app');
  assert.strictEqual(functionalCalls, 1);
  assert.deepStrictEqual(functionalOptions, { a: 1 });

  let installCalls = 0;
  const objectPlugin = {
    /**
     * @param {AvenxApp} instance - The app instance.
     */
    install(instance) {
      installCalls++;
      assert.strictEqual(instance, app);
    },
  };
  app.use(objectPlugin);
  assert.strictEqual(installCalls, 1);

  // A zero-argument plugin factory is still supported.
  let zeroArgCalls = 0;
  const zeroArg = () => {
    zeroArgCalls++;
  };
  app.use(zeroArg);
  assert.strictEqual(zeroArgCalls, 1, 'zero-argument plugins should still install');

  // Async loader plugins still resolve.
  let asyncCalls = 0;
  const asyncLoader = async () => ({ default: () => { asyncCalls++; } });
  await app.use(asyncLoader);
  assert.strictEqual(asyncCalls, 1, 'async loader plugins should still install');

  console.log('  ✅ All supported plugin shapes still install.');
}

async function testAsyncFailureNamesPluginAndPreservesCause() {
  const original = new Error('async install failed');
  const plugin = { name: 'AsyncPlugin', install: async () => { throw original; } };
  await assert.rejects(createApp().use(plugin), (error) => {
    assert.strictEqual(error.code, AvenxErrorCodes.PLUGIN_INSTALL_FAILED);
    assert.strictEqual(error.cause, original);
    return /AsyncPlugin/.test(error.message);
  });
}

/**
 * Duplicate installation must still be prevented and must not re-run the plugin.
 */
function testDuplicateInstallStillPrevented() {
  console.log('🧪 Testing duplicate installation is still prevented...');

  const app = createApp();
  let calls = 0;
  const plugin = () => {
    calls++;
  };

  app.use(plugin);
  app.use(plugin);
  assert.strictEqual(calls, 1, 'a plugin should not install twice');

  console.log('  ✅ Duplicate installation still prevented.');
}

(async () => {
  try {
    testFailingPluginIsNotRetried();
    testOriginalErrorIsPreserved();
    await testWorkingPluginsStillInstall();
    await testAsyncFailureNamesPluginAndPreservesCause();
    testDuplicateInstallStillPrevented();
    console.log('🎉 All plugin installation error tests passed successfully!');
  } catch (err) {
    console.error('❌ Plugin installation error test failed:', err);
    process.exit(1);
  }
})();
