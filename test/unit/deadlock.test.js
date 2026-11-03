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
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import {
  nextTick,
  resetScheduler,
  onSchedulerDeadlock,
  setSchedulerMaxFlushCount,
} from '../../lib/core/reactive/scheduler.js';

/**
 * Tests detection of infinite component update loops in the scheduler.
 */
async function testSchedulerComponentLoopDetection() {
  console.log('🧪 Testing scheduler circular reactive update detection...');
  resetScheduler();
  setSchedulerMaxFlushCount(15);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  let deadlockFired = false;
  const unsub = onSchedulerDeadlock((event) => {
    deadlockFired = true;
    assert.ok(event.cyclePath, 'Event payload should have cyclePath');
  });

  // Create two mutually triggering components
  const comps = {};

  comps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.b) {
        comps.b.state.val = this.val + 1;
      }
    },
  });

  comps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.a) {
        comps.a.state.val = this.val + 1;
      }
    },
  });

  const elA = createMockElement('div');
  const elB = createMockElement('div');
  comps.a.__setMountTarget(elA);
  comps.a.__afterMount();
  comps.b.__setMountTarget(elB);
  comps.b.__afterMount();

  // Kick off the infinite loop
  comps.a.state.val = 1;

  // Wait for scheduler to flush and intercept the deadlock
  await nextTick();

  logger.error = originalError;
  unsub();

  assert.ok(deadlockFired, 'onSchedulerDeadlock listener should have been invoked');
  assert.ok(
    errors.some((e) => e.includes(AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED)),
    'Should log AVX_R18 reactive deadlock error',
  );

  console.log('  ✅ Scheduler circular component update detection test passed!');
}

/**
 * Tests detection of synchronous watcher cascade loops.
 */
async function testSynchronousWatcherCascadeDetection() {
  console.log('🧪 Testing synchronous watcher cascade loop detection...');
  resetScheduler();

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  const comp = new AvenxComponent({ a: 0, b: 0 }, {}, {}, '<div>{{ a }} {{ b }}</div>');
  const el = createMockElement('div');
  comp.__setMountTarget(el);
  comp.__afterMount();

  // Mutual synchronous watchers
  comp.$watch('a', (newVal) => {
    comp.state.b = newVal + 1;
  });

  comp.$watch('b', (newVal) => {
    comp.state.a = newVal + 1;
  });

  // Mutate 'a' to initiate cascade
  comp.state.a = 1;

  logger.error = originalError;

  assert.ok(
    errors.some((e) => e.includes(AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED)),
    'Should log AVX_R18 when synchronous watcher cascade exceeds maximum depth',
  );

  console.log('  ✅ Synchronous watcher cascade loop detection test passed!');
}

/**
 * Tests legitimate multi-pass terminating updates (negative test / no false positives).
 */
async function testLegitimateMultiPassUpdate() {
  console.log('🧪 Testing legitimate multi-pass updates (no false positives)...');
  resetScheduler();
  setSchedulerMaxFlushCount(25);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  let updateCount = 0;
  const comp = new AvenxComponent({ a: 0, b: 0, c: 0 }, {}, {}, '<div>{{ a }} {{ b }} {{ c }}</div>');

  const el = createMockElement('div');
  comp.__setMountTarget(el);
  comp.__afterMount();

  comp.$watch('a', (newVal) => {
    updateCount++;
    comp.state.b = newVal * 2;
  });

  comp.$watch('b', (newVal) => {
    updateCount++;
    comp.state.c = newVal + 10;
  });

  comp.state.a = 5;
  await nextTick();

  logger.error = originalError;

  assert.strictEqual(errors.length, 0, 'No deadlock errors should be emitted for terminating multi-pass updates');
  assert.strictEqual(comp.state.a, 5);
  assert.strictEqual(comp.state.b, 10);
  assert.strictEqual(comp.state.c, 20);
  assert.strictEqual(updateCount, 2);
  console.log('  ✅ Legitimate multi-pass update test passed without false positives!');
}

