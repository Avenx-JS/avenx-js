const assert = require('assert');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');

try {
  console.log('🧪 Testing Lifecycle Hooks...');
  // Since we are in Node environment without a real DOM,
  // we'll mock the necessary parts to test hook triggering.

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
    dispatchEvent: () => {},
    childNodes: [],
  };

  // Mock DOMParser for DomPatcher
  global.DOMParser = class {
    /**
     *
     */
    parseFromString() {
      return { body: mockElement };
    }
  };
  global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

  let mountCalled = false;
  let updateCalled = false;
  let unmountCalled = false;

  const comp = new AvenxComponent({}, {}, {}, '<div></div>', {
    onMount: () => {
      mountCalled = true;
    },
    onUpdate: () => {
      updateCalled = true;
    },
    onUnmount: () => {
      unmountCalled = true;
    },
  });

  comp.__setMountTarget(mockElement);
  comp.__afterMount();
  assert.strictEqual(mountCalled, true, 'onMount should be called');

  comp.update();
  assert.strictEqual(updateCalled, true, 'onUpdate should be called');

  comp.unmount();
  assert.strictEqual(unmountCalled, true, 'onUnmount should be called');

  console.log('  ✅ Lifecycle Hooks tests passed!');
} catch (error) {
  console.error('❌ Lifecycle Hooks tests failed!');
  console.error(error);
  process.exit(1);
}
