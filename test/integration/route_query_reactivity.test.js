import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

/**
 * Regression for Avenx-JS/avenx-js#1524:
 * `query` must stay reactive when a page is first mounted without a query string.
 */
(async () => {
  try {
    console.log('🧪 Testing query reactivity after no-query mount (#1524)...');

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
      __avenx_comp_instance: null,
    };

    global.document = {
      querySelector: () => mockElement,
      querySelectorAll: () => [],
    };

    global.DOMParser = class {
      /**
       * @returns {{ body: object }}
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

    let lastMountedInstance = null;

    /**
     * Profile page mirroring the routing tutorial's query-derived tab.
     */
    class ProfilePage extends AvenxPage {
      /**
       * @param {object} bridges
       * @param {Map} componentRegistry
       */
      constructor(bridges, componentRegistry) {
        super(
          {},
          {
            activeTab: "query && query.tab ? query.tab : 'overview'",
          },
          bridges,
          '<div id="profile">User Profile: #{{ id }} Active Tab: {{ activeTab }}</div>',
          {},
          componentRegistry,
        );
      }

      /**
       * @param {Element} target
       */
      mount(target) {
        super.mount(target);
        lastMountedInstance = this;
        target.__avenx_comp_instance = this;
      }
    }

    // RouteMatcher always installs the query key on matched routes.
    const emptyQueryMatch = RouteMatcher.matchRoute({ '#/profile/:id': 'ProfilePage' }, '#/profile/7');
    assert.ok(
      Object.prototype.hasOwnProperty.call(emptyQueryMatch.params, 'query'),
      'matchRoute must install params.query even when the URL has no query string',
    );
    assert.strictEqual(emptyQueryMatch.params.query, undefined);

    const withQueryMatch = RouteMatcher.matchRoute({ '#/profile/:id': 'ProfilePage' }, '#/profile/7?tab=activity');
    assert.deepStrictEqual(withQueryMatch.params.query, { tab: 'activity' });

    const app = new AvenxApp({ target: '#app' });
    app.registerPage('ProfilePage', ProfilePage);
    const router = app.initRouter({
      '#/profile/:id': 'ProfilePage',
    });

    // Mount without a query string first — the failure case in #1524.
    window.location.hash = '#/profile/7';
    await new Promise((resolve) => setTimeout(resolve, 20));

    const page = lastMountedInstance;
    assert.ok(page, 'Profile page should mount');
    assert.strictEqual(page.state.id, '7');
    assert.strictEqual(page.state.activeTab, 'overview');
    assert.strictEqual(page.state.query, undefined);
    assert.deepStrictEqual({ ...page.$route.query }, {});

    // no query → query
    window.location.hash = '#/profile/7?tab=activity';
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(lastMountedInstance, page, 'Same page instance must be reused');
    assert.deepStrictEqual({ ...page.state.query }, { tab: 'activity' });
    assert.strictEqual(page.state.activeTab, 'activity');
    assert.strictEqual(page.$route.query.tab, 'activity');
    assert.strictEqual(page.state.query.tab, page.$route.query.tab);

    // query → different query
    window.location.hash = '#/profile/7?tab=billing';
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(lastMountedInstance, page);
    assert.strictEqual(page.state.query.tab, 'billing');
    assert.strictEqual(page.state.activeTab, 'billing');
    assert.strictEqual(page.$route.query.tab, 'billing');

    // query → no query
    window.location.hash = '#/profile/7';
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(lastMountedInstance, page);
    assert.strictEqual(page.state.query, undefined);
    assert.strictEqual(page.state.activeTab, 'overview');
    assert.deepStrictEqual({ ...page.$route.query }, {});

    // param change still works, with a query carried along
    window.location.hash = '#/profile/99?tab=settings';
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(lastMountedInstance, page);
    assert.strictEqual(page.state.id, '99');
    assert.strictEqual(page.state.query.tab, 'settings');
    assert.strictEqual(page.state.activeTab, 'settings');
    assert.strictEqual(page.$route.params.id, '99');
    assert.strictEqual(page.$route.query.tab, 'settings');

    router.destroy();
    console.log('  ✅ Query reactivity after no-query mount tests passed!');
  } catch (error) {
    console.error('❌ Query reactivity after no-query mount tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