/**
 * Tests deadlock boundary fallback UI rendering.
 */
async function testDeadlockBoundaryFallback() {
  console.log('🧪 Testing <@deadlock> boundary fallback rendering...');

  const template = `
<div data-ax-deadlock="true" data-ax-deadlock-name="dashboard-boundary" data-ax-deadlock-action="fallback">
  <template data-ax-deadlock-fallback="true" data-ax-error-as="err">
    <div class="ax-deadlock-fallback">Deadlock caught in {{ name }}: {{ err.message }}</div>
  </template>
  <div class="active-content">Active Content</div>
</div>
`.trim();

  const comp = new AvenxComponent({ x: 0 }, {}, {}, template);
  const rootEl = createMockElement('div');
  comp.__setMountTarget(rootEl);

  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'dashboard-boundary',
    'data-ax-deadlock-action': 'fallback',
  });

  const fallbackTpl = createMockElement('template', '', {
    'data-ax-deadlock-fallback': 'true',
    'data-ax-error-as': 'err',
  });
  fallbackTpl.innerHTML = '<div class="ax-deadlock-fallback">Deadlock caught in {{ name }}: {{ err.message }}</div>';
  boundaryEl.appendChild(fallbackTpl);

  const activeContent = createMockElement('div', 'Active Content');
  boundaryEl.appendChild(activeContent);
  rootEl.appendChild(boundaryEl);

  // Trip the deadlock boundary
  comp.$tripDeadlockBoundary('dashboard-boundary', { message: 'Circular loop in dashboard' });

  assert.ok(
    boundaryEl.querySelector('.ax-deadlock-fallback'),
    'Fallback UI element should be rendered inside boundary',
  );

  console.log('  ✅ <@deadlock> boundary fallback rendering test passed!');
}

/**
 * Tests action="fallback" automatically trips boundary on detection without manual intervention.
 */
async function testActionFallbackAutomaticTrip() {
  console.log('🧪 Testing action="fallback" automatic boundary tripping...');
  resetScheduler();
  setSchedulerMaxFlushCount(25);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  const parentComp = new AvenxComponent({}, {}, {}, '<div></div>');
  const parentEl = createMockElement('div');
  parentComp.__setMountTarget(parentEl);
  parentComp.__afterMount();

  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'metrics-boundary',
    'data-ax-deadlock-action': 'fallback',
    'data-ax-deadlock-depth': '5',
  });
  parentEl.appendChild(boundaryEl);

  const fallbackTpl = createMockElement('template', '', {
    'data-ax-deadlock-fallback': 'true',
    'data-ax-error-as': 'err',
  });
  fallbackTpl.innerHTML = '<div class="ax-deadlock-fallback">Deadlock caught in {{ name }}: {{ err.message }}</div>';
  boundaryEl.appendChild(fallbackTpl);

  const comps = {};
  comps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.b) comps.b.state.val = this.val + 1;
    },
  });
  comps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.a) comps.a.state.val = this.val + 1;
    },
  });

  const elA = createMockElement('div');
  const elB = createMockElement('div');
  boundaryEl.appendChild(elA);
  boundaryEl.appendChild(elB);

  comps.a.__setMountTarget(elA);
  comps.a.__afterMount();
  comps.b.__setMountTarget(elB);
  comps.b.__afterMount();

  // Index boundaries on parent component
  parentComp.__deadlockManager.findBoundaries(parentEl);

  // Trigger cycle
  comps.a.state.val = 1;
  await nextTick();

  logger.error = originalError;

  // Verify boundary was automatically tripped
  assert.ok(
    boundaryEl.querySelector('.ax-deadlock-fallback'),
    'Fallback UI should be rendered automatically when action="fallback"',
  );
  assert.ok(
    errors.some((e) => e.includes(AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED)),
    'AVX_R18 should still be logged when boundary catches deadlock',
  );

  console.log('  ✅ action="fallback" automatic boundary tripping test passed!');
}

/**
 * Tests maxDepth overrides the global scheduler limit for work inside the boundary.
 */
