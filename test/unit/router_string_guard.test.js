/**
 * @file router_string_guard.test.js
 * @description A guard given as a name string must never silently pass: there
 * is no registry that resolves it, so the router denies the navigation and
 * logs an error instead of treating the route as guarded.
 */

import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

class PageHome extends AvenxPage {
  render() {
    return '<div>Home Page</div>';
  }
}

class PageDashboard extends AvenxPage {
  render() {
    return '<div>Dashboard Page</div>';
  }
}

let hashListeners = [];
function setupWindowMock() {
  hashListeners = [];
  global.window = {
    addEventListener: (event, cb) => {
      if (event === 'hashchange') hashListeners.push(cb);
    },
    removeEventListener: (event, cb) => {
      if (event === 'hashchange') hashListeners = hashListeners.filter((l) => l !== cb);
    },
    location: {
      _hash: '',
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

function teardownWindowMock() {
  delete global.window;
}

async function testStringGuardDeniesNavigation() {
  console.log('🧪 Testing a string guard denies navigation...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Dashboard', PageDashboard);

  const router = app.initRouter({
    '#/home': 'Home',
    '#/dashboard': {
      page: 'Dashboard',
      guards: ['AuthGuard'],
    },
  });

  await new Promise((r) => setTimeout(r, 0));

  const errors = [];
  const originalError = logger.error;
  logger.error = (message) => errors.push(String(message));
  try {
    window.location.hash = '#/dashboard';
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    logger.error = originalError;
  }

  assert.strictEqual(
    router.currentRoute.page,
    'Home',
    'a string guard must not let the navigation through',
  );
  assert.ok(
    errors.some((message) => message.includes('AuthGuard') && message.includes('string')),
    `expected an error naming the string guard, got:\n${errors.join('\n')}`,
  );

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ string guard test passed!');
}

(async () => {
  try {
    await testStringGuardDeniesNavigation();
    console.log('✅ String guard tests passed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ String guard test failed!');
    console.error(error);
    process.exit(1);
  }
})();
