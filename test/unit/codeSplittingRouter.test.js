import assert from 'assert';
import '../../lib/core/renderer/installStringRenderer.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxGuard } from '../../lib/core/runtime/AvenxGuard.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

class PageHome extends AvenxPage {
  render() {
    return '<div class="page-home">Home Page</div>';
  }
}

class PageAbout extends AvenxPage {
  render() {
    return `<div class="page-about">About Page: ${this.state.title || 'default'} (id: ${this.state.id || 'none'})</div>`;
  }
}

class PageContact extends AvenxPage {
  render() {
    return '<div class="page-contact">Contact Page</div>';
  }
}

class RejectGuard extends AvenxGuard {
  canActivate() {
    return false;
  }
}

let hashListeners = [];

function setupWindowMock() {
  hashListeners = [];
  const applyHash = (value) => {
    window.location._hash = value;
    hashListeners.forEach((listener) => listener());
  };

  global.window = {
    addEventListener: (event, cb) => {
      if (event === 'hashchange') {
        hashListeners.push(cb);
      }
    },
    removeEventListener: (event, cb) => {
      if (event === 'hashchange') {
        hashListeners = hashListeners.filter((l) => l !== cb);
      }
    },
    location: {
      _hash: '#/',
      get hash() {
        return this._hash;
      },
      set hash(val) {
        applyHash(val);
      },
      replace(val) {
        applyHash(val);
      },
    },
    history: {
      pushState: () => {},
      replaceState: () => {},
      scrollRestoration: 'auto',
    },
    scrollTo: () => {},
    pageXOffset: 0,
    pageYOffset: 0,
  };
}

function teardownWindowMock() {
  delete global.window;
}

