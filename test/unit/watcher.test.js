import assert from 'assert';

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
  parseFromString() {
    return { body: mockElement };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import { StateFactory } from '../../lib/core/reactive/createState.js';
import { AvenxWatcher, watchEffect } from '../../lib/core/reactive/watcher.js';
import { nextTick, queueJob } from '../../lib/core/reactive/scheduler.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';

/**
 * Tests basic watcher tracking and callbacks.
 */
function testBasicWatcher() {
  console.log('🧪 Testing basic AvenxWatcher behavior...');

  const state = new StateFactory().create({
    count: 0,
    other: 'hello',
  });

  let callbackCount = 0;
  let lastNewValue = null;
  let lastOldValue = null;

  const watcher = new AvenxWatcher(
    () => state.count,
    (newVal, oldVal) => {
      callbackCount++;
      lastNewValue = newVal;
      lastOldValue = oldVal;
    },
  );

  // Initial value should be computed (not lazy by default)
  assert.strictEqual(watcher.value, 0);
  assert.strictEqual(callbackCount, 0);

  // Mutating target dependency
  state.count = 1;
  assert.strictEqual(watcher.value, 1);
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(lastNewValue, 1);
  assert.strictEqual(lastOldValue, 0);

  // Mutating unrelated property should not trigger callback
  state.other = 'world';
  assert.strictEqual(callbackCount, 1);

  console.log('  ✅ Basic AvenxWatcher tests passed!');
}

/**
 * Tests immediate execution option.
 */
function testImmediateWatcher() {
  console.log('🧪 Testing AvenxWatcher immediate option...');

  const state = new StateFactory().create({
    count: 10,
  });

  let callbackCount = 0;
  let lastNewValue = null;
  let lastOldValue = null;

  new AvenxWatcher(
    () => state.count,
    (newVal, oldVal) => {
      callbackCount++;
      lastNewValue = newVal;
      lastOldValue = oldVal;
    },
    { immediate: true },
  );

  // Callback should run immediately on instantiation
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(lastNewValue, 10);
  assert.strictEqual(lastOldValue, undefined);

  console.log('  ✅ Immediate AvenxWatcher tests passed!');
}

/**
 * Tests teardown cleanup of dependencies.
 */
function testWatcherTeardown() {
  console.log('🧪 Testing AvenxWatcher teardown...');

  const state = new StateFactory().create({
    count: 0,
  });

  let callbackCount = 0;

  const watcher = new AvenxWatcher(
    () => state.count,
    () => {
      callbackCount++;
    },
  );

  state.count = 1;
  assert.strictEqual(callbackCount, 1);

  // Teardown the watcher
  watcher.teardown();

  // Mutating count again should NOT call callback
  state.count = 2;
  assert.strictEqual(callbackCount, 1);

  console.log('  ✅ Watcher teardown tests passed!');
}

/**
 * Tests pause and resume behavior of AvenxWatcher.
 */
function testWatcherPauseResume() {
  console.log('🧪 Testing AvenxWatcher pause/resume...');

  const state = new StateFactory().create({
    count: 0,
  });

  let callbackCount = 0;
  let lastNewValue = null;

  const watcher = new AvenxWatcher(
    () => state.count,(newVal) =>{
      callbackCount++;
      lastNewValue = newVal;
    },
  );

  // Watcher should start in active state
  state.count = 1;

  assert.strictEqual(watcher.value, 1);
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(lastNewValue, 1);

  // Pause the watcher
  watcher.pause();

  // State mutation should not re-evaluate the watcher or trigger callback
  state.count = 2;

  assert.strictEqual(
    watcher.value,
    1,
    'Paused watcher should not re-evaluate its value',
  );
  assert.strictEqual(
    callbackCount,
    1,
    'Paused watcher should not trigger callback',
  );

  // Resume the watcher
  watcher.resume();

  state.count = 3;

  assert.strictEqual(watcher.value, 3);
  assert.strictEqual(callbackCount, 2);
  assert.strictEqual(lastNewValue, 3);

  console.log('  ✅ Watcher pause/resume tests passed!');
}

/**
 * Tests programmatic Component watch method.
 */
function testComponentWatchAPI() {
  console.log('🧪 Testing AvenxComponent watch API...');

  class DummyComponent extends AvenxComponent {
    constructor() {
      super({ value: 100 });
    }
    render() {
      return `<div>${this.state.value}</div>`;
    }
  }

  const comp = new DummyComponent();
  let watchCount = 0;
  let lastNewVal = null;

  comp.watch(
    () => comp.state.value,
    (newVal) => {
      watchCount++;
      lastNewVal = newVal;
    },
  );

  assert.strictEqual(watchCount, 0);

  comp.state.value = 200;
  assert.strictEqual(watchCount, 1);
  assert.strictEqual(lastNewVal, 200);

  // Unmounting component should automatically teardown all registered watchers
  comp.unmount();

  comp.state.value = 300;
  assert.strictEqual(watchCount, 1); // should still be 1 (teardown worked)

  console.log('  ✅ Component watch API tests passed!');
}

/**
 * Tests bridge targeted component updates.
 */
async function testBridgeTargetedUpdates() {
  console.log('🧪 Testing targeted updates for bridges (performance optimization)...');

  // We set up a mock AvenxApp with a bridge
  const app = new AvenxApp({ target: '#app' });
  app.registerBridge('GlobalState', {
    user: 'Alice',
    theme: 'dark',
  });

  let comp1UpdateCount = 0;
  let comp2UpdateCount = 0;

  class Comp1 extends AvenxComponent {
    constructor(bridges) {
      super({}, {}, bridges, '<div>User: {{ GlobalState.user }}</div>');
    }
    runUpdate() {
      comp1UpdateCount++;
      super.runUpdate();
    }
  }

  class Comp2 extends AvenxComponent {
    constructor(bridges) {
      super({}, {}, bridges, '<div>Theme: {{ GlobalState.theme }}</div>');
    }
    runUpdate() {
      comp2UpdateCount++;
      super.runUpdate();
    }
  }

  app.register('Comp1', Comp1);
  app.register('Comp2', Comp2);

  // Mount components
  const mockTarget1 = Object.assign({}, mockElement);
  const mockTarget2 = Object.assign({}, mockElement);

  const comp1 = new Comp1(app.bridges);
  const comp2 = new Comp2(app.bridges);

  comp1.__setMountTarget(mockTarget1);
  comp2.__setMountTarget(mockTarget2);

  comp1.update();
  comp2.update();

  assert.strictEqual(comp1UpdateCount, 1);
  assert.strictEqual(comp2UpdateCount, 1);

  // Modify only 'user' property of the bridge
  app.bridges.GlobalState.user = 'Bob';

  // Wait for the scheduled microtask
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Comp1 should have updated because it accesses 'user'
  assert.strictEqual(comp1UpdateCount, 2);

  // Comp2 should NOT have updated because it only accesses 'theme' (targeted updates work!)
  assert.strictEqual(comp2UpdateCount, 1);

  console.log('  ✅ Targeted bridge updates tests passed!');
}
function testFunctionBasedComputedProperty() {
  console.log('🧪 Testing function-based computed properties...');

  const comp = new AvenxComponent(
    {
      firstName: 'John',
      lastName: 'Doe',
    },
    {
      fullName() {
        return `${this.state.firstName} ${this.state.lastName}`;
      },
    },
  );

  assert.strictEqual(comp.state.fullName, 'John Doe');

  comp.state.firstName = 'Jane';

  assert.strictEqual(comp.state.fullName, 'Jane Doe');

  console.log('  ✅ Function-based computed property is reactive!');
}

/**
 * Tests dynamic dependency pruning during conditional branch changes.
 */
function testDynamicDependencyPruning() {
  console.log('🧪 Testing AvenxWatcher dynamic dependency pruning...');

  const state = new StateFactory().create({
    cond: true,
    a: 10,
    b: 20,
  });

  let callbackCount = 0;
  let evaluatedValue = null;

  const watcher = new AvenxWatcher(
    () => (state.cond ? state.a : state.b),
    (newVal) => {
      callbackCount++;
      evaluatedValue = newVal;
    },
  );

  assert.strictEqual(watcher.value, 10);

  // Updating active dependency 'a' while cond=true
  state.a = 15;
  assert.strictEqual(watcher.value, 15);
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(evaluatedValue, 15);

  // Updating inactive dependency 'b' should NOT trigger callback
  state.b = 25;
  assert.strictEqual(callbackCount, 1);

  // Switch condition branch to false (now accesses 'b')
  state.cond = false;
  assert.strictEqual(watcher.value, 25);
  assert.strictEqual(callbackCount, 2);
  assert.strictEqual(evaluatedValue, 25);

  // 'a' is now a stale dependency: mutating 'a' should NOT trigger callback
  state.a = 100;
  assert.strictEqual(callbackCount, 2);

  // Mutating 'b' SHOULD trigger callback
  state.b = 50;
  assert.strictEqual(watcher.value, 50);
  assert.strictEqual(callbackCount, 3);
  assert.strictEqual(evaluatedValue, 50);

  // Switch condition branch back to true (now accesses 'a')
  state.cond = true;
  assert.strictEqual(watcher.value, 100);
  assert.strictEqual(callbackCount, 4);
  assert.strictEqual(evaluatedValue, 100);

  // 'b' is now stale again
  state.b = 999;
  assert.strictEqual(callbackCount, 4);

  console.log('  ✅ Dynamic dependency pruning tests passed!');
}

async function runTests() {
  try {
    testBasicWatcher();
    testImmediateWatcher();
    testWatcherTeardown();
    testWatcherPauseResume();
    testArrayOfGettersWatcher();
    testComponentWatchAPI();
    testFunctionBasedComputedProperty();
    testDynamicDependencyPruning();
    await testDebounceWatcher();
    await testThrottleWatcher();
    await testFlushOptions();
    await testBridgeTargetedUpdates();
    console.log('✅ All AvenxWatcher tests passed successfully!');
  } catch (error) {
    console.error('❌ AvenxWatcher tests failed!');
    console.error(error);
    process.exit(1);
  }
}

/**
 * Tests AvenxWatcher with an array of getter functions (multi-source watch).
 */
function testArrayOfGettersWatcher() {
  console.log('🧪 Testing AvenxWatcher array of getters (multi-source)...');

  const state = new StateFactory().create({
    a: 10,
    b: 'hello',
    c: true,
  });

  let callbackCount = 0;
  let lastNewValue = null;
  let lastOldValue = null;

  const watcher = new AvenxWatcher(
    [() => state.a, () => state.b],
    (newVals, oldVals) => {
      callbackCount++;
      lastNewValue = newVals;
      lastOldValue = oldVals;
    },
  );

  // Initial value should be array [10, 'hello']
  assert.deepStrictEqual(watcher.value, [10, 'hello']);
  assert.strictEqual(callbackCount, 0);

  // Mutating first dependency
  state.a = 20;
  assert.strictEqual(callbackCount, 1);
  assert.deepStrictEqual(lastNewValue, [20, 'hello']);
  assert.deepStrictEqual(lastOldValue, [10, 'hello']);

  // Mutating second dependency
  state.b = 'world';
  assert.strictEqual(callbackCount, 2);
  assert.deepStrictEqual(lastNewValue, [20, 'world']);
  assert.deepStrictEqual(lastOldValue, [20, 'hello']);

  // Mutating untracked property should NOT trigger callback
  state.c = false;
  assert.strictEqual(callbackCount, 2);

  // Teardown should unbind all tracked dependencies
  watcher.teardown();
  state.a = 30;
  state.b = 'avenx';
  assert.strictEqual(callbackCount, 2);

  console.log('  ✅ Array of getters AvenxWatcher tests passed!');
}

/**
 * Tests AvenxWatcher debounce option.
 */
async function testDebounceWatcher() {
  console.log('🧪 Testing AvenxWatcher debounce option...');

  const state = new StateFactory().create({ count: 0 });
  let callbackCalls = 0;
  let lastNew = null;
  let lastOld = null;

  const watcher = new AvenxWatcher(
    () => state.count,
    (newVal, oldVal) => {
      callbackCalls++;
      lastNew = newVal;
      lastOld = oldVal;
    },
    { debounce: 50 },
  );

  // Trigger rapid mutations within 50ms window
  state.count = 1;
  state.count = 2;
  state.count = 3;

  assert.strictEqual(callbackCalls, 0, 'Callback should not run immediately when debounced');

  // Wait for debounce window
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.strictEqual(callbackCalls, 1, 'Callback should run once after debounce window');
  assert.strictEqual(lastNew, 3);
  assert.strictEqual(lastOld, 0);

  // Test teardown during pending debounce timer
  state.count = 4;
  watcher.teardown();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.strictEqual(callbackCalls, 1, 'Callback should not run after teardown during pending debounce timer');

  console.log('  ✅ Debounce watcher tests passed!');
}

/**
 * Tests AvenxWatcher throttle option.
 */
async function testThrottleWatcher() {
  console.log('🧪 Testing AvenxWatcher throttle option...');

  const state = new StateFactory().create({ val: 0 });
  let callbackCalls = 0;
  const receivedValues = [];

  new AvenxWatcher(
    () => state.val,
    (newVal) => {
      callbackCalls++;
      receivedValues.push(newVal);
    },
    { throttle: 80 },
  );

  // Initial mutation at t=0ms (outside window) -> leading execution
  state.val = 1;
  assert.strictEqual(callbackCalls, 1, 'Throttle should execute leading call immediately');
  assert.deepStrictEqual(receivedValues, [1]);

  // High-frequency mutations within throttle window
  state.val = 2;
  state.val = 3;
  assert.strictEqual(callbackCalls, 1, 'Subsequent calls in window should be buffered');

  // Wait for trailing window execution
  await new Promise((resolve) => setTimeout(resolve, 110));

  assert.strictEqual(callbackCalls, 2, 'Trailing call should execute at end of throttle window');
  assert.deepStrictEqual(receivedValues, [1, 3]);

  console.log('  ✅ Throttle watcher tests passed!');
}

/**
 * Tests AvenxWatcher flush options ('pre', 'post', 'sync'), invalid warning,
 * teardown safety, watchEffect, and interaction with debounce/throttle.
 */
async function testFlushOptions() {
  console.log('🧪 Testing AvenxWatcher flush options ("pre", "post", "sync")...');

  // 1. Ordering relative to queued DOM patch jobs
  const state = new StateFactory().create({ count: 0 });
  const events = [];

  new AvenxWatcher(
    () => state.count,
    (n, o) => events.push(`pre:${o}->${n}`),
    { flush: 'pre' },
  );
  new AvenxWatcher(
    () => state.count,
    (n, o) => events.push(`sync:${o}->${n}`),
    { flush: 'sync' },
  );
  new AvenxWatcher(
    () => state.count,
    (n, o) => events.push(`post:${o}->${n}`),
    { flush: 'post' },
  );

  queueJob(() => events.push('job:patch'));
  state.count = 1;
  state.count = 2;

  // 'pre' and 'sync' run synchronously before microtask flush; 'post' is deferred
  assert.deepStrictEqual(events, [
    'pre:0->1',
    'sync:0->1',
    'pre:1->2',
    'sync:1->2',
  ]);

  await nextTick();
  // 'post' runs after queued job and deduplicates within the same tick (0 -> 2)
  assert.deepStrictEqual(events, [
    'pre:0->1',
    'sync:0->1',
    'pre:1->2',
    'sync:1->2',
    'job:patch',
    'post:0->2',
  ]);

  // 2. Teardown cancels pending 'post' callback
  let tornDownCalled = 0;
  const wTear = new AvenxWatcher(
    () => state.count,
    () => {
      tornDownCalled++;
    },
    { flush: 'post' },
  );
  state.count = 3;
  wTear.teardown();
  await nextTick();
  assert.strictEqual(tornDownCalled, 0, 'Torn-down post watcher must not fire');

  // 3. Invalid flush value warns and defaults to 'pre'
  const origWarn = logger.warn;
  const warnings = [];
  logger.warn = (...args) => warnings.push(args.join(' '));
  let invalidWatcher;
  try {
    invalidWatcher = new AvenxWatcher(
      () => state.count,
      () => {},
      { flush: 'bogus' },
    );
  } finally {
    logger.warn = origWarn;
  }
  assert.strictEqual(invalidWatcher.flush, 'pre');
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0].includes('Invalid flush option'));
  invalidWatcher.teardown();

  // 4. watchEffect with flush: 'post'
  const effectState = new StateFactory().create({ val: 0 });
  const effectLog = [];
  const stopEffect = watchEffect(
    () => {
      effectLog.push(`effect:${effectState.val}`);
    },
    { flush: 'post' },
  );
  assert.deepStrictEqual(effectLog, ['effect:0']);
  queueJob(() => effectLog.push('job:effect-patch'));
  effectState.val = 1;
  assert.deepStrictEqual(effectLog, ['effect:0']);
  await nextTick();
  assert.deepStrictEqual(effectLog, ['effect:0', 'job:effect-patch', 'effect:1']);
  stopEffect();

  // 5. Debounce + flush: 'post' runs in the next post-flush phase after the timer
  const debouncedState = new StateFactory().create({ q: '' });
  const debouncedLog = [];
  new AvenxWatcher(
    () => debouncedState.q,
    (n) => debouncedLog.push(`debounced-post:${n}`),
    { debounce: 30, flush: 'post' },
  );
  debouncedState.q = 'hi';
  await new Promise((resolve) => setTimeout(resolve, 45));
  // Timer fired, scheduling into post-flush; flush runs in next microtask
  await nextTick();
  assert.deepStrictEqual(debouncedLog, ['debounced-post:hi']);

  // 6. Throttle + flush: 'post' runs leading and trailing in post-flush phase
  const throttledState = new StateFactory().create({ x: 0 });
  const throttledLog = [];
  new AvenxWatcher(
    () => throttledState.x,
    (n) => throttledLog.push(`throttled-post:${n}`),
    { throttle: 50, flush: 'post' },
  );
  throttledState.x = 1;
  assert.deepStrictEqual(throttledLog, [], 'Leading throttled post watcher must wait for post flush');
  await nextTick();
  assert.deepStrictEqual(throttledLog, ['throttled-post:1']);

  throttledState.x = 2;
  await new Promise((resolve) => setTimeout(resolve, 70));
  await nextTick();
  assert.deepStrictEqual(throttledLog, ['throttled-post:1', 'throttled-post:2']);

  console.log('  ✅ Flush option tests passed!');
}

runTests();
