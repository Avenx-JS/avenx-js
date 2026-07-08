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
  /**
   *
   */
  parseFromString() {
    return { body: mockElement };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { AvenxApp } = require('../../lib/core/runtime/AvenxApp');

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

(async () => {
  try {
    await testStateUpdateBatching();
    await testBridgeAndStateCombinedBatching();
    console.log('✅ All batching tests passed!');
  } catch (error) {
    console.error('❌ Batching tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
