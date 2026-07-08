const assert = require('assert');
const { EventBinder } = require('../../lib/core/events/bindEvents');

try {
  console.log('🧪 Testing EventBinder...');

  // Mock Node globally if not present
  if (!global.Node) {
    global.Node = { ELEMENT_NODE: 1 };
  }

  // Helper to create mock elements
  /**
   *
   * @param tagName
   * @param attributes
   * @param children
   * @param nodeType
   */
  function createMockElement(tagName, attributes = {}, children = [], nodeType = 1) {
    const listeners = {};
    const element = {
      nodeType,
      tagName,
      attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
      children,
      hasAttribute(name) {
        return Object.keys(attributes).includes(name);
      },
      getAttribute(name) {
        return attributes[name] !== undefined ? attributes[name] : null;
      },
      addEventListener(event, callback) {
        listeners[event] = callback;
      },
      removeEventListener(event, callback) {
        if (listeners[event] === callback) {
          delete listeners[event];
        }
      },
      querySelectorAll(selector) {
        if (selector === '*') {
          const result = [];
          const traverse = (node) => {
            node.children.forEach((child) => {
              result.push(child);
              traverse(child);
            });
          };
          traverse(this);
          return result;
        }
        return [];
      },
      // Test helper to trigger events with bubbling support
      trigger(event, data = {}) {
        if (!Object.prototype.hasOwnProperty.call(data, 'target')) {
          Object.defineProperty(data, 'target', {
            value: this,
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }
        let current = this;
        while (current) {
          if (current.listeners && current.listeners[event]) {
            current.listeners[event](data);
          }
          if (data.cancelBubble) {
            break;
          }
          current = current.parentNode;
        }
      },
      listeners,
    };
    children.forEach((child) => {
      child.parentNode = element;
    });
    return element;
  }

  // Mock dispatcher
  let executedSource = null;
  let executedEvent = null;
  const dispatcher = {
    execute(source, event) {
      executedSource = source;
      executedEvent = event;
    },
  };

  const binder = new EventBinder();

  // 1. Root element has event listener
  const rootEl = createMockElement('DIV', { '@click': 'handleClick' });
  binder.bind(rootEl, dispatcher);

  executedSource = null;
  executedEvent = null;
  rootEl.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, 'handleClick');
  assert.deepStrictEqual(executedEvent, { type: 'click' });

  // 2. Descendant elements also have event listeners
  const childEl = createMockElement('BUTTON', { '@input': 'handleInput' });
  const rootWithChild = createMockElement('DIV', { '@click': 'parentClick' }, [childEl]);

  binder.bind(rootWithChild, dispatcher);

  // Trigger parent
  executedSource = null;
  rootWithChild.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, 'parentClick');

  // Trigger child
  executedSource = null;
  childEl.trigger('input', { type: 'input' });
  assert.strictEqual(executedSource, 'handleInput');

  // 3. DocumentFragment root (nodeType = 11) is skipped but children are bound
  const docFragment = createMockElement('FRAGMENT', {}, [childEl], 11);
  const binder2 = new EventBinder();
  binder2.bind(docFragment, dispatcher);

  executedSource = null;
  childEl.trigger('input', { type: 'input' });
  assert.strictEqual(executedSource, 'handleInput');

  // 4. unbind removes event listeners
  const unbindEl = createMockElement('BUTTON', { '@click': 'cleanupHandler' });

  const binder3 = new EventBinder();
  binder3.bind(unbindEl, dispatcher);

  executedSource = null;
  unbindEl.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, 'cleanupHandler');

  binder3.unbind(unbindEl);

  executedSource = null;
  unbindEl.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, null, 'Event listener should be removed after unbind()');

  console.log('  ✅ EventBinder tests passed!');
} catch (error) {
  console.error('❌ EventBinder tests failed!');
  console.error(error);
  process.exit(1);
}
