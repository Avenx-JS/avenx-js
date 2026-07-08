const assert = require('assert');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');

// Mock DOM environment for runtime tests
const createMockElement = (tagName, value = '', attrs = {}, nodeType = 1) => {
  const listeners = {};
  const childNodes = [];
  const element = {
    nodeType,
    nodeName: tagName.toUpperCase(),
    tagName: tagName.toUpperCase(),
    value,
    childNodes,
    attributes: [],
    hasAttribute(name) {
      return attrs[name] !== undefined;
    },
    getAttribute(name) {
      return attrs[name] !== undefined ? attrs[name] : null;
    },
    setAttribute(name, val) {
      attrs[name] = String(val);
      this.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
    },
    removeAttribute(name) {
      delete attrs[name];
      this.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
    },
    addEventListener(event, callback) {
      listeners[event] = callback;
    },
    removeEventListener(event) {
      delete listeners[event];
    },
    appendChild(child) {
      child.parentNode = this;
      childNodes.push(child);
    },
    removeChild(child) {
      const idx = childNodes.indexOf(child);
      if (idx !== -1) {
        childNodes.splice(idx, 1);
        child.parentNode = null;
      }
    },
    replaceChild(newChild, oldChild) {
      const idx = childNodes.indexOf(oldChild);
      if (idx !== -1) {
        childNodes[idx] = newChild;
        newChild.parentNode = this;
        oldChild.parentNode = null;
      }
    },
    cloneNode(deep) {
      const copy = createMockElement(this.tagName, this.value, { ...attrs }, this.nodeType);
      if (deep) {
        childNodes.forEach((child) => {
          copy.appendChild(child.cloneNode(true));
        });
      }
      return copy;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    listeners,
  };
  element.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
  return element;
};

global.document = {
  querySelector: () => createMockElement('DIV'),
};

global.DOMParser = class {
  /**
   *
   */
  parseFromString() {
    return { body: createMockElement('body') };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

/**
 *
 */
async function testStateMutationInTemplate() {
  console.log('🧪 Testing state mutation inside template (computed/getter)...');

  let errorThrown = false;
  const comp = new AvenxComponent(
    { count: 0 },
    {
      badComputed: 'this.count = 42', // Triggers state change inside computed
    },
    {},
    '<div>{{ badComputed }}</div>',
    {},
  );

  const targetEl = createMockElement('div');
  comp.__setMountTarget(targetEl);

  try {
    comp.update();
  } catch (e) {
    if (e.code === 'AVX_R11') {
      errorThrown = true;
    } else {
      console.error('Unexpected error code:', e);
    }
  }

  assert.ok(errorThrown, 'Should throw an AVX_R11 error when mutating state during rendering');
  console.log('  ✅ State mutation in template test passed!');
}

/**
 *
 */
async function testStateMutationInOnUpdate() {
  console.log('🧪 Testing state mutation inside onUpdate hook...');

  let errorThrown = false;
  let onUpdateTriggered = false;

  const comp = new AvenxComponent({ count: 0 }, {}, {}, '<div>{{ count }}</div>', {
    onUpdate() {
      onUpdateTriggered = true;
      this.count = 100; // Triggers state change inside onUpdate
    },
  });

  const targetEl = createMockElement('div');
  comp.__setMountTarget(targetEl);
  comp.__afterMount(); // Marks component as mounted

  try {
    comp.update();
  } catch (e) {
    if (e.code === 'AVX_R11') {
      errorThrown = true;
    } else {
      console.error('Unexpected error code:', e);
    }
  }

  assert.ok(onUpdateTriggered, 'onUpdate should have been triggered');
  assert.ok(errorThrown, 'Should throw an AVX_R11 error when mutating state during onUpdate');
  console.log('  ✅ State mutation in onUpdate test passed!');
}

/**
 *
 */
async function testSafeStateMutation() {
  console.log('🧪 Testing safe state mutation outside render/update...');

  let updateCount = 0;
  const comp = new AvenxComponent({ count: 0 }, {}, {}, '<div>{{ count }}</div>', {
    onUpdate() {
      updateCount++;
    },
  });

  const targetEl = createMockElement('div');
  comp.__setMountTarget(targetEl);
  comp.__afterMount();

  // Initial mount and update
  comp.update();
  assert.strictEqual(updateCount, 1); // initial update of mounted component triggers onUpdate once

  // Modifying state outside rendering lifecycle should be allowed and batched
  comp.state.count = 1;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(updateCount, 2);

  // Async mutation inside onUpdate deferred to next microtask is safe
  comp.state.count = 2; // triggers scheduleUpdate
  await new Promise((resolve) => setTimeout(resolve, 0)); // wait for microtask
  assert.strictEqual(updateCount, 3);

  console.log('  ✅ Safe state mutation test passed!');
}

(async () => {
  try {
    await testStateMutationInTemplate();
    await testStateMutationInOnUpdate();
    await testSafeStateMutation();
    console.log('✅ All state mutation update prevention tests passed!');
  } catch (error) {
    console.error('❌ State mutation update prevention tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
