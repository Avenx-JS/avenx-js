/**
 * A guard given as a name string, and what the router does with it.
 *
 * `guards: ['AuthGuard']` used to be silently ignored: #runGuards fell through
 * to `canActivateResult = true` for any guard that was not a function or an
 * object with canActivate, so a route that looked guarded was open, while
 * `avenx atlas` still reported it as guarded. A string guard now resolves
 * through the application's guard registry, which the compiler fills from the
 * guard files a route names; a name nothing registered denies the navigation
 * with a diagnostic, never a silent pass.
 */
import assert from 'assert';
import { AvenxGuard } from '../../lib/core/runtime/AvenxGuard.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

class PageHome extends AvenxPage {
  render() {
    return '<div>Home Page</div>';
  }
}

class PageSecret extends AvenxPage {
  render() {
    return '<div>Secret Page</div>';
  }
}

class PageLogin extends AvenxPage {
  render() {
    return '<div>Login Page</div>';
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

/**
 * Waits for a navigation to settle.
 * @returns {Promise<void>} Resolves once pending navigation work has run.
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Captures logger output at `level` while `fn` runs, then restores the
 * previous transports.
 * @param {string} level - The log level to capture.
 * @param {Function} fn - The work to run while capturing.
 * @returns {Promise<string[]>} The captured messages.
 */
async function captureLog(level, fn) {
  const seen = [];
  const previous = logger.config.transports;
  logger.configure({
    transports: [
      (seenLevel, formatted) => {
        if (seenLevel === level) {
          seen.push(Array.isArray(formatted) ? formatted.join(' ') : String(formatted));
        }
      },
    ],
  });
  try {
    await fn();
  } finally {
    logger.configure({ transports: previous });
  }
  return seen;
}

async function testStringGuardAdmits() {
  console.log('🧪 Testing a registered string guard admits navigation...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  class AuthGuard extends AvenxGuard {
    /**
     * @returns {boolean} The decision.
     */
    canActivate() {
      return true;
    }
  }

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Secret', PageSecret);
  app.registerGuard('AuthGuard', AuthGuard);

  const router = app.initRouter({
    '#/home': 'Home',
    '#/secret': { page: 'Secret', guards: ['AuthGuard'] },
  });

  await settle();

  window.location.hash = '#/secret';
  await settle();

  assert.strictEqual(router.currentRoute.page, 'Secret', 'a registered string guard that admits must let the navigation through');

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ A registered string guard admits navigation.');
}

async function testStringGuardDenies() {
  console.log('🧪 Testing a registered string guard denies navigation...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  class AuthGuard extends AvenxGuard {
    /**
     * @returns {boolean} The decision.
     */
    canActivate() {
      return false;
    }
  }

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Secret', PageSecret);
  app.registerGuard('AuthGuard', AuthGuard);

  const router = app.initRouter({
    '#/home': 'Home',
    '#/secret': { page: 'Secret', guards: ['AuthGuard'] },
  });

  await settle();

  window.location.hash = '#/secret';
  await settle();

  assert.strictEqual(router.currentRoute.page, 'Home', 'a string guard that denies must keep the visitor on the entry route');

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ A registered string guard denies navigation.');
}

async function testStringGuardRedirects() {
  console.log('🧪 Testing a registered string guard redirects...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  class AuthGuard extends AvenxGuard {
    /**
     * @returns {boolean|string} The decision.
     */
    canActivate() {
      return '#/login';
    }
  }

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Secret', PageSecret);
  app.registerPage('Login', PageLogin);
  app.registerGuard('AuthGuard', AuthGuard);

  const router = app.initRouter({
    '#/home': 'Home',
    '#/login': 'Login',
    '#/secret': { page: 'Secret', guards: ['AuthGuard'] },
  });

  await settle();

  window.location.hash = '#/secret';
  await settle();

  assert.strictEqual(window.location.hash, '#/login', 'a string guard redirect must move the visitor to the login route');
  assert.strictEqual(router.currentRoute.page, 'Login');

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ A registered string guard redirects.');
}

async function testUnregisteredStringGuardDenies() {
  console.log('🧪 Testing an unregistered string guard denies with a diagnostic...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Secret', PageSecret);

  const router = app.initRouter({
    '#/home': 'Home',
    '#/secret': { page: 'Secret', guards: ['AuthGuard'] },
  });

  await settle();

  // Before the fix this navigation sailed through: the string guard fell
  // through to `canActivateResult = true` and the secret page mounted.
  const errors = await captureLog('error', async () => {
    window.location.hash = '#/secret';
    await settle();
  });

  assert.strictEqual(router.currentRoute.page, 'Home', 'an unregistered string guard must deny the navigation, never silently pass it');
  assert.ok(
    errors.some((message) => message.includes('AuthGuard') && message.includes('not registered')),
    `the denial must name the guard: ${JSON.stringify(errors)}`,
  );

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ An unregistered string guard denies with a diagnostic.');
}

async function testStringFunctionGuard() {
  console.log('🧪 Testing a string guard registered as a plain function...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  let ran = false;
  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Secret', PageSecret);
  app.registerGuard('CheckGuard', () => {
    ran = true;
    return true;
  });

  const router = app.initRouter({
    '#/home': 'Home',
    '#/secret': { page: 'Secret', guards: ['CheckGuard'] },
  });

  await settle();

  window.location.hash = '#/secret';
  await settle();

  assert.ok(ran, 'the registered function guard must run');
  assert.strictEqual(router.currentRoute.page, 'Secret');

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ A string guard registered as a plain function runs.');
}

async function testClassGuardUnchanged() {
  console.log('🧪 Testing the class-reference guard form still works...');
  setupDOMMock();
  setupWindowMock();

  window.location.hash = '#/home';

  class AuthGuard extends AvenxGuard {
    /**
     * @returns {boolean} The decision.
     */
    canActivate() {
      return false;
    }
  }

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Home', PageHome);
  app.registerPage('Secret', PageSecret);

  const router = app.initRouter({
    '#/home': 'Home',
    '#/secret': { page: 'Secret', guards: [AuthGuard] },
  });

  await settle();

  window.location.hash = '#/secret';
  await settle();

  assert.strictEqual(router.currentRoute.page, 'Home', 'a class guard that denies must still deny');

  router.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ The class-reference guard form still works.');
}

async function testRegisterGuardValidation() {
  console.log('🧪 Testing registerGuard validation...');
  setupDOMMock();
  setupWindowMock();

  class AuthGuard extends AvenxGuard {}
  class OtherGuard extends AvenxGuard {}

  const app = new AvenxApp({ target: 'div' });

  assert.throws(
    () => app.registerGuard('', AuthGuard),
    /non-empty string/,
    'an empty guard name must throw',
  );
  assert.throws(
    () => app.registerGuard('AuthGuard', 'not-a-guard'),
    /must be a class/,
    'a non-function guard must throw',
  );

  app.registerGuard('AuthGuard', AuthGuard);
  assert.doesNotThrow(
    () => app.registerGuard('AuthGuard', AuthGuard),
    're-registering the identical guard must not throw',
  );

  const warnings = await captureLog('warn', async () => {
    app.registerGuard('AuthGuard', OtherGuard);
  });
  assert.ok(
    warnings.some((message) => message.includes('AuthGuard') && message.includes('already registered')),
    `registering a different guard under the same name must warn: ${JSON.stringify(warnings)}`,
  );

  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ registerGuard validation works.');
}

await testStringGuardAdmits();
await testStringGuardDenies();
await testStringGuardRedirects();
await testUnregisteredStringGuardDenies();
await testStringFunctionGuard();
await testClassGuardUnchanged();
await testRegisterGuardValidation();

console.log('🎉 All string guard tests passed!');
