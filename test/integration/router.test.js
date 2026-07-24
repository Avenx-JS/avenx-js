import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxGuard } from '../../lib/core/runtime/AvenxGuard.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';

(async () => {
  try {
    console.log('🧪 Testing Router and Guards...');

    // Setup mock elements and global object mocks
    const mockElement = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      attributes: [],
      hasAttribute: () => false,
      setAttribute: () => {},
      removeAttribute: () => {},
      appendChild: () => {},
      removeChild: () => {},
      replaceWith: () => {},
      childNodes: [],
    };

    global.document = {
      querySelector: () => mockElement,
      querySelectorAll: () => [],
    };

    global.DOMParser = class {
      /**
       *
       */
      parseFromString() {
        return { body: mockElement };
      }
    };
    global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

    let hashListeners = [];
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

    // Create a mock page component
    let mountedPageName = null;
    let mountedParams = null;

    /**
     *
     */
    class TestPage extends AvenxPage {
      /**
       *
       * @param bridges
       * @param componentRegistry
       */
      constructor(bridges, componentRegistry) {
        super(
          {}, // initialState
          {}, // computed
          bridges,
          '<div>Test Page</div>',
          {
            onUpdate: () => {
              mountedPageName = this.constructor.name;
              mountedParams = this.params;
            },
          },
          componentRegistry,
        );
      }
      /**
       *
       * @param target
       */
      mount(target) {
        super.mount(target);
        mountedPageName = this.constructor.name;
        mountedParams = this.params;
      }
    }

    const app = new AvenxApp({ target: '#app' });
    app.registerPage('TestPage', TestPage);

    // Guard definitions
    let allowTransition = true;
    let guardCalled = false;
    let redirectTarget = null;

    /**
     *
     */
    class MockGuard extends AvenxGuard {
      /**
       *
       * @param to
       * @param from
       */
      canActivate() {
        guardCalled = true;
        if (redirectTarget) return redirectTarget;
        return allowTransition;
      }
    }

    app.initRouter({
      '': 'TestPage',
      '#': 'TestPage',
      '#/': 'TestPage',
      '#/items*': 'TestPage',
      '#/user/:userId': {
        page: 'TestPage',
        guards: [MockGuard],
      },
      '#/redirect': {
        page: 'TestPage',
        guards: [MockGuard],
      },
      '#/profile/:name': 'TestPage',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 1. Static Route Match
    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(mountedPageName, 'TestPage');
    assert.deepStrictEqual(mountedParams, {});

    // Reset tracking
    mountedPageName = null;
    mountedParams = null;
    guardCalled = false;

    // 2. Dynamic Route Match with Parameters & Guards (Allow)
    allowTransition = true;
    redirectTarget = null;
    window.location.hash = '#/user/42?ref=test';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(guardCalled, true, 'Guard should have been called');
    assert.strictEqual(mountedPageName, 'TestPage');
    assert.strictEqual(mountedParams.userId, '42', 'Should parse userId parameter');
    assert.deepStrictEqual(mountedParams.query, { ref: 'test' }, 'Should parse query parameter');

    // Reset tracking
    mountedPageName = null;
    mountedParams = null;
    guardCalled = false;

    // 3. Guards (Deny)
    allowTransition = false;
    const prevHash = window.location.hash; // '#/user/42?ref=test'
    window.location.hash = '#/user/99';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(guardCalled, true, 'Guard should have been called');
    assert.strictEqual(mountedPageName, null, 'Page should not be mounted when transition is denied');
    assert.strictEqual(window.location.hash, prevHash, 'Hash should revert to previous value');

    // Reset tracking
    mountedPageName = null;
    mountedParams = null;
    guardCalled = false;

    // 4. Guards (Redirect)
    allowTransition = true;
    redirectTarget = '#/';
    window.location.hash = '#/redirect';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(guardCalled, true, 'Guard should have been called');
    assert.strictEqual(window.location.hash, '#/', 'Hash should be redirected to redirect target');
    assert.strictEqual(mountedPageName, 'TestPage');

    // Reset tracking
    mountedPageName = null;
    mountedParams = null;
    guardCalled = false;

    // 5. Secondary anchor should be ignored
    allowTransition = true;
    redirectTarget = null;

    window.location.hash = '#/user/42#details';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(mountedPageName, 'TestPage', 'Route should match even with secondary anchor');
    assert.strictEqual(mountedParams.userId, '42', 'Should parse params while ignoring secondary anchor');

    // Reset tracking
    mountedPageName = null;
    mountedParams = null;

    // 6. Secondary anchor after query should be ignored
    window.location.hash = '#/user/42?ref=test#specs';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(mountedPageName, 'TestPage', 'Route with query and secondary anchor should match');
    assert.strictEqual(mountedParams.userId, '42');
    assert.deepStrictEqual(mountedParams.query, { ref: 'test' });

    // 7. Literal asterisk route should match correctly
    mountedPageName = null;
    mountedParams = null;

    window.location.hash = '#/items*';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(mountedPageName, 'TestPage', 'Route containing a literal * should match correctly');

    // Reset tracking
    mountedPageName = null;
    mountedParams = null;

    // 8. Malformed URI parameters should not crash routing
    window.location.hash = '#/user/%E0%A4%A';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(mountedPageName, 'TestPage', 'Router should still mount the page when URI decoding fails');

    assert.strictEqual(mountedParams.userId, '%E0%A4%A', 'Router should fall back to the raw parameter value');

    // 9. Duplicate page registration should warn
    const originalWarn = console.warn;
    let warningMessage = '';

    console.warn = (msg) => {
      warningMessage = msg;
    };

    app.registerPage('TestPage', TestPage);

    assert.ok(warningMessage.includes('already registered'), 'Expected duplicate page registration warning');

    console.warn = originalWarn;

    // 10. Guard Timeout (Custom 50ms)
    class StallingGuard extends AvenxGuard {
      canActivate() {
        return new Promise(() => {}); // never resolves
      }
    }

    if (app.router) {
      app.router.destroy();
    }

    mountedPageName = null;
    mountedParams = null;

    app.initRouter(
      {
        '#/home': 'TestPage',
        '#/stalling': {
          page: 'TestPage',
          guards: [StallingGuard],
        },
      },
      {
        guardTimeout: 50,
      },
    );

    window.location.hash = '#/home';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(app.router.currentRoute.hash, '#/home');

    // Reset tracking
    mountedPageName = null;

    const prevHashBeforeTimeout = window.location.hash;
    let consoleErrorMsg = null;
    const originalConsoleError = console.error;
    console.error = (msg) => {
      consoleErrorMsg = msg instanceof Error ? msg.message : String(msg);
    };

    window.location.hash = '#/stalling';
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.error = originalConsoleError;

    assert.strictEqual(window.location.hash, prevHashBeforeTimeout, 'Hash should revert to previous value on timeout');
    assert.strictEqual(app.router.currentRoute.hash, '#/home', 'Current route hash should revert to #/home');
    assert.strictEqual(mountedPageName, null, 'Page should not be mounted on timeout');
    assert.ok(consoleErrorMsg && consoleErrorMsg.includes('AVX_R14'), 'Should log a timeout error with code AVX_R14');

    // 11. Guard Timeout Redirection
    if (app.router) {
      app.router.destroy();
    }

    mountedPageName = null;
    mountedParams = null;

    app.initRouter(
      {
        '#/stalling-redirect': {
          page: 'TestPage',
          guards: [StallingGuard],
        },
        '#/': 'TestPage',
      },
      {
        guardTimeout: 50,
        guardTimeoutRedirect: '#/',
      },
    );

    let consoleErrorMsgRedirect = null;
    const originalConsoleErrorRedirect = console.error;
    console.error = (msg) => {
      consoleErrorMsgRedirect = msg instanceof Error ? msg.message : String(msg);
    };

    window.location.hash = '#/stalling-redirect';
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.error = originalConsoleErrorRedirect;

    assert.strictEqual(window.location.hash, '#/', 'Hash should be redirected to target redirect path on timeout');
    assert.strictEqual(app.router.currentRoute.hash, '#/', 'Current route hash should be redirected to #/');
    assert.ok(
      consoleErrorMsgRedirect && consoleErrorMsgRedirect.includes('AVX_R14'),
      'Should log a timeout error on redirect',
    );

    // 12. Default Guard Timeout (5000ms)
    if (app.router) {
      app.router.destroy();
    }

    mountedPageName = null;
    mountedParams = null;

    app.initRouter({
      '#/home': 'TestPage',
      '#/stalling-default': {
        page: 'TestPage',
        guards: [StallingGuard],
      },
    });

    window.location.hash = '#/home';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(app.router.currentRoute.hash, '#/home');

    // Reset tracking
    mountedPageName = null;

    const prevHashBeforeDefault = window.location.hash;

    const originalSetTimeout = global.setTimeout;
    let registeredTimeoutDelay = null;
    let timeoutCallback = null;

    global.setTimeout = (cb, delay) => {
      registeredTimeoutDelay = delay;
      timeoutCallback = cb;
      return originalSetTimeout(() => {}, 0);
    };

    window.location.hash = '#/stalling-default';
    await new Promise((resolve) => originalSetTimeout(resolve, 0));

    global.setTimeout = originalSetTimeout;

    assert.strictEqual(registeredTimeoutDelay, 5000, 'Default guard timeout should be 5000ms');
    let consoleErrorMsg2 = null;
    const originalConsoleError2 = console.error;
    console.error = (msg) => {
      consoleErrorMsg2 = msg instanceof Error ? msg.message : String(msg);
    };

    if (timeoutCallback) {
      timeoutCallback();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    console.error = originalConsoleError2;

    assert.strictEqual(
      window.location.hash,
      prevHashBeforeDefault,
      'Hash should revert to previous value on default timeout',
    );
    assert.strictEqual(app.router.currentRoute.hash, '#/home', 'Current route hash should revert to #/home');
    assert.strictEqual(mountedPageName, null, 'Page should not be mounted on default timeout');
    assert.ok(
      consoleErrorMsg2 && consoleErrorMsg2.includes('AVX_R14'),
      'Should log a default timeout error with code AVX_R14',
    );

    // 13. Custom Control Objects (Cancellation and Redirects)
    if (app.router) {
      app.router.destroy();
    }

    mountedPageName = null;
    mountedParams = null;

    let guardReturnVal = null;
    class CustomControlGuard extends AvenxGuard {
      canActivate() {
        return guardReturnVal;
      }
    }

    app.initRouter({
      '#/home': 'TestPage',
      '#/guarded-cancel': {
        page: 'TestPage',
        guards: [CustomControlGuard],
      },
      '#/guarded-redirect': {
        page: 'TestPage',
        guards: [CustomControlGuard],
      },
      '#/login': 'TestPage',
    });

    // Test A: Silent cancel
    window.location.hash = '#/home';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(app.router.currentRoute.hash, '#/home');

    let consoleWarnMsg = null;
    const originalConsoleWarn = console.warn;
    console.warn = (msg) => {
      consoleWarnMsg = msg;
    };

    guardReturnVal = { cancel: true, silent: true };
    window.location.hash = '#/guarded-cancel';
    await new Promise((resolve) => setTimeout(resolve, 0));

    console.warn = originalConsoleWarn;

    assert.strictEqual(window.location.hash, '#/home', 'Hash should revert to #/home');
    assert.strictEqual(app.router.currentRoute.hash, '#/home');
    assert.strictEqual(mountedPageName, null, 'Page should not mount');
    assert.strictEqual(consoleWarnMsg, null, 'Warning should not be triggered');

    // Test B: Warning cancel
    mountedPageName = null;
    consoleWarnMsg = null;
    console.warn = (msg) => {
      consoleWarnMsg = msg;
    };

    guardReturnVal = { cancel: true, silent: false };
    window.location.hash = '#/guarded-cancel';
    await new Promise((resolve) => setTimeout(resolve, 0));

    console.warn = originalConsoleWarn;

    assert.strictEqual(window.location.hash, '#/home', 'Hash should revert to #/home');
    assert.strictEqual(app.router.currentRoute.hash, '#/home');
    assert.strictEqual(mountedPageName, null, 'Page should not mount');
    assert.ok(consoleWarnMsg && consoleWarnMsg.includes('AVX_R06'), 'Warning should be triggered');

    // Test C: Redirect with query/state
    mountedPageName = null;
    guardReturnVal = { redirect: '#/login', state: { reason: 'expired', code: 401 } };
    window.location.hash = '#/guarded-redirect';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(window.location.hash, '#/login?reason=expired&code=401', 'Should redirect with state fields as query parameters');
    assert.strictEqual(app.router.currentRoute.hash, '#/login?reason=expired&code=401');
    assert.strictEqual(mountedPageName, 'TestPage');
    assert.deepStrictEqual(mountedParams.query, { reason: 'expired', code: 401 });

    // Test D: Redirect with query parameter merge
    mountedPageName = null;
    guardReturnVal = { redirect: '#/login?existing=1', query: { extra: 'true' } };
    window.location.hash = '#/guarded-redirect';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(window.location.hash, '#/login?existing=1&extra=true', 'Should merge query parameters correctly');

    // Test E: Encoded route path parameters
    mountedPageName = null;
    mountedParams = null;
    window.location.hash = '#/profile/nathan%20schmid';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(mountedPageName, 'TestPage', 'Should mount TestPage for encoded path parameter route');
    assert.strictEqual(mountedParams.name, 'nathan schmid', 'Should correctly parse and decode path parameters containing %20');

    console.log('  ✅ Router and Guards tests passed!');
  } catch (error) {
    console.error('❌ Router and Guards tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
