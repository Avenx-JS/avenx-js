/**
 * @file routerPrefixedWarning.test.js
 * @description A prefixed router must stay silent about hashes outside its
 * prefix, and an unprefixed router must stay silent about a hash another
 * router owns. Only a hash inside a router's own prefix that matches no
 * route, with no wildcard declared, warns AVX_W10.
 *
 * Issue #1815: with a host app (`'/'`, `'*'`) and a widget app
 * (`'/home'`, `'*'`, prefix `'/widget'`), loading at `#/` warned
 * `AVX_W10 No route defined for hash` from the widget router, even though
 * the routing guide says a hash outside a router's prefix is ignored
 * completely by that router, including its wildcard route.
 */
import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

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

/**
 *
 */
class PageWidgetHome extends AvenxPage {
  /**
   *
   */
  render() {
    return '<div>Widget Home Page</div>';
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

/**
 * The AVX_W10 warnings captured so far.
 * @param {string[]} warnings - All captured logger.warn lines.
 * @returns {string[]} Only the AVX_W10 lines.
 */
function routeNotFoundWarnings(warnings) {
  return warnings.filter((warning) => warning.includes('AVX_W10'));
}

/**
 * A prefixed router logs nothing for a hash outside its prefix, and keeps
 * routing hashes inside its prefix normally.
 * @param {string[]} warnings - Captured logger.warn lines.
 * @returns {Promise<void>}
 */
async function testPrefixedRouterSilentOutsidePrefix(warnings) {
  console.log('🧪 Testing prefixed router stays silent outside its prefix...');

  setupDOMMock();
  setupWindowMock();

  const hostApp = new AvenxApp({ target: 'div' });
  hostApp.registerPage('Home', PageHome);
  const hostRouter = hostApp.initRouter({
    '#/': 'Home',
    '*': 'Home',
  });

  const widgetApp = new AvenxApp({ target: 'div' });
  widgetApp.registerPage('WidgetHome', PageWidgetHome);
  const widgetRouter = widgetApp.initRouter(
    {
      '#/home': 'WidgetHome',
      '*': 'WidgetHome',
    },
    { prefix: '/widget' },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  // Loading at #/ belongs to the host router; the widget router ignores it.
  assert.strictEqual(hostRouter.currentRoute.page, 'Home', 'Host should mount Home at #/');
  assert.strictEqual(
    routeNotFoundWarnings(warnings).length,
    0,
    'Prefixed router must not warn AVX_W10 for a hash outside its prefix',
  );

  // A host-only hash the host wildcard catches is still none of the
  // widget router's business.
  window.location.hash = '#/about';
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(hostRouter.currentRoute.page, 'Home', 'Host wildcard should catch #/about');
  assert.strictEqual(
    routeNotFoundWarnings(warnings).length,
    0,
    'Prefixed router must not warn AVX_W10 for a host-only hash',
  );

  // A hash inside the prefix still routes to the widget router, and the
  // host router leaves it alone.
  hostRouter.currentRoute = null;
  widgetRouter.currentRoute = null;
  window.location.hash = '#/widget/home';
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(widgetRouter.currentRoute.page, 'WidgetHome', 'Widget should mount at #/widget/home');
  assert.strictEqual(hostRouter.currentRoute, null, 'Host should not run its fallback for a widget hash');
  assert.strictEqual(
    routeNotFoundWarnings(warnings).length,
    0,
    'No router should warn AVX_W10 for a hash one of them owns',
  );

  hostRouter.destroy();
  widgetRouter.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ Prefixed router silence tests passed!');
}

/**
 * AVX_W10 still fires for an unmatched hash inside the router's prefix
 * when no wildcard is declared.
 * @param {string[]} warnings - Captured logger.warn lines.
 * @returns {Promise<void>}
 */
async function testWarnInsidePrefixWithoutWildcard(warnings) {
  console.log('🧪 Testing AVX_W10 still fires inside the prefix with no wildcard...');

  setupDOMMock();
  setupWindowMock();

  const hostApp = new AvenxApp({ target: 'div' });
  hostApp.registerPage('Home', PageHome);
  const hostRouter = hostApp.initRouter({
    '#/': 'Home',
    '*': 'Home',
  });

  const widgetApp = new AvenxApp({ target: 'div' });
  widgetApp.registerPage('WidgetHome', PageWidgetHome);
  const widgetRouter = widgetApp.initRouter(
    {
      '#/home': 'WidgetHome',
    },
    { prefix: '/widget' },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  warnings.length = 0;

  window.location.hash = '#/widget/unknown';
  await new Promise((resolve) => setTimeout(resolve, 0));

  const notFound = routeNotFoundWarnings(warnings);
  assert.strictEqual(notFound.length, 1, 'Exactly one AVX_W10 warning should fire for an unmatched hash');
  assert.ok(
    notFound[0].includes('#/widget/unknown'),
    'The AVX_W10 warning should name the unmatched hash',
  );

  hostRouter.destroy();
  widgetRouter.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ AVX_W10 inside-prefix tests passed!');
}

/**
 * An unprefixed router does not warn about a hash another router owns,
 * even when the unprefixed router has no wildcard of its own.
 * @param {string[]} warnings - Captured logger.warn lines.
 * @returns {Promise<void>}
 */
async function testUnprefixedRouterSilentForOwnedHash(warnings) {
  console.log('🧪 Testing unprefixed router stays silent for a hash another router owns...');

  setupDOMMock();
  setupWindowMock();

  const hostApp = new AvenxApp({ target: 'div' });
  hostApp.registerPage('Home', PageHome);
  const hostRouter = hostApp.initRouter({
    '#/': 'Home',
  });

  const widgetApp = new AvenxApp({ target: 'div' });
  widgetApp.registerPage('WidgetHome', PageWidgetHome);
  const widgetRouter = widgetApp.initRouter(
    {
      '#/home': 'WidgetHome',
    },
    { prefix: '/widget' },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  // Reset current routes to null to test the transition cleanly.
  hostRouter.currentRoute = null;
  widgetRouter.currentRoute = null;
  warnings.length = 0;

  window.location.hash = '#/widget/home';
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(widgetRouter.currentRoute.page, 'WidgetHome', 'Widget should mount at #/widget/home');
  assert.strictEqual(hostRouter.currentRoute, null, 'Host should not mount anything for a widget hash');
  assert.strictEqual(
    routeNotFoundWarnings(warnings).length,
    0,
    'Unprefixed router must not warn AVX_W10 for a hash another router owns',
  );

  hostRouter.destroy();
  widgetRouter.destroy();
  teardownWindowMock();
  teardownDOMMock();
  console.log('  ✅ Unprefixed router silence tests passed!');
}

(async () => {
  const warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    await testPrefixedRouterSilentOutsidePrefix(warnings);
    await testWarnInsidePrefixWithoutWildcard(warnings);
    await testUnprefixedRouterSilentForOwnedHash(warnings);
    console.log('  ✅ Prefixed router warning tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Prefixed router warning tests failed!');
    console.error(error);
    process.exit(1);
  } finally {
    logger.warn = originalWarn;
  }
})();
