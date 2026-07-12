import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

/**
 *
 */
class PageDocs extends AvenxPage {
  /**
   *
   */
  render() {
    return '<div>Docs Page</div>';
  }
}

/**
 *
 */
class PageHome extends AvenxPage {
  /**
   *
   */
  render() {
    return '<div>Home Page</div>';
  }
}

let hashListeners = [];

/**
 *
 */
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

/**
 *
 */
function teardownWindowMock() {
  delete global.window;
}

(async () => {
  try {
    console.log('🧪 Testing wildcard route matching...');

    setupDOMMock();
    setupWindowMock();

    const app = new AvenxApp({ target: 'div' });
    app.registerPage('Docs', PageDocs);
    app.registerPage('Home', PageHome);

    const router = app.initRouter({
      '#/': 'Home',
      '#/docs/*': 'Docs',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // 1. Wildcard should match a single-segment subpath
    window.location.hash = '#/docs/intro';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(router.currentRoute.page, 'Docs', 'Should match /docs/* for a single-segment subpath');
    assert.strictEqual(
      router.currentRoute.params.wildcard,
      'intro',
      'Wildcard param should capture the matched subpath',
    );

    // 2. Wildcard should match a deeply nested subpath
    window.location.hash = '#/docs/concepts/reactivity';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(router.currentRoute.page, 'Docs', 'Should match /docs/* for a multi-segment subpath');
    assert.strictEqual(
      router.currentRoute.params.wildcard,
      'concepts/reactivity',
      'Wildcard param should capture the full nested subpath',
    );

    // 3. Wildcard should still support query params alongside the match
    window.location.hash = '#/docs/intro?ref=search';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(router.currentRoute.params.wildcard, 'intro', 'Wildcard should exclude the query string');
    assert.strictEqual(router.currentRoute.params.query.ref, 'search', 'Query params should still parse');

    // 4. matches() should also respect wildcard patterns
    assert.strictEqual(router.matches('#/docs/anything/deep'), true, 'matches() should honor wildcard routes');

    // 5. A route not under the wildcard prefix should not match
    assert.strictEqual(router.matches('#/other'), false, 'matches() should not match unrelated paths');

    router.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ Wildcard route matching tests passed!');
  } catch (error) {
    console.error('❌ Wildcard route matching tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
