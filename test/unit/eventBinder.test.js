import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { EventBinder } from '../../lib/core/events/bindEvents.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { EventExecutor } from '../../lib/core/events/eventExecutor.js';
import { DynamicEvaluator } from '../../lib/core/security/evaluator.js';

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

  // 5. Test emit and event payload details transmission
  console.log('  Testing custom event emit payload details...');
  let customEventReceived = false;
  let customEventDetail = null;

  const childComponent = new AvenxComponent(
    { name: 'Avenx' },
    {},
    {},
    '<button data-ax-ref="btn" @click="triggerCustom()">Emit</button>',
    {
      triggerCustom() {
        this.emit('my-custom-event', { user: this.state.name });
      }
    }
  );

  const container = document.createElement('div');
  container.addEventListener('my-custom-event', (e) => {
    customEventReceived = true;
    customEventDetail = e.detail;
  });

  childComponent.__setMountTarget(container);
  childComponent.runUpdate();

  // Trigger click on button inside child component
  const btn = childComponent.$refs.btn;
  assert.ok(btn, 'Emit button should exist');
  btn.click();

  assert.strictEqual(customEventReceived, true, 'my-custom-event should bubble to container');
  assert.deepStrictEqual(customEventDetail, { user: 'Avenx' }, 'Event detail payload should be preserved');

  // 6. EventExecutor hands the handler source to the component
  //
  // This block used to pin the opposite contract: that the executor compiled
  // each handler with `new Function`, cached the closure, and ran
  // `AvenxSandbox.validateSource` over the source text first. All three are
  // gone, deliberately.
  //
  // Compiling here meant every inline handler took the legacy proxy sandbox
  // and none reached the AST evaluator -- so an application needed
  // 'unsafe-eval' for a single @click, and `validateSource`'s word-level check
  // for "constructor" walked straight past `x['const'+'ructor']`. The
  // evaluator gates on the *resolved* key and refuses both spellings, which is
  // why the check it replaced is not missed.
  //
  // Caching is not lost either: the expression compiler keeps its own LRU of
  // parsed ASTs, keyed by source, so a repeated handler is still parsed once.
  console.log('  Testing EventExecutor hands over handler source...');

  {
    const seen = [];
    const evaluator = new DynamicEvaluator();
    const state = { counter: 10 };
    const methods = {
      /**
       * @param {number} val - Amount to add.
       */
      add(val) {
        state.counter += val;
      },
    };

    const testExecutor = new EventExecutor((source, event) => {
      seen.push(source);
      return evaluator.executeStatement(
        source,
        { counter: state.counter, add: methods.add, args: [5], event },
        state,
      );
    });

    testExecutor.execute('counter + 1');
    testExecutor.execute('counter + 1');
    assert.deepStrictEqual(
      seen,
      ['counter + 1', 'counter + 1'],
      'the handler must arrive as source every time, not as a compiled closure'
    );

    // An escape the old source-text check let through must now be refused.
    assert.throws(
      () => testExecutor.execute("counter['const' + 'ructor']"),
      /AVX_R15|constructor/,
      'a computed constructor access must be refused, not merely a literal one'
    );

    assert.throws(
      () => testExecutor.execute('counter.constructor.prototype.polluted = true'),
      /AVX_R15|constructor/,
      'the literal spelling stays refused too'
    );

    testExecutor.teardown();
    assert.throws(() => testExecutor.execute('counter'), TypeError, 'teardown releases the handler');
  }

  console.log('  ✅ EventBinder tests passed!');
} catch (error) {
  console.error('❌ EventBinder tests failed!');
  console.error(error);
  process.exit(1);
}