async function testMaxDepthOverride() {
  console.log('🧪 Testing maxDepth per-boundary override...');
  resetScheduler();
  setSchedulerMaxFlushCount(25);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  // Boundary with maxDepth="5" (lower than global 25)
  const parentComp = new AvenxComponent({}, {}, {}, '<div></div>');
  const parentEl = createMockElement('div');
  parentComp.__setMountTarget(parentEl);
  parentComp.__afterMount();

  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'tight-boundary',
    'data-ax-deadlock-depth': '5',
    'data-ax-deadlock-action': 'fallback',
  });
  parentEl.appendChild(boundaryEl);

  const fallbackTpl = createMockElement('template', '', {
    'data-ax-deadlock-fallback': 'true',
    'data-ax-error-as': 'err',
  });
  fallbackTpl.innerHTML = '<div class="ax-deadlock-fallback">Deadlock at 5</div>';
  boundaryEl.appendChild(fallbackTpl);

  const comps = {};
  comps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.b) comps.b.state.val = this.val + 1;
    },
  });
  comps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.a) comps.a.state.val = this.val + 1;
    },
  });

  const elA = createMockElement('div');
  const elB = createMockElement('div');
  boundaryEl.appendChild(elA);
  boundaryEl.appendChild(elB);
  comps.a.__setMountTarget(elA);
  comps.a.__afterMount();
  comps.b.__setMountTarget(elB);
  comps.b.__afterMount();
  parentComp.__deadlockManager.findBoundaries(parentEl);

  comps.a.state.val = 1;
  await nextTick();

  assert.ok(
    boundaryEl.querySelector('.ax-deadlock-fallback'),
    'Boundary with maxDepth="5" should trip when depth exceeds 5',
  );

  // Now test boundary with maxDepth="35" (higher than global 25) allows deep legitimate multi-pass updates
  resetScheduler();
  setSchedulerMaxFlushCount(25);
  errors.length = 0;

  const deepParentEl = createMockElement('div');
  const deepParent = new AvenxComponent({}, {}, {}, '<div></div>');
  deepParent.__setMountTarget(deepParentEl);
  deepParent.__afterMount();

  const deepBoundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'deep-boundary',
    'data-ax-deadlock-depth': '35',
    'data-ax-deadlock-action': 'fallback',
  });
  deepParentEl.appendChild(deepBoundaryEl);

  let passCount = 0;
  const deepComps = {};
  deepComps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (passCount < 28 && deepComps.b) {
        passCount++;
        deepComps.b.state.val = this.val + 1;
      }
    },
  });
  deepComps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (passCount < 28 && deepComps.a) {
        passCount++;
        deepComps.a.state.val = this.val + 1;
      }
    },
  });

  const deepElA = createMockElement('div');
  const deepElB = createMockElement('div');
  deepBoundaryEl.appendChild(deepElA);
  deepBoundaryEl.appendChild(deepElB);
  deepComps.a.__setMountTarget(deepElA);
  deepComps.a.__afterMount();
  deepComps.b.__setMountTarget(deepElB);
  deepComps.b.__afterMount();
  deepParent.__deadlockManager.findBoundaries(deepParentEl);

  deepComps.a.state.val = 1;
  await nextTick();

  assert.strictEqual(
    errors.filter((e) => e.includes(AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED)).length,
    0,
    'Boundary with maxDepth="35" should not trip at 28 multi-pass iterations',
  );
  assert.strictEqual(passCount, 28, 'Should complete 28 passes');

  logger.error = originalError;
  console.log('  ✅ maxDepth per-boundary override test passed!');
}

/**
 * Tests action="throw" propagates error to nearest error boundary.
 */
