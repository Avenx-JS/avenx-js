import assert from 'assert';
import { AvenxRouter } from '../../lib/core/runtime/AvenxRouter.js';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';
import {
  MemoryNavigationDelegate,
  createNavigationDelegate,
} from '../../lib/core/runtime/navigation/index.js';

/**
 * Unit tests for SSR / Node.js headless router execution.
 */
async function runTests() {
  console.log('🧪 Testing Router SSR and MemoryNavigationDelegate in Node.js...');

  // 1. Test createNavigationDelegate with mode 'memory'
  const memoryDelegate = createNavigationDelegate({ mode: 'memory' });
  assert.ok(
    memoryDelegate instanceof MemoryNavigationDelegate,
    'Delegate with mode memory should be MemoryNavigationDelegate',
  );

  // 2. Test MemoryNavigationDelegate state & callbacks
  const delegate = new MemoryNavigationDelegate('#/initial');
  assert.strictEqual(delegate.getHash(), '#/initial');

  let changeCount = 0;
  let lastHash = '';
  const unsubscribe = delegate.onHashChange((h) => {
    changeCount++;
    lastHash = h;
  });

  delegate.setHash('#/dashboard');
  assert.strictEqual(delegate.getHash(), '#/dashboard');
  assert.strictEqual(changeCount, 1);
  assert.strictEqual(lastHash, '#/dashboard');

  delegate.setTitle('Dashboard Page');
  assert.strictEqual(delegate.title, 'Dashboard Page');

  unsubscribe();
  delegate.setHash('#/profile');
  assert.strictEqual(changeCount, 1, 'Callback should not fire after unsubscribe');

  // 3. Test RouteMatcher pure matching
  const routes = {
    '#/user/:id': 'UserPage',
    '#/search': 'SearchPage',
    '*': 'NotFoundPage',
  };

  assert.strictEqual(RouteMatcher.matches(routes, '#/user/42'), true);
  assert.strictEqual(RouteMatcher.matches(routes, '#/unknown'), false);

  const match1 = RouteMatcher.matchRoute(routes, '#/user/123?tab=settings');
  assert.ok(match1.matchedRoute);
  assert.strictEqual(match1.matchedRoute.definition, 'UserPage');
  assert.strictEqual(match1.params.id, '123');
  assert.strictEqual(match1.params.query.tab, 'settings');

  // 4. Test AvenxRouter running cleanly in Node.js without global window or document
  const mockApp = {
    mountedPage: null,
    mountedParams: null,
    mountPage(pageName, params) {
      this.mountedPage = pageName;
      this.mountedParams = params;
    },
  };

  const router = new AvenxRouter(
    mockApp,
    {
      '#/home': 'HomePage',
      '#/product/:id': 'ProductPage',
      '*': 'NotFoundPage',
    },
    { initialHash: '#/product/99', mode: 'memory' },
  );

  assert.ok(router.delegate instanceof MemoryNavigationDelegate);

  router.start();
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(mockApp.mountedPage, 'ProductPage');
  assert.strictEqual(mockApp.mountedParams.id, '99');

  router.navigate('#/home');
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(mockApp.mountedPage, 'HomePage');

  router.destroy();

  console.log('  ✅ Router SSR and MemoryNavigationDelegate tests passed!');
}

try {
  await runTests();
} catch (error) {
  console.error('❌ Router SSR and MemoryNavigationDelegate tests failed!');
  console.error(error);
  process.exit(1);
}
