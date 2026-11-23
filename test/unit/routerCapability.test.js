// @avenx-no-dev-runtime
import assert from 'node:assert/strict';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxError, AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { requireRouter } from '../../lib/core/runtime/routerCapability.js';
import { assertRuntimeCapabilities } from '../../lib/compiler/bundle/validate.js';

const missing = (error) =>
  error instanceof AvenxError &&
  error.code === AvenxErrorCodes.ROUTER_UNAVAILABLE &&
  error.message.includes('avenx-core/runtime/router');
assert.throws(() => requireRouter(), missing);
const app = Object.create(AvenxApp.prototype);
app.router = {
  destroy() {
    throw new Error('must not destroy a router before checking installation');
  },
};
assert.throws(() => app.initRouter({}), missing);
assert.throws(() => new AvenxComponent().$router, missing);
assert.throws(() => new AvenxComponent().$route, missing);

await import('avenx-core/runtime/router');
assert.equal(typeof requireRouter(), 'function');
assert.equal(new AvenxComponent().$router, null, 'installed but not initialized retains the existing null result');

const outputs = (source) => new Map([['bundle.js', source]]);
const absent = (source) =>
  assert.throws(
    () => assertRuntimeCapabilities(outputs(source), []),
    (error) => error.code === AvenxErrorCodes.COMPILER_MISSING_RUNTIME_CAPABILITY && /router/.test(error.message),
  );
absent('app.initRouter({});');
absent('app["initRouter"]?.({});');
absent('function installRouter(capability) {} app.initRouter({});');
absent('const text = "installRouter({AvenxRouter})"; app.initRouter({});');
assertRuntimeCapabilities(outputs('const text = "app.initRouter({})"; // app.initRouter({})'), []);
assertRuntimeCapabilities(outputs('installRouter({AvenxRouter}); app.initRouter({});'), []);
assertRuntimeCapabilities(outputs('class App { initRouter(routes) {} }'), []);
console.log('Router capability diagnostics and emitted-call validation passed.');