async function testActionThrowPropagation() {
  console.log('🧪 Testing action="throw" propagation to error handler...');
  resetScheduler();
  setSchedulerMaxFlushCount(25);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  let capturedError = null;
  const parentComp = new AvenxComponent({}, {}, {}, '<div></div>', {
    onErrorCaptured(err) {
      capturedError = err;
      return false; // stop propagation
    },
  });
  const parentEl = createMockElement('div');
  parentComp.__setMountTarget(parentEl);
  parentComp.__afterMount();

  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'throwing-boundary',
    'data-ax-deadlock-action': 'throw',
    'data-ax-deadlock-depth': '5',
  });
  parentEl.appendChild(boundaryEl);

  const comps = {};
  comps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.b) comps.b.state.val = this.val + 1;
    },
  });
  comps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.a) comps.a.state.val = this.val + 1;
    },
  });

  const elA = createMockElement('div');
  const elB = createMockElement('div');
  boundaryEl.appendChild(elA);
  boundaryEl.appendChild(elB);
  comps.a.__setMountTarget(elA);
  comps.a.__afterMount();
  comps.b.__setMountTarget(elB);
  comps.b.__afterMount();
  parentComp.__deadlockManager.findBoundaries(parentEl);

  comps.a.state.val = 1;
  await nextTick();

  logger.error = originalError;

  assert.ok(capturedError, 'onErrorCaptured should have received the deadlock error');
  assert.strictEqual(capturedError.code, AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED);

  console.log('  ✅ action="throw" propagation test passed!');
}

/**
 * Tests action="abort" (default) halts flush without tripping fallback.
 */
async function testActionAbortDefault() {
  console.log('🧪 Testing action="abort" default behavior...');
  resetScheduler();
  setSchedulerMaxFlushCount(15);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  const parentComp = new AvenxComponent({}, {}, {}, '<div></div>');
  const parentEl = createMockElement('div');
  parentComp.__setMountTarget(parentEl);
  parentComp.__afterMount();

  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'abort-boundary',
    'data-ax-deadlock-action': 'abort',
    'data-ax-deadlock-depth': '5',
  });
  parentEl.appendChild(boundaryEl);

  const fallbackTpl = createMockElement('template', '', {
    'data-ax-deadlock-fallback': 'true',
    'data-ax-error-as': 'err',
  });
  fallbackTpl.innerHTML = '<div class="ax-deadlock-fallback">Should not render</div>';
  boundaryEl.appendChild(fallbackTpl);

  const comps = {};
  comps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.b) comps.b.state.val = this.val + 1;
    },
  });
  comps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.a) comps.a.state.val = this.val + 1;
    },
  });

  const elA = createMockElement('div');
  const elB = createMockElement('div');
  boundaryEl.appendChild(elA);
  boundaryEl.appendChild(elB);
  comps.a.__setMountTarget(elA);
  comps.a.__afterMount();
  comps.b.__setMountTarget(elB);
  comps.b.__afterMount();
  parentComp.__deadlockManager.findBoundaries(parentEl);

  comps.a.state.val = 1;
  await nextTick();

  logger.error = originalError;

  assert.ok(
    errors.some((e) => e.includes(AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED)),
    'AVX_R18 should be logged',
  );
  assert.strictEqual(
    boundaryEl.querySelector('.ax-deadlock-fallback'),
    null,
    'Fallback should NOT be rendered when action="abort"',
  );

  console.log('  ✅ action="abort" default behavior test passed!');
}

/**
 * Tests isolated attribute: isolated="true" does not abort outside scheduler work.
 */
