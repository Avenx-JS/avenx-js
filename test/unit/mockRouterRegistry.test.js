import assert from 'assert';
import { AvenxMock } from '../../lib/core/runtime/AvenxMock.js';

// Regression test for #1780: createMockRouter must not replace the
// window.__avenx_routers Set with an array.
console.log('Running mockRouterRegistry tests...');

const previousWindow = global.window;
global.window = {};

try {
  // A real router registered before the mock must survive the helper.
  const realRouter = { name: 'real' };
  window.__avenx_routers = new Set([realRouter]);

  const mockRouter = AvenxMock.createMockRouter({ hash: '#/mock' });

  assert.ok(
    window.__avenx_routers instanceof Set,
    'window.__avenx_routers must be a Set after createMockRouter()'
  );
  assert.ok(window.__avenx_routers.has(realRouter), 'existing router must stay registered');
  assert.ok(window.__avenx_routers.has(mockRouter), 'mock router must be added to the registry');

  // A real router must still be able to register and unregister itself.
  const laterRouter = { name: 'later' };
  window.__avenx_routers.add(laterRouter);
  assert.ok(window.__avenx_routers.has(laterRouter));
  window.__avenx_routers.delete(laterRouter);
  assert.strictEqual(window.__avenx_routers.has(laterRouter), false);

  // The mock can remove itself without touching other routers.
  mockRouter.$destroy();
  assert.strictEqual(window.__avenx_routers.has(mockRouter), false);
  assert.ok(window.__avenx_routers.has(realRouter));

  // Registry is created when absent.
  delete window.__avenx_routers;
  const fresh = AvenxMock.createMockRouter({ hash: '#/fresh' });
  assert.ok(window.__avenx_routers instanceof Set, 'registry must be created as a Set when absent');
  assert.ok(window.__avenx_routers.has(fresh));
  fresh.$destroy();
} finally {
  global.window = previousWindow;
}

console.log('mockRouterRegistry tests passed.');
