import assert from 'assert';

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
    parentNode: null,
    parentElement: null,
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
      if (child.parentNode && typeof child.parentNode.removeChild === 'function') {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      child.parentElement = this;
      childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const idx = childNodes.indexOf(child);
      if (idx !== -1) {
        childNodes.splice(idx, 1);
        child.parentNode = null;
        child.parentElement = null;
      }
      return child;
    },
    replaceChild(newChild, oldChild) {
      const idx = childNodes.indexOf(oldChild);
      if (idx !== -1) {
        childNodes[idx] = newChild;
        newChild.parentNode = this;
        newChild.parentElement = this;
        oldChild.parentNode = null;
        oldChild.parentElement = null;
      }
      return newChild;
    },
    contains(child) {
      let curr = child;
      while (curr) {
        if (curr === this) return true;
        curr = curr.parentElement || curr.parentNode;
      }
      return false;
    },
    closest(selector) {
      let curr = this;
      while (curr) {
        if (curr.matches && curr.matches(selector)) return curr;
        curr = curr.parentElement || curr.parentNode;
      }
      return null;
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
    get firstChild() {
      return childNodes[0] || null;
    },
    get innerHTML() {
      return this._innerHTML || '';
    },
    set innerHTML(html) {
      this._innerHTML = String(html);
      childNodes.length = 0;
      if (typeof html === 'string' && html.includes('class="ax-deadlock-fallback"')) {
        const fallbackNode = createMockElement('div', html, { class: 'ax-deadlock-fallback' });
        fallbackNode.parentNode = this;
        fallbackNode.parentElement = this;
        childNodes.push(fallbackNode);
      }
    },
    matches(selector) {
      if (!selector) return false;
      if (selector === '[data-ax-deadlock]') return this.hasAttribute('data-ax-deadlock');
      if (selector === 'template[data-ax-deadlock-fallback]') {
        return this.tagName.toLowerCase() === 'template' && this.hasAttribute('data-ax-deadlock-fallback');
      }
      if (selector.startsWith('[') && selector.endsWith(']')) {
        return this.hasAttribute(selector.slice(1, -1));
      }
      if (selector.startsWith('.')) {
        return (this.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1));
      }
      return this.tagName.toLowerCase() === selector.toLowerCase();
    },
    querySelectorAll(selector) {
      const results = [];
      const find = (node) => {
        if (node.matches && node.matches(selector)) results.push(node);
        if (node.tagName === 'TEMPLATE') return;
        if (node.childNodes) node.childNodes.forEach(find);
      };
      childNodes.forEach(find);
      return results;
    },
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    listeners,
  };
  element.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
  return element;
};

global.document = {
  querySelector: () => createMockElement('DIV'),
  createElement: (tag) => createMockElement(tag),
};

global.DOMParser = class {
  parseFromString() {
    const body = createMockElement('body');
    return { body };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import {
  nextTick,
  resetScheduler,
  onSchedulerDeadlock,
  setSchedulerMaxFlushCount,
} from '../../lib/core/reactive/scheduler.js';

/**
 * Tests that a synchronous watcher cycle is attributed to its enclosing deadlock boundary,
 * notifies deadlock handlers with that boundary, and honours action="fallback".
 */
async function testWatcherCycleBoundaryAttribution() {
  console.log('🧪 Testing synchronous watcher cycle boundary attribution...');
  resetScheduler();
  setSchedulerMaxFlushCount(25);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  const events = [];
  const unsub = onSchedulerDeadlock((event) => events.push(event));

  const parentComp = new AvenxComponent({}, {}, {}, '<div></div>');
  const parentEl = createMockElement('div');
  parentComp.__setMountTarget(parentEl);
  parentComp.__afterMount();

  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'watcher-boundary',
    'data-ax-deadlock-action': 'fallback',
  });
  parentEl.appendChild(boundaryEl);

  const fallbackTpl = createMockElement('template', '', {
    'data-ax-deadlock-fallback': 'true',
    'data-ax-error-as': 'err',
  });
  fallbackTpl.innerHTML = '<div class="ax-deadlock-fallback">WATCHER-FALLBACK</div>';
  boundaryEl.appendChild(fallbackTpl);

  const childEl = createMockElement('div');
  boundaryEl.appendChild(childEl);
  const child = new AvenxComponent({ a: 0, b: 0 }, {}, {}, '<div>{{ a }} {{ b }}</div>');
  child.__setMountTarget(childEl);
  child.__afterMount();

  child.$watch('a', (newVal) => {
    child.state.b = newVal + 1;
  });
  child.$watch('b', (newVal) => {
    child.state.a = newVal + 1;
  });

  child.state.a = 1;
  await nextTick();

  logger.error = originalError;
  unsub();

  const cycleEvent = events.find((e) => e.boundaryName === 'watcher-boundary');
  assert.ok(cycleEvent, 'Watcher cycle should notify deadlock handlers with boundaryName watcher-boundary');
  assert.strictEqual(cycleEvent.action, 'fallback', 'Notified action should be fallback');
  assert.ok(
    errors.some((e) => e.includes('in boundary <watcher-boundary>')),
    'Watcher cycle AVX_R18 message should be attributed to boundary <watcher-boundary>',
  );
  assert.ok(
    boundaryEl.querySelector('.ax-deadlock-fallback'),
    'Fallback UI should be rendered inside boundary when a watcher cycle trips action="fallback"',
  );

  console.log('  ✅ Synchronous watcher cycle boundary attribution test passed!');
}

(async () => {
  try {
    await testWatcherCycleBoundaryAttribution();
    console.log('🎉 Watcher cycle boundary attribution test passed successfully!');
  } catch (err) {
    console.error('❌ Watcher cycle boundary test failed:', err);
    process.exit(1);
  }
})();
