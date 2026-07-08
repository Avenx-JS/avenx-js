const assert = require('assert');
const { AvenxApp } = require('../../lib/core/runtime/AvenxApp');
const { AvenxPage } = require('../../lib/core/runtime/AvenxPage');

(async () => {
  try {
    console.log('🧪 Testing Router Parameter-Only Change Optimization...');

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

    let mountCount = 0;
    let unmountCount = 0;
    let updateCount = 0;
    let lastMountedInstance = null;

    /**
     *
     */
    class OptimizedPage extends AvenxPage {
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
          '<div>Optimized Page</div>',
          {
            onMount: () => {
              mountCount++;
            },
            onUnmount: () => {
              unmountCount++;
            },
            onUpdate: () => {
              updateCount++;
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
        lastMountedInstance = this;
      }
    }

    /**
     *
     */
    class OtherPage extends AvenxPage {
      /**
       *
       * @param bridges
       * @param componentRegistry
       */
      constructor(bridges, componentRegistry) {
        super({}, {}, bridges, '<div>Other Page</div>', {}, componentRegistry);
      }
      /**
       *
       * @param target
       */
      mount(target) {
        super.mount(target);
        lastMountedInstance = this;
      }
    }

    const app = new AvenxApp({ target: '#app' });
    app.registerPage('OptimizedPage', OptimizedPage);
    app.registerPage('OtherPage', OtherPage);

    app.initRouter({
      '#/': 'OptimizedPage',
      '#/user/:userId': 'OptimizedPage',
      '#/other': 'OtherPage',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 1. Initial Mount
    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(mountCount, 1, 'Should call onMount on initial load');
    assert.strictEqual(unmountCount, 0);
    assert.strictEqual(updateCount, 0);
    const firstInstance = lastMountedInstance;
    assert.ok(firstInstance, 'Page should be mounted');

    // 2. Navigate to dynamic parameter route with same Page Class (#/user/42?ref=test)
    window.location.hash = '#/user/42?ref=test';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify instance reuse and lifecycle hooks
    assert.strictEqual(lastMountedInstance, firstInstance, 'Page instance should be reused');
    assert.strictEqual(mountCount, 1, 'onMount should NOT be called again');
    assert.strictEqual(unmountCount, 0, 'onUnmount should NOT be called');
    assert.ok(updateCount > 0, 'onUpdate should be called when reactive state parameters change');

    // Verify state parameter updates
    assert.strictEqual(firstInstance.params.userId, '42');
    assert.deepStrictEqual(firstInstance.params.query, { ref: 'test' });
    assert.strictEqual(firstInstance.state.userId, '42');
    assert.strictEqual(firstInstance.state.query.ref, 'test');

    // 3. Navigate to another parameter route with same Page Class (#/user/99)
    const prevUpdateCount = updateCount;
    window.location.hash = '#/user/99';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(lastMountedInstance, firstInstance, 'Page instance should still be reused');
    assert.strictEqual(mountCount, 1);
    assert.strictEqual(unmountCount, 0);
    assert.ok(updateCount > prevUpdateCount, 'onUpdate should be called again');

    // Verify parameter update and previous query parameter deletion
    assert.strictEqual(firstInstance.params.userId, '99');
    assert.strictEqual(firstInstance.params.query, undefined, 'Previous query parameters should be deleted');
    assert.strictEqual(firstInstance.state.userId, '99');
    assert.strictEqual(firstInstance.state.query, undefined, 'Previous query parameter state should be deleted');

    // 4. Navigate to a DIFFERENT page class (#/other)
    window.location.hash = '#/other';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(unmountCount, 1, 'Old page should be unmounted when navigating to different page class');
    assert.notStrictEqual(lastMountedInstance, firstInstance, 'A new page instance should be mounted');

    console.log('  ✅ Router Parameter-Only Change Optimization tests passed!');
  } catch (error) {
    console.error('❌ Router Parameter-Only Change Optimization tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
