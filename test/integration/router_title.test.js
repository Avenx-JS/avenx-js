import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

/**
 *
 */
class TestPage extends AvenxPage {
  /**
   *
   */
  render() {
    return '<div>Test Page</div>';
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
    console.log('🧪 Testing Router document.title updates...');

    // ── 1. Static title string ───────────────────────────────────────────
    setupDOMMock();
    setupWindowMock();

    const app1 = new AvenxApp({ target: 'div' });
    app1.registerPage('Home', TestPage);
    app1.registerPage('About', TestPage);

    const router1 = app1.initRouter({
      '#/': { page: 'Home', title: 'Home Page' },
      '#/about': { page: 'About', title: 'About Us' },
    });

    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Home Page', 'Static title should be set for Home');

    window.location.hash = '#/about';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'About Us', 'Static title should be set for About');

    router1.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ Static title string works');

    // ── 2. Dynamic title function ────────────────────────────────────────
    setupDOMMock();
    setupWindowMock();

    const app2 = new AvenxApp({ target: 'div' });
    app2.registerPage('Profile', TestPage);

    const router2 = app2.initRouter({
      '#/profile/:id': { page: 'Profile', title: (params) => `Profile ${params.id}` },
    });

    window.location.hash = '#/profile/42';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Profile 42', 'Dynamic title should interpolate params');

    window.location.hash = '#/profile/99';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Profile 99', 'Dynamic title should update on param change');

    router2.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ Dynamic title function works');

    // ── 3. titleSuffix option ────────────────────────────────────────────
    setupDOMMock();
    setupWindowMock();

    const app3 = new AvenxApp({ target: 'div' });
    app3.registerPage('Home', TestPage);
    app3.registerPage('Contact', TestPage);

    const router3 = app3.initRouter(
      {
        '#/': { page: 'Home', title: 'Home' },
        '#/contact': { page: 'Contact', title: 'Contact' },
      },
      { titleSuffix: ' — MyApp' },
    );

    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Home — MyApp', 'titleSuffix should be appended');

    window.location.hash = '#/contact';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Contact — MyApp', 'titleSuffix should be appended to all routes');

    router3.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ titleSuffix option works');

    // ── 4. titlePrefix option ────────────────────────────────────────────
    setupDOMMock();
    setupWindowMock();

    const app4 = new AvenxApp({ target: 'div' });
    app4.registerPage('Home', TestPage);

    const router4 = app4.initRouter(
      {
        '#/': { page: 'Home', title: 'Dashboard' },
      },
      { titlePrefix: 'MyApp | ' },
    );

    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'MyApp | Dashboard', 'titlePrefix should be prepended');

    router4.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ titlePrefix option works');

    // ── 5. No title field — document.title unchanged ─────────────────────
    setupDOMMock();
    setupWindowMock();

    document.title = 'Original Title';

    const app5 = new AvenxApp({ target: 'div' });
    app5.registerPage('Home', TestPage);

    const router5 = app5.initRouter({
      '#/': 'Home',
    });

    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Original Title', 'document.title should not change when no title is defined');

    router5.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ No title field leaves document.title unchanged');

    // ── 6. Throwing title function — gracefully handled ──────────────────
    setupDOMMock();
    setupWindowMock();

    document.title = 'Before Error';

    const app6 = new AvenxApp({ target: 'div' });
    app6.registerPage('Bad', TestPage);

    // Suppress the expected warning
    const originalWarn = console.warn;
    let caughtWarning = '';
    console.warn = (msg) => {
      caughtWarning = msg;
    };

    const router6 = app6.initRouter({
      '#/bad': {
        page: 'Bad',
        title: () => {
          throw new Error('broken');
        },
      },
    });

    window.location.hash = '#/bad';
    await new Promise((resolve) => setTimeout(resolve, 0));

    console.warn = originalWarn;

    assert.strictEqual(document.title, 'Before Error', 'document.title should not change when title() throws');
    assert.ok(caughtWarning.includes('title()'), 'A warning should be logged when title() throws');

    router6.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ Throwing title function is gracefully handled');

    // ── 7. Dynamic title with query params ───────────────────────────────
    setupDOMMock();
    setupWindowMock();

    const app7 = new AvenxApp({ target: 'div' });
    app7.registerPage('Search', TestPage);

    const router7 = app7.initRouter({
      '#/search/:term': {
        page: 'Search',
        title: (params) => `Search: ${params.term}${params.query?.page ? ` (Page ${params.query.page})` : ''}`,
      },
    });

    window.location.hash = '#/search/avenx?page=2';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(document.title, 'Search: avenx (Page 2)', 'Title function should have access to query params');

    router7.destroy();
    teardownWindowMock();
    teardownDOMMock();

    console.log('  ✅ Dynamic title with query params works');

    console.log('  ✅ All Router document.title tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Router document.title tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