async function testIsolatedAttribute() {
  console.log('🧪 Testing isolated="true" scheduler containment...');
  resetScheduler();
  setSchedulerMaxFlushCount(25);

  const errors = [];
  const originalError = logger.error;
  logger.error = (msg) => {
    errors.push(msg);
  };

  const parentComp = new AvenxComponent({}, {}, {}, '<div></div>');
  const parentEl = createMockElement('div');
  parentComp.__setMountTarget(parentEl);
  parentComp.__afterMount();

  // Isolated boundary
  const boundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'isolated-boundary',
    'data-ax-deadlock-depth': '5',
    'data-ax-deadlock-action': 'fallback',
    'data-ax-deadlock-isolated': 'true',
  });
  parentEl.appendChild(boundaryEl);

  const fallbackTpl = createMockElement('template', '', {
    'data-ax-deadlock-fallback': 'true',
    'data-ax-error-as': 'err',
  });
  fallbackTpl.innerHTML = '<div class="ax-deadlock-fallback">Deadlocked</div>';
  boundaryEl.appendChild(fallbackTpl);

  // Looping components inside isolated boundary
  const comps = {};
  comps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.b) comps.b.state.val = this.val + 1;
    },
  });
  comps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (comps.a) comps.a.state.val = this.val + 1;
    },
  });

  const elA = createMockElement('div');
  const elB = createMockElement('div');
  boundaryEl.appendChild(elA);
  boundaryEl.appendChild(elB);
  comps.a.__setMountTarget(elA);
  comps.a.__afterMount();
  comps.b.__setMountTarget(elB);
  comps.b.__afterMount();

  // Outside component (not in any boundary)
  let outsideUpdated = false;
  const outsideComp = new AvenxComponent({ count: 10 }, {}, {}, '<div>{{ count }}</div>', {
    onUpdate() {
      outsideUpdated = true;
    },
  });
  const outsideEl = createMockElement('div');
  parentEl.appendChild(outsideEl);
  outsideComp.__setMountTarget(outsideEl);
  outsideComp.__afterMount();

  parentComp.__deadlockManager.findBoundaries(parentEl);

  // Queue both updates
  outsideComp.state.count = 42;
  comps.a.state.val = 1;

  await nextTick();

  logger.error = originalError;

  // Boundary should have tripped
  assert.ok(boundaryEl.querySelector('.ax-deadlock-fallback'), 'Isolated boundary should trip to fallback');

  // Outside component update must not have been dropped
  assert.ok(outsideUpdated, 'Outside component update should run successfully when boundary is isolated="true"');
  assert.strictEqual(outsideComp.state.count, 42);

  // Now test isolated="false" (non-isolated boundary drops outside pending work on abort)
  resetScheduler();
  setSchedulerMaxFlushCount(25);
  errors.length = 0;
  logger.error = (msg) => {
    errors.push(msg);
  };

  const nonIsoParentComp = new AvenxComponent({}, {}, {}, '<div></div>');
  const nonIsoParentEl = createMockElement('div');
  nonIsoParentComp.__setMountTarget(nonIsoParentEl);
  nonIsoParentComp.__afterMount();

  const nonIsoBoundaryEl = createMockElement('div', '', {
    'data-ax-deadlock': 'true',
    'data-ax-deadlock-name': 'non-isolated-boundary',
    'data-ax-deadlock-depth': '5',
    'data-ax-deadlock-action': 'abort',
    'data-ax-deadlock-isolated': 'false',
  });
  nonIsoParentEl.appendChild(nonIsoBoundaryEl);

  const nonIsoComps = {};
  nonIsoComps.a = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (nonIsoComps.b) nonIsoComps.b.state.val = this.val + 1;
    },
  });
  nonIsoComps.b = new AvenxComponent({ val: 0 }, {}, {}, '<div>{{ val }}</div>', {
    onUpdate() {
      if (nonIsoComps.a) nonIsoComps.a.state.val = this.val + 1;
    },
  });
  const nonIsoElA = createMockElement('div');
  const nonIsoElB = createMockElement('div');
  nonIsoBoundaryEl.appendChild(nonIsoElA);
  nonIsoBoundaryEl.appendChild(nonIsoElB);
  nonIsoComps.a.__setMountTarget(nonIsoElA);
  nonIsoComps.a.__afterMount();
  nonIsoComps.b.__setMountTarget(nonIsoElB);
  nonIsoComps.b.__afterMount();

  let nonIsoOutsideRan = false;
  const nonIsoOutsideComp = new AvenxComponent({ count: 10 }, {}, {}, '<div>{{ count }}</div>', {
    onUpdate() {
      nonIsoOutsideRan = true;
    },
  });
  const nonIsoOutsideEl = createMockElement('div');
  nonIsoParentEl.appendChild(nonIsoOutsideEl);
  nonIsoOutsideComp.__setMountTarget(nonIsoOutsideEl);
  nonIsoOutsideComp.__afterMount();

  // Queue cycle and outside job
  nonIsoComps.a.state.val = 1;
  nonIsoOutsideComp.state.count = 99;

  await nextTick();
  logger.error = originalError;

  assert.ok(!nonIsoOutsideRan, 'Outside component update should be aborted when boundary is isolated="false"');

  console.log('  ✅ isolated="true" scheduler containment test passed!');
}

