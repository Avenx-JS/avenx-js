const assert = require('assert');

// Mock DOM environment
const mockElement = {
  innerHTML: '',
  querySelector: () => null,
  querySelectorAll: () => [],
  dispatchEvent: () => {},
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
  querySelector: () => {
    return mockElement;
  },
};

global.DOMParser = class {
  parseFromString() {
    return { body: mockElement };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

const { StateFactory } = require('../../lib/core/reactive/createState');
const { AvenxWatcher } = require('../../lib/core/reactive/watcher');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { AvenxApp } = require('../../lib/core/runtime/AvenxApp');

/**
 * Tests basic watcher tracking and callbacks.
 */
function testBasicWatcher() {
  console.log('🧪 Testing basic AvenxWatcher behavior...');

  const state = new StateFactory().create({
    count: 0,
    other: 'hello',
  });

  let callbackCount = 0;
  let lastNewValue = null;
  let lastOldValue = null;

  const watcher = new AvenxWatcher(
    () => state.count,
    (newVal, oldVal) => {
      callbackCount++;
      lastNewValue = newVal;
      lastOldValue = oldVal;
    }
  );

  // Initial value should be computed (not lazy by default)
  assert.strictEqual(watcher.value, 0);
  assert.strictEqual(callbackCount, 0);

  // Mutating target dependency
  state.count = 1;
  assert.strictEqual(watcher.value, 1);
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(lastNewValue, 1);
  assert.strictEqual(lastOldValue, 0);

  // Mutating unrelated property should not trigger callback
  state.other = 'world';
  assert.strictEqual(callbackCount, 1);

  console.log('  ✅ Basic AvenxWatcher tests passed!');
}

/**
 * Tests immediate execution option.
 */
function testImmediateWatcher() {
  console.log('🧪 Testing AvenxWatcher immediate option...');

  const state = new StateFactory().create({
    count: 10,
  });

  let callbackCount = 0;
  let lastNewValue = null;
  let lastOldValue = null;

  new AvenxWatcher(
    () => state.count,
    (newVal, oldVal) => {
      callbackCount++;
      lastNewValue = newVal;
      lastOldValue = oldVal;
    },
    { immediate: true }
  );

  // Callback should run immediately on instantiation
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(lastNewValue, 10);
  assert.strictEqual(lastOldValue, undefined);

  console.log('  ✅ Immediate AvenxWatcher tests passed!');
}

/**
 * Tests teardown cleanup of dependencies.
 */
function testWatcherTeardown() {
  console.log('🧪 Testing AvenxWatcher teardown...');

  const state = new StateFactory().create({
    count: 0,
  });

  let callbackCount = 0;

  const watcher = new AvenxWatcher(
    () => state.count,
    () => {
      callbackCount++;
    }
  );

  state.count = 1;
  assert.strictEqual(callbackCount, 1);

  // Teardown the watcher
  watcher.teardown();

  // Mutating count again should NOT call callback
  state.count = 2;
  assert.strictEqual(callbackCount, 1);

  console.log('  ✅ Watcher teardown tests passed!');
}

/**
 * Tests programmatic Component watch method.
 */
function testComponentWatchAPI() {
  console.log('🧪 Testing AvenxComponent watch API...');

  class DummyComponent extends AvenxComponent {
    constructor() {
      super({ value: 100 });
    }
    render() {
      return `<div>${this.state.value}</div>`;
    }
  }

  const comp = new DummyComponent();
  let watchCount = 0;
  let lastNewVal = null;

  comp.watch(
    () => comp.state.value,
    (newVal) => {
      watchCount++;
      lastNewVal = newVal;
    }
  );

  assert.strictEqual(watchCount, 0);

  comp.state.value = 200;
  assert.strictEqual(watchCount, 1);
  assert.strictEqual(lastNewVal, 200);

  // Unmounting component should automatically teardown all registered watchers
  comp.unmount();

  comp.state.value = 300;
  assert.strictEqual(watchCount, 1); // should still be 1 (teardown worked)

  console.log('  ✅ Component watch API tests passed!');
}

/**
 * Tests bridge targeted component updates.
 */
async function testBridgeTargetedUpdates() {
  console.log('🧪 Testing targeted updates for bridges (performance optimization)...');

  // We set up a mock AvenxApp with a bridge
  const app = new AvenxApp({ target: '#app' });
  app.registerBridge('GlobalState', {
    user: 'Alice',
    theme: 'dark',
  });

  let comp1UpdateCount = 0;
  let comp2UpdateCount = 0;

  class Comp1 extends AvenxComponent {
    constructor(bridges) {
      super({}, {}, bridges, '<div>User: {{ GlobalState.user }}</div>');
    }
    runUpdate() {
      comp1UpdateCount++;
      super.runUpdate();
    }
  }

  class Comp2 extends AvenxComponent {
    constructor(bridges) {
      super({}, {}, bridges, '<div>Theme: {{ GlobalState.theme }}</div>');
    }
    runUpdate() {
      comp2UpdateCount++;
      super.runUpdate();
    }
  }

  app.register('Comp1', Comp1);
  app.register('Comp2', Comp2);

  // Mount components
  const mockTarget1 = Object.assign({}, mockElement);
  const mockTarget2 = Object.assign({}, mockElement);

  const comp1 = new Comp1(app.bridges);
  const comp2 = new Comp2(app.bridges);

  comp1.__setMountTarget(mockTarget1);
  comp2.__setMountTarget(mockTarget2);

  comp1.update();
  comp2.update();

  assert.strictEqual(comp1UpdateCount, 1);
  assert.strictEqual(comp2UpdateCount, 1);

  // Modify only 'user' property of the bridge
  app.bridges.GlobalState.user = 'Bob';

  // Wait for the scheduled microtask
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Comp1 should have updated because it accesses 'user'
  assert.strictEqual(comp1UpdateCount, 2);

  // Comp2 should NOT have updated because it only accesses 'theme' (targeted updates work!)
  assert.strictEqual(comp2UpdateCount, 1);

  console.log('  ✅ Targeted bridge updates tests passed!');
}

async function runTests() {
  try {
    testBasicWatcher();
    testImmediateWatcher();
    testWatcherTeardown();
    testComponentWatchAPI();
    await testBridgeTargetedUpdates();
    console.log('✅ All AvenxWatcher tests passed successfully!');
  } catch (error) {
    console.error('❌ AvenxWatcher tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
