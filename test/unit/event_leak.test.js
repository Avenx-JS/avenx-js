const assert = require('assert');
const { EventBinder } = require('../../lib/core/events/bindEvents');

try {
  console.log('🧪 Testing EventBinder duplicate listeners and leak prevention...');

  const boundListeners = [];
  const executionCalls = [];

  // 1. Mock DOM element with tracking for bound event listeners
  const mockElement = {
    nodeType: 1,
    tagName: 'BUTTON',
    attributes: [{ name: '@click', value: 'handleClick(1)' }],
    getAttribute(name) {
      const attr = this.attributes.find((a) => a.name === name);
      return attr ? attr.value : null;
    },
    setAttribute(name, value) {
      const attr = this.attributes.find((a) => a.name === name);
      if (attr) {
        attr.value = value;
      } else {
        this.attributes.push({ name, value });
      }
    },
    addEventListener(event, callback) {
      boundListeners.push({ event, callback });
    },
    // Test helper to fire events directly
    trigger(event, data) {
      boundListeners.forEach((listener) => {
        if (listener.event === event) {
          listener.callback(data);
        }
      });
    },
  };

  // Mock dispatcher
  const dispatcher = {
    execute(expression, event) {
      executionCalls.push({ expression, event });
    },
  };

  const binder = new EventBinder();

  // 2. Initial binding
  binder.bind(mockElement, dispatcher);

  assert.strictEqual(boundListeners.length, 1, 'Should add exactly one event listener');
  assert.strictEqual(boundListeners[0].event, 'click');

  // 3. Trigger event & verify it executes the initial handler expression
  mockElement.trigger('click', { type: 'click' });
  assert.strictEqual(executionCalls.length, 1, 'Should execute handler once');
  assert.strictEqual(executionCalls[0].expression, 'handleClick(1)');

  // 4. Update the attribute (simulating DomPatcher behavior)
  mockElement.setAttribute('@click', 'handleClick(2)');

  // 5. Bind again (simulating component update cycle)
  binder.bind(mockElement, dispatcher);

  // Verify that NO duplicate listener was added
  assert.strictEqual(boundListeners.length, 1, 'Should NOT add a new event listener on update');

  // 6. Trigger event again & verify it executes the LATEST handler expression exactly once
  executionCalls.length = 0; // reset calls tracking
  mockElement.trigger('click', { type: 'click' });

  assert.strictEqual(executionCalls.length, 1, 'Should execute updated handler exactly once (no duplicates)');
  assert.strictEqual(executionCalls[0].expression, 'handleClick(2)', 'Should execute the updated handler expression');

  // 7. Verify subtree traversal during unbind on Element (nodeType = 1)
  const childListeners = [];
  const childMock = {
    nodeType: 1,
    tagName: 'SPAN',
    attributes: [{ name: '@click', value: 'childClick' }],
    getAttribute(name) {
      const attr = this.attributes.find((a) => a.name === name);
      return attr ? attr.value : null;
    },
    addEventListener(event, callback) {
      childListeners.push({ event, callback });
    },
    removeEventListener(event, callback) {
      const idx = childListeners.findIndex((l) => l.event === event && l.callback === callback);
      if (idx !== -1) {
        childListeners.splice(idx, 1);
      }
    },
  };

  const parentMock = {
    nodeType: 1,
    tagName: 'DIV',
    attributes: [],
    childNodes: [childMock],
    getAttribute() {
      return null;
    },
  };
  childMock.parentNode = parentMock;

  const directBinder = new EventBinder();

  // Simulate direct binding using a DocumentFragment
  const fragMock = {
    nodeType: 11,
    childNodes: [parentMock],
  };
  parentMock.parentNode = fragMock;

  directBinder.bind(fragMock, dispatcher);
  assert.strictEqual(childListeners.length, 1, 'Child should have 1 bound event listener');

  // Call unbind on parentMock (nodeType = 1, i.e. Element)
  // This should traverse parentMock and clean up childMock's direct event listeners
  directBinder.unbind(parentMock);
  assert.strictEqual(childListeners.length, 0, 'Child event listener should be removed when unbinding parent');

  console.log('  ✅ EventBinder duplicate listeners and leak prevention tests passed!');
} catch (error) {
  console.error('❌ EventBinder duplicate listeners and leak prevention tests failed!');
  console.error(error);
  process.exit(1);
}
