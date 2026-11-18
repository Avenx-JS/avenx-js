import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

class PageLogin extends AvenxPage {
  render() {
    return '<div>Login Page</div>';
  }
}

class PageSecret extends AvenxPage {
  render() {
    return '<div>Secret Page</div>';
  }
}

let hashListeners = [];
function setupWindowMock(initialHash) {
  hashListeners = [];
  global.window = {
    addEventListener: (event, cb) => {
      if (event === 'hashchange') hashListeners.push(cb);
    },
    removeEventListener: (event, cb) => {
      if (event === 'hashchange') hashListeners = hashListeners.filter((l) => l !== cb);
    },
    location: {
      _hash: initialHash,
      get hash() {
        return this._hash;
      },
      set hash(val) {
        this._hash = val;
        hashListeners.forEach((listener) => listener());
      },
    },
  };
}

// A global beforeEach registered the way the documentation shows (on the
// return value of initRouter) must also guard the entry route, so a direct
// deep link to a protected page is redirected.
async function testGlobalBeforeEachGuardsDeepLink() {
  console.log('🧪 Testing global beforeEach guards a direct deep link...');
  setupDOMMock();
  setupWindowMock('#/secret');

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Login', PageLogin);
  app.registerPage('Secret', PageSecret);

  const router = app.initRouter({
    '#/login': 'Login',
    '#/secret': 'Secret',
  });

  router.beforeEach((to) => {
    if (to.hash.startsWith('#/secret')) {
      return '#/login';
    }
    return true;
  });

  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(router.currentRoute.page, 'Login', 'Deep link to protected route must be redirected by beforeEach');
  assert.strictEqual(window.location.hash, '#/login');

  router.destroy();
  teardownDOMMock();
  delete global.window;
  console.log('  ✅ Entry-route beforeEach test passed!');
}

// destroy() called synchronously after initRouter() must stop the queued entry
// route from rendering or redirecting on the destroyed router.
async function testDestroyBeforeEntryRouteSkipsNavigation() {
  console.log('🧪 Testing destroy before the entry route is skipped...');
  setupDOMMock();
  setupWindowMock('#/secret');

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Login', PageLogin);
  app.registerPage('Secret', PageSecret);

  const router = app.initRouter({
    '#/login': 'Login',
    '#/secret': 'Secret',
  });
  router.destroy();

  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(router.currentRoute, null, 'Destroyed router must not handle the entry route');
  assert.strictEqual(window.location.hash, '#/secret', 'Destroyed router must not redirect');

  teardownDOMMock();
  delete global.window;
  console.log('  ✅ Destroy-before-entry test passed!');
}

(async () => {
  try {
    await testGlobalBeforeEachGuardsDeepLink();
    await testDestroyBeforeEntryRouteSkipsNavigation();
    console.log('🎉 Entry-route beforeEach test passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Entry-route beforeEach test failed!');
    console.error(error);
    process.exit(1);
  }
})();
