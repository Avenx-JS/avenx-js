import assert from 'assert';

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
  /**
   *
   */
  parseFromString() {
    return { body: mockElement };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';

/**
 *
 */
async function testStateUpdateBatching() {
  console.log('🧪 Testing component state update batching...');

  let updateCount = 0;
  const comp = new AvenxComponent(
    { x: 0, y: 0, z: 0 }, // state
    {}, // computed
    {}, // bridges
    '<div>{{ x }} {{ y }} {{ z }}</div>',
    {
      onUpdate: () => {
        updateCount++;
      },
    },
  );

  comp.__setMountTarget(mockElement);
  comp.__afterMount();

  // Trigger sequential updates
  comp.state.x = 1;
  comp.state.y = 2;
  comp.state.z = 3;

  // Updates should be asynchronous, so updateCount is still 0
  assert.strictEqual(updateCount, 0, 'Updates should not run synchronously');

  // Wait for the scheduled microtask
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The component should have updated exactly once
  assert.strictEqual(updateCount, 1, 'Multiple synchronous state mutations should be batched into a single update');

  console.log('  ✅ Component state update batching tests passed!');
}

/**
 *
 */
async function testBridgeAndStateCombinedBatching() {
  console.log('🧪 Testing bridge and local state combined batching...');

  const app = new AvenxApp({ target: '#app' });

  app.registerBridge('config', {
    theme: 'light',
  });

  let compInstance = null;
  let updateCount = 0;

  /**
   *
   */
  class MyComp extends AvenxComponent {
    /**
     *
     * @param bridges
     */
    constructor(bridges) {
      super(
        { x: 0 }, // state
        {}, // computed
        bridges,
        '<div>{{ x }} {{ config.theme }}</div>',
        {
          onUpdate: () => {
            updateCount++;
          },
        },
      );
      compInstance = this;
    }
  }

  app.register('MyComp', MyComp);
  app.mount('MyComp', '#app');

  assert.ok(compInstance, 'Component instance should be constructed');

  // Initial update count is 0
  assert.strictEqual(updateCount, 0);

  // Trigger local state mutation and bridge mutation synchronously
  compInstance.state.x = 1;
  app.bridges.config.theme = 'dark';

  // Verify it is deferred
  assert.strictEqual(updateCount, 0);

  // Wait for the microtask
  await new Promise((resolve) => setTimeout(resolve, 0));

  // It should have only updated once!
  assert.strictEqual(updateCount, 1, 'Combined state and bridge changes should only trigger a single update cycle');

  console.log('  ✅ Bridge and state combined batching tests passed!');
}

/**
 *
 */
async function testConsecutiveTicksBatching() {
  console.log('🧪 Testing batching of updates across consecutive microtask ticks...');

  let updateCount = 0;
  const comp = new AvenxComponent(
    { x: 0 },
    {},
    {},
    '<div>{{ x }}</div>',
    {
      onUpdate: () => {
        updateCount++;
      },
    },
  );

  comp.__setMountTarget(mockElement);
  comp.__afterMount();

  // Trigger state mutation in consecutive microtasks
  comp.state.x = 1;
  await Promise.resolve(); // Wait one microtask (consecutive tick)
  comp.state.x = 2;

  // Wait for the full scheduler flush
  await comp.nextTick();

  // The component should have updated exactly once because consecutive updates are grouped!
  assert.strictEqual(updateCount, 1, 'Double updates in consecutive ticks should be grouped into a single DOM patch');

  console.log('  ✅ Consecutive ticks batching tests passed!');
}

/**
 *
 */
async function testParentChildUpdateOrdering() {
  console.log('🧪 Testing parent-child update ordering...');

  const updateOrder = [];

  const parentComp = new AvenxComponent(
    { val: 0 },
    {},
    {},
    '<div>Parent</div>',
    {
      onUpdate: () => {
        updateOrder.push('parent');
      },
    },
  );

  const childComp = new AvenxComponent(
    { val: 0 },
    {},
    {},
    '<div>Child</div>',
    {
      onUpdate: () => {
        updateOrder.push('child');
      },
    },
  );

  // Establish parent-child relationship
  childComp.$parent = parentComp;

  // Mount them
  parentComp.__setMountTarget(mockElement);
  parentComp.__afterMount();
  childComp.__setMountTarget(mockElement);
  childComp.__afterMount();

  // Trigger updates on both parent and child components
  // Parent UID is smaller than child UID because parent is created first
  childComp.scheduleUpdate();
  parentComp.scheduleUpdate();

  // Wait for the scheduler flush
  await parentComp.nextTick();

  // Assert that parent updated BEFORE child, even though child update was queued first
  assert.deepStrictEqual(updateOrder, ['parent', 'child'], 'Parent component should update before child component');

  console.log('  ✅ Parent-child update ordering tests passed!');
}

(async () => {
  try {
    await testStateUpdateBatching();
    await testBridgeAndStateCombinedBatching();
    await testConsecutiveTicksBatching();
    await testParentChildUpdateOrdering();
    console.log('✅ All batching tests passed!');
  } catch (error) {
    console.error('❌ Batching tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
