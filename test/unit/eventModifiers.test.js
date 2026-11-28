import assert from 'assert';
import { EventBinder } from '../../lib/core/events/bindEvents.js';
import { attachEvent } from '../../lib/core/renderer/program/bindings.js';
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
      addEventListener(event, callback, options) {
        listeners[event] = { callback, options };
      },
      removeEventListener(event, callback, options) {
        const entry = listeners[event];
        if (entry && entry.callback === callback) {
          delete listeners[event];
        }
        if (!this._removes) this._removes = [];
        this._removes.push({ event, callback, options });
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
            const entry = current.listeners[event];
            const callback = typeof entry === 'function' ? entry : entry.callback;
            callback(data);
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

  // 3b. Test .self modifier
  const childEl = createMockElement('BUTTON', {});
  const selfEl = createMockElement('DIV', { '@click.self': 'handleSelf' }, [childEl]);
  binder.bind(selfEl, dispatcher);
  resetDispatcher();

  // Triggering on child element should NOT invoke handleSelf
  childEl.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, null, 'Clicking child should not invoke handler with .self');

  // Triggering directly on selfEl SHOULD invoke handleSelf
  selfEl.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, 'handleSelf', 'Clicking target directly should invoke handler with .self');

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

  // 12. Test keyboard system modifiers
  for (const [modifier, eventProperty] of [
    ['ctrl', 'ctrlKey'],
    ['alt', 'altKey'],
    ['shift', 'shiftKey'],
    ['meta', 'metaKey'],
    ['cmd', 'metaKey'],
  ]) {
    const systemEl = createMockElement('BUTTON', { [`@click.${modifier}`]: `handle${modifier}` });
    binder.bind(systemEl, dispatcher);
    resetDispatcher();

    systemEl.trigger('click', { type: 'click', [eventProperty]: false });
    assert.strictEqual(executedSource, null, `.${modifier} should reject events without the modifier`);

    systemEl.trigger('click', { type: 'click', [eventProperty]: true });
    assert.strictEqual(executedSource, `handle${modifier}`, `.${modifier} should accept matching events`);
  }

  // 13. Test a system modifier chained with a key modifier
  const shiftEnterEl = createMockElement('INPUT', { '@keydown.shift.enter': 'handleShiftEnter' });
  binder.bind(shiftEnterEl, dispatcher);
  resetDispatcher();

  shiftEnterEl.trigger('keydown', { type: 'keydown', key: 'Enter', shiftKey: false });
  assert.strictEqual(executedSource, null, 'Shift+Enter should require Shift');

  shiftEnterEl.trigger('keydown', { type: 'keydown', key: 'Escape', shiftKey: true });
  assert.strictEqual(executedSource, null, 'Shift+Enter should require Enter');

  shiftEnterEl.trigger('keydown', { type: 'keydown', key: 'Enter', shiftKey: true });
  assert.strictEqual(executedSource, 'handleShiftEnter', 'Shift+Enter should run the handler');

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

  // 14. Test .passive modifier passes { passive: true } to addEventListener
  const passiveEl = createMockElement('DIV', { '@scroll.passive': 'handleScroll' });
  binder.bind(passiveEl, dispatcher);
  assert.ok(passiveEl.listeners.scroll, '.passive should register a scroll listener');
  assert.deepStrictEqual(
    passiveEl.listeners.scroll.options,
    { passive: true },
    '.passive should pass { passive: true } to addEventListener'
  );
  resetDispatcher();
  passiveEl.trigger('scroll', { type: 'scroll' });
  assert.strictEqual(executedSource, 'handleScroll', '.passive handler should still execute');

  // 15. Test .capture modifier passes { capture: true } to addEventListener
  const captureEl = createMockElement('DIV', { '@click.capture': 'handleCapture' });
  binder.bind(captureEl, dispatcher);
  assert.ok(captureEl.listeners.click, '.capture should register a click listener');
  assert.deepStrictEqual(
    captureEl.listeners.click.options,
    { capture: true },
    '.capture should pass { capture: true } to addEventListener'
  );
  resetDispatcher();
  captureEl.trigger('click', { type: 'click' });
  assert.strictEqual(executedSource, 'handleCapture', '.capture handler should still execute');

  // 16. Test chaining .passive.once
  const passiveOnceEl = createMockElement('DIV', { '@scroll.passive.once': 'handleScrollOnce' });
  binder.bind(passiveOnceEl, dispatcher);
  assert.deepStrictEqual(
    passiveOnceEl.listeners.scroll.options,
    { passive: true },
    '@scroll.passive.once should pass { passive: true }'
  );
  resetDispatcher();
  passiveOnceEl.trigger('scroll', { type: 'scroll' });
  assert.strictEqual(executionCount, 1, 'First passive.once trigger should run');
  passiveOnceEl.trigger('scroll', { type: 'scroll' });
  assert.strictEqual(executionCount, 1, 'Second passive.once trigger should NOT run');

  // 17. Test .passive + .capture together
  const bothEl = createMockElement('DIV', { '@touchstart.passive.capture': 'handleTouch' });
  binder.bind(bothEl, dispatcher);
  assert.deepStrictEqual(
    bothEl.listeners.touchstart.options,
    { passive: true, capture: true },
    '.passive.capture should OR both options'
  );

  // 18. Test .passive.prevent skips preventDefault
  const passivePreventEl = createMockElement('DIV', { '@wheel.passive.prevent': 'handleWheel' });
  binder.bind(passivePreventEl, dispatcher);
  resetDispatcher();
  let passivePreventCalled = false;
  passivePreventEl.trigger('wheel', {
    type: 'wheel',
    preventDefault() {
      passivePreventCalled = true;
    },
  });
  assert.strictEqual(executedSource, 'handleWheel');
  assert.strictEqual(passivePreventCalled, false, '.passive.prevent should skip preventDefault()');

  // 19. Test removeEventListener receives matching capture option
  const captureUnbindEl = createMockElement('DIV', { '@click.capture': 'handleCaptureUnbind' });
  binder.bind(captureUnbindEl, dispatcher);
  const captureCallback = captureUnbindEl.listeners.click.callback;
  binder.unbind(captureUnbindEl);
  assert.strictEqual(captureUnbindEl.listeners.click, undefined, 'unbind should remove capture listener');
  const clickRemove = (captureUnbindEl._removes || []).find((r) => r.event === 'click' && r.callback === captureCallback);
  assert.ok(clickRemove, 'unbind should call removeEventListener for click');
  assert.deepStrictEqual(
    clickRemove.options,
    { capture: true },
    'removeEventListener must receive matching { capture: true }'
  );

  // 20. Test data-ax-event JSON keys with .passive / .capture
  const dataAxEl = createMockElement('DIV', {
    'data-ax-event': JSON.stringify({
      'scroll.passive': 'onScroll',
      'click.capture': 'onClick',
    }),
  });
  binder.bind(dataAxEl, dispatcher);
  assert.deepStrictEqual(dataAxEl.listeners.scroll.options, { passive: true });
  assert.deepStrictEqual(dataAxEl.listeners.click.options, { capture: true });

  // 21. The compiled renderer's listener applies modifiers in the same order:
  // filters first, then .prevent / .stop, then the handler.
  const compiledListener = (modifiers) => {
    let listener = null;
    const calls = [];
    attachEvent(
      {
        addEventListener(name, callback) {
          listener = callback;
        },
      },
      { n: 'keydown', m: modifiers },
      (event) => calls.push(event.key),
    );
    return { listener, calls };
  };
  const keyEvent = (key, extra = {}) => {
    const event = { key, target: null, currentTarget: null, prevented: false, stopped: false, ...extra };
    event.preventDefault = () => (event.prevented = true);
    event.stopPropagation = () => (event.stopped = true);
    return event;
  };

  const enterPrevent = compiledListener(['enter', 'prevent', 'stop']);
  const typed = keyEvent('a');
  enterPrevent.listener(typed);
  assert.strictEqual(typed.prevented, false, 'compiled .enter.prevent must not prevent other keys');
  assert.strictEqual(typed.stopped, false, 'compiled .enter.stop must not stop other keys');
  const entered = keyEvent('Enter');
  enterPrevent.listener(entered);
  assert.strictEqual(entered.prevented, true, 'compiled .enter.prevent prevents Enter');
  assert.strictEqual(entered.stopped, true, 'compiled .enter.stop stops Enter');
  assert.deepStrictEqual(enterPrevent.calls, ['Enter'], 'compiled .enter runs only on Enter');

  const ctrlEnter = compiledListener(['ctrl', 'enter', 'prevent']);
  const plainEnter = keyEvent('Enter');
  ctrlEnter.listener(plainEnter);
  assert.deepStrictEqual(ctrlEnter.calls, [], 'compiled .ctrl.enter must not run without Ctrl');
  assert.strictEqual(plainEnter.prevented, false, 'compiled .ctrl.enter.prevent must not prevent a plain Enter');
  ctrlEnter.listener(keyEvent('Enter', { ctrlKey: true }));
  assert.deepStrictEqual(ctrlEnter.calls, ['Enter'], 'compiled .ctrl.enter runs with Ctrl held');

  const cmdEnter = compiledListener(['cmd', 'enter']);
  cmdEnter.listener(keyEvent('Enter', { ctrlKey: true }));
  cmdEnter.listener(keyEvent('Enter', { metaKey: true }));
  assert.deepStrictEqual(cmdEnter.calls, ['Enter'], 'compiled .cmd checks metaKey');

  console.log('  ✅ Event Modifiers tests passed!');
} catch (error) {
  console.error('❌ Event Modifiers tests failed!');
  console.error(error);
  process.exit(1);
}