/**
 * Tests ComponentParser validation of maxDepth, action, and isolated attributes (AVX_W35).
 */
async function testCompilerDeadlockAttributeValidation() {
  console.log('🧪 Testing ComponentParser <@deadlock> attribute validation...');
  const parser = new ComponentParser();

  const warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (msg) => {
    warnings.push(msg);
  };

  // 1. Invalid maxDepth
  const invalidDepthTpl = `<@deadlock name="test1" maxDepth="-5" action="fallback"><div>Content</div></@deadlock>`;
  const res1 = parser.processDeadlock(invalidDepthTpl, 'Test.component.js', 'TestComponent');
  assert.ok(
    warnings.some((w) => w.includes('AVX_W35') && w.includes('maxDepth')),
    'Should emit AVX_W35 warning for invalid maxDepth',
  );
  assert.ok(!res1.includes('data-ax-deadlock-depth'), 'Should omit data-ax-deadlock-depth on invalid value');

  // 2. Invalid action
  warnings.length = 0;
  const invalidActionTpl = `<@deadlock name="test2" action="explode"><div>Content</div></@deadlock>`;
  const res2 = parser.processDeadlock(invalidActionTpl, 'Test.component.js', 'TestComponent');
  assert.ok(
    warnings.some((w) => w.includes('AVX_W35') && w.includes('action')),
    'Should emit AVX_W35 warning for invalid action',
  );
  assert.ok(!res2.includes('data-ax-deadlock-action'), 'Should omit data-ax-deadlock-action on invalid value');

  // 3. Invalid isolated
  warnings.length = 0;
  const invalidIsolatedTpl = `<@deadlock name="test3" isolated="maybe"><div>Content</div></@deadlock>`;
  const res3 = parser.processDeadlock(invalidIsolatedTpl, 'Test.component.js', 'TestComponent');
  assert.ok(
    warnings.some((w) => w.includes('AVX_W35') && w.includes('isolated')),
    'Should emit AVX_W35 warning for invalid isolated',
  );
  assert.ok(!res3.includes('data-ax-deadlock-isolated'), 'Should omit data-ax-deadlock-isolated on invalid value');

  // 4. Valid attributes
  warnings.length = 0;
  const validTpl = `<@deadlock name="valid" maxDepth="12" action="fallback" isolated="true"><div>Content</div></@deadlock>`;
  const res4 = parser.processDeadlock(validTpl, 'Test.component.js', 'TestComponent');
  assert.strictEqual(warnings.length, 0, 'No warnings should be emitted for valid attributes');
  assert.ok(res4.includes('data-ax-deadlock-depth="12"'));
  assert.ok(res4.includes('data-ax-deadlock-action="fallback"'));
  assert.ok(res4.includes('data-ax-deadlock-isolated="true"'));

  logger.warn = originalWarn;
  console.log('  ✅ ComponentParser <@deadlock> attribute validation test passed!');
}

(async () => {
  try {
    await testSchedulerComponentLoopDetection();
    await testSynchronousWatcherCascadeDetection();
    await testLegitimateMultiPassUpdate();
    await testDeadlockBoundaryFallback();
    await testActionFallbackAutomaticTrip();
    await testMaxDepthOverride();
    await testActionThrowPropagation();
    await testActionAbortDefault();
    await testIsolatedAttribute();
    await testCompilerDeadlockAttributeValidation();
    console.log('🎉 All Deadlock and Reactive Cycle tests passed successfully!');
  } catch (err) {
    console.error('❌ Deadlock test failed:', err);
    process.exit(1);
  }
})();
