import assert from 'assert';
import { EventBinder } from '../../lib/core/events/bindEvents.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';

try {
  console.log('🧪 Testing Event Modifiers...');

  // Mock Node globally if not present
  if (!global.Node) {
    global.Node = { ELEMENT_NODE: 1 };
  }

  // Helper to create mock elements
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
  let executionCount = 0;
  let executedSource = null;
  const dispatcher = {
    execute(source) {
      executionCount++;
      executedSource = source;
    },
  };

  const resetDispatcher = () => {
    executionCount = 0;
    executedSource = null;
  };

  const binder = new EventBinder();

  // 1. Test .prevent modifier
  const preventEl = createMockElement('DIV', { '@click.prevent': 'handlePrevent' });
  binder.bind(preventEl, dispatcher);
  resetDispatcher();

  let preventCalled = false;
  const mockPreventEvent = {
    type: 'click',
    preventDefault() {
      preventCalled = true;
    },
  };
  preventEl.trigger('click', mockPreventEvent);
  assert.strictEqual(executedSource, 'handlePrevent');
  assert.strictEqual(preventCalled, true, '.prevent should call preventDefault()');

  // 2. Test .stop modifier
  const stopEl = createMockElement('DIV', { '@click.stop': 'handleStop' });
  binder.bind(stopEl, dispatcher);
  resetDispatcher();

  let stopCalled = false;
  const mockStopEvent = {
    type: 'click',
    stopPropagation() {
      stopCalled = true;
    },
  };
  stopEl.trigger('click', mockStopEvent);
  assert.strictEqual(executedSource, 'handleStop');
  assert.strictEqual(stopCalled, true, '.stop should call stopPropagation()');

  // 3. Test .once modifier
  const onceEl = createMockElement('DIV', { '@click.once': 'handleOnce' });
  binder.bind(onceEl, dispatcher);
  resetDispatcher();

  onceEl.trigger('click', { type: 'click' });
  assert.strictEqual(executionCount, 1, 'First trigger should run handler');
  assert.strictEqual(executedSource, 'handleOnce');

  onceEl.trigger('click', { type: 'click' });
  assert.strictEqual(executionCount, 1, 'Second trigger should NOT run handler');

  // 4. Test keyup/keydown modifiers (.enter)
  const enterEl = createMockElement('INPUT', { '@keyup.enter': 'handleEnter' });
  binder.bind(enterEl, dispatcher);
  resetDispatcher();

  // Triggering other key should not call handler
  enterEl.trigger('keyup', { type: 'keyup', key: 'a' });
  assert.strictEqual(executedSource, null, 'Pressing a should not run handler');

  // Triggering Enter key should call handler
  enterEl.trigger('keyup', { type: 'keyup', key: 'Enter' });
  assert.strictEqual(executedSource, 'handleEnter', 'Pressing Enter should run handler');

  // 5. Test keyup/keydown modifiers (.escape)
  const escapeEl = createMockElement('INPUT', { '@keydown.escape': 'handleEscape' });
  binder.bind(escapeEl, dispatcher);
  resetDispatcher();

  // Triggering Escape key should call handler
  escapeEl.trigger('keydown', { type: 'keydown', key: 'Escape' });
  assert.strictEqual(executedSource, 'handleEscape', 'Pressing Escape should run handler');

  // 6. Test multiple modifiers chained (e.g. @click.prevent.stop)
  const chainedEl = createMockElement('DIV', { '@click.prevent.stop': 'handleChained' });
  binder.bind(chainedEl, dispatcher);
  resetDispatcher();

  let chainPrevent = false;
  let chainStop = false;
  const mockChainEvent = {
    type: 'click',
    preventDefault() {
      chainPrevent = true;
    },
    stopPropagation() {
      chainStop = true;
    },
  };
  chainedEl.trigger('click', mockChainEvent);
  assert.strictEqual(executedSource, 'handleChained');
  assert.strictEqual(chainPrevent, true);
  assert.strictEqual(chainStop, true);

  // 8. Test keyup/keydown modifiers (.space)
  const spaceEl = createMockElement('INPUT', { '@keydown.space': 'handleSpace' });
  binder.bind(spaceEl, dispatcher);
  resetDispatcher();

  // Triggering other key should not call handler
  spaceEl.trigger('keydown', { type: 'keydown', key: 'a' });
  assert.strictEqual(executedSource, null, 'Pressing a should not run space handler');

  // Triggering Space key should call handler
  spaceEl.trigger('keydown', { type: 'keydown', key: ' ' });
  assert.strictEqual(executedSource, 'handleSpace', 'Pressing Space should run space handler');

  // 9. Test keyup/keydown modifiers (.tab)
  const tabEl = createMockElement('INPUT', { '@keydown.tab': 'handleTab' });
  binder.bind(tabEl, dispatcher);
  resetDispatcher();

  // Triggering other key should not call handler
  tabEl.trigger('keydown', { type: 'keydown', key: 'Enter' });
  assert.strictEqual(executedSource, null, 'Pressing Enter should not run tab handler');

  // Triggering Tab key should call handler
  tabEl.trigger('keydown', { type: 'keydown', key: 'Tab' });
  assert.strictEqual(executedSource, 'handleTab', 'Pressing Tab should run tab handler');

  // 10. Test keyup/keydown modifiers (.delete)
  const deleteEl = createMockElement('INPUT', { '@keydown.delete': 'handleDelete' });
  binder.bind(deleteEl, dispatcher);
  resetDispatcher();

  // Triggering other key should not call handler
  deleteEl.trigger('keydown', { type: 'keydown', key: 'Backspace' });
  assert.strictEqual(executedSource, null, 'Pressing Backspace should not run delete handler');

  // Triggering Delete key should call handler
  deleteEl.trigger('keydown', { type: 'keydown', key: 'Delete' });
  assert.strictEqual(executedSource, 'handleDelete', 'Pressing Delete should run delete handler');

  // 11. Test keyup/keydown modifiers (.esc)
  const escEl = createMockElement('INPUT', { '@keydown.esc': 'handleEsc' });
  binder.bind(escEl, dispatcher);
  resetDispatcher();

  // Triggering other key should not call handler
  escEl.trigger('keydown', { type: 'keydown', key: 'Enter' });
  assert.strictEqual(executedSource, null, 'Pressing Enter should not run esc handler');

  // Triggering Escape key should call handler (via esc mapping)
  escEl.trigger('keydown', { type: 'keydown', key: 'Escape' });
  assert.strictEqual(executedSource, 'handleEsc', 'Pressing Escape should run esc handler');

  // 7. Test compilation of modifier attributes in ComponentParser
  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);
  const content = `
    <div>
      <button @click.prevent.once="handleClick">Submit</button>
      <input @keyup.enter="handleEnter" />
    </div>
  `;
  const template = cp.extractTemplate(content, {}, 'TestComp');
  assert.ok(template.includes('data-ax-event="{&quot;click.prevent.once&quot;:&quot;handleClick&quot;}"'), 'Template should compile click.prevent.once to data-ax-event');
  assert.ok(template.includes('@keyup.enter="handleEnter"'), 'Template should compile keyup.enter');

  console.log('  ✅ Event Modifiers tests passed!');
} catch (error) {
  console.error('❌ Event Modifiers tests failed!');
  console.error(error);
  process.exit(1);
}