function waitForRoute(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  console.log('🧪 Testing Route-Level Code Splitting & Async Component Loading...');

  setupDOMMock();
  setupWindowMock();

  const appRoot = new MockDOMElement('div');
  global.document.querySelector = (sel) => {
    if (sel === '#app') return appRoot;
    return appRoot.querySelector(sel);
  };

  // Test 1: registerPage supports both class and async loader function
  {
    const app = new AvenxApp({ target: '#app' });
    app.registerPage('Home', PageHome);

    let aboutLoaderCalled = false;
    const aboutLoader = async () => {
      aboutLoaderCalled = true;
      return { default: PageAbout };
    };
    app.registerPage('About', aboutLoader);

    assert.strictEqual(app.isPageLoader('Home'), false, 'Home is a synchronous page class');
    assert.strictEqual(app.isPageLoader('About'), true, 'About is an async loader');
    assert.strictEqual(aboutLoaderCalled, false, 'About loader function was not called upon registration');

    const resolved = await app.resolvePage('About');
    assert.strictEqual(resolved, PageAbout, 'resolvePage returns the component class from .default');
    assert.strictEqual(app.isPageLoader('About'), false, 'About is no longer marked as an unresolved loader');
    console.log('  ✅ app.registerPage supports async loaders, and resolvePage unpacks and caches the class');
  }

  // Test 2: Verify that unused pages are NOT loaded on initial app start
  {
    window.location._hash = '#/';
    const app = new AvenxApp({ target: '#app' });
    app.registerPage('Home', PageHome);

    let aboutLoaded = false;
    let contactLoaded = false;

    app.registerPage('About', async () => {
      aboutLoaded = true;
      return PageAbout;
    });
    app.registerPage('Contact', async () => {
      contactLoaded = true;
      return { default: PageContact };
    });

    const router = app.initRouter({
      '#/': 'Home',
      '#/about': 'About',
      '#/contact': 'Contact',
    });

    await waitForRoute(30);

    assert.strictEqual(aboutLoaded, false, 'Unused About page was not loaded on initial app start');
    assert.strictEqual(contactLoaded, false, 'Unused Contact page was not loaded on initial app start');
    assert.strictEqual(router.currentRoute.page, 'Home');
    assert.strictEqual(app.activePage.$pageName, 'Home');
    console.log('  ✅ Unused pages are not loaded on initial app start');

    // Test 3: AvenxRouter resolves and mounts lazy pages correctly on navigation
    window.location.hash = '#/about';
    await waitForRoute(50);

    assert.strictEqual(aboutLoaded, true, 'Navigating to #/about called the About loader');
    assert.strictEqual(contactLoaded, false, 'Contact page still remained unloaded');
    assert.strictEqual(router.currentRoute.page, 'About');
    assert.strictEqual(app.activePage.$pageName, 'About');
    console.log('  ✅ AvenxRouter resolves and mounts lazy pages correctly on navigation');

    router.destroy();
  }

  // Test 4: App states, route parameters, and query parameters operate smoothly with async page loads
  {
    window.location._hash = '#/';
    const app = new AvenxApp({ target: '#app' });

    app.registerPage('AboutDetail', async () => {
      return PageAbout;
    });

    const router = app.initRouter({
      '#/': 'AboutDetail',
      '#/about/:id': 'AboutDetail',
    });

    await waitForRoute(30);

    window.location.hash = '#/about/42?title=AvenxRocks';
    await waitForRoute(50);

    assert.strictEqual(router.currentRoute.params.id, '42', 'Route param id is in currentRoute');
    assert.strictEqual(router.currentRoute.query.title, 'AvenxRocks', 'Query param title is in currentRoute');
    assert.strictEqual(app.activePage.$pageName, 'AboutDetail');
    assert.strictEqual(app.activePage.params.id, '42', 'Active page received route param');
    assert.strictEqual(app.activePage.state.id, '42', 'Active page state received route param');
    assert.strictEqual(app.activePage.$route.query.title, 'AvenxRocks', 'Active page $route received query param');
    console.log('  ✅ Route parameters and query parameters operate smoothly with async page loads');

    router.destroy();
  }

  // Test 5: Route guards operate smoothly with async page loads (cancellation prevents loading)
  {
    window.location._hash = '#/';
    const app = new AvenxApp({ target: '#app' });
    app.registerPage('Home', PageHome);

    let secretLoaded = false;
    app.registerPage('Secret', async () => {
      secretLoaded = true;
      return PageAbout;
    });

    const router = app.initRouter({
      '#/': 'Home',
      '#/secret': {
        page: 'Secret',
        guards: [new RejectGuard()],
      },
    });

    await waitForRoute(30);

    window.location.hash = '#/secret';
    await waitForRoute(50);

    assert.strictEqual(secretLoaded, false, 'Denied guard prevented calling the lazy page loader');
    assert.strictEqual(router.currentRoute.page, 'Home');
    assert.strictEqual(app.activePage.$pageName, 'Home');
    console.log('  ✅ Route guards operate smoothly and block loading when navigation is denied');

    router.destroy();
  }

  // Test 6: Loading placeholder is displayed if transition takes time, and removed on mount
  {
    window.location._hash = '#/';
    const app = new AvenxApp({ target: '#app' });
    app.registerPage('Home', PageHome);

    let resolveSlowPage;
    const slowPagePromise = new Promise((resolve) => {
      resolveSlowPage = resolve;
    });

    app.registerPage('Slow', () => slowPagePromise);

    const router = app.initRouter(
      {
        '#/': 'Home',
        '#/slow': {
          page: 'Slow',
          loading: '<span class="custom-loader">Please wait...</span>',
        },
      },
      { loadingDelay: 0 }
    );

    await waitForRoute(30);
    assert.strictEqual(appRoot.querySelector('[data-ax-loading]'), null);

    window.location.hash = '#/slow';
    await waitForRoute(10);

    // Placeholder should now be in the DOM
    const placeholder = appRoot.querySelector('[data-ax-loading]');
    assert.notStrictEqual(placeholder, null, 'Loading placeholder was displayed while lazy page was pending');

    // Now resolve the page
    resolveSlowPage({ default: PageAbout });
    await waitForRoute(50);

    assert.strictEqual(appRoot.querySelector('[data-ax-loading]'), null, 'Loading placeholder was removed after mount');
    assert.strictEqual(app.activePage.$pageName, 'Slow', 'Page mounted');
    console.log('  ✅ Loading placeholder is displayed during transition and removed upon mount');

    router.destroy();
  }

  // Test 7: Rapid navigation cancellation - outdated pending load does not mount
  {
    window.location._hash = '#/';
    const app = new AvenxApp({ target: '#app' });
    app.registerPage('Home', PageHome);

    let resolvePage1;
    app.registerPage('Page1', () => new Promise((resolve) => { resolvePage1 = resolve; }));
    app.registerPage('Page2', async () => PageContact);

    const router = app.initRouter({
      '#/': 'Home',
      '#/page1': 'Page1',
      '#/page2': 'Page2',
    });

    await waitForRoute(20);

    // Navigate to Page1 (slow load)
    window.location.hash = '#/page1';
    await waitForRoute(10);

    // Then immediately navigate to Page2 before Page1 finishes
    window.location.hash = '#/page2';
    await waitForRoute(50);

    assert.strictEqual(router.currentRoute.page, 'Page2');
    assert.strictEqual(app.activePage.$pageName, 'Page2');

    // Now resolve Page1 late
    resolvePage1({ default: PageAbout });
    await waitForRoute(50);

    assert.strictEqual(router.currentRoute.page, 'Page2');
    assert.strictEqual(app.activePage.$pageName, 'Page2', 'Outdated Page1 did not overwrite Page2');
    console.log('  ✅ Superseded pending page load is cancelled and does not overwrite current route');

    router.destroy();
  }

  teardownWindowMock();
  teardownDOMMock();
  console.log('🎉 All Route-Level Code Splitting & Async Component Loading router tests passed!');
})();
