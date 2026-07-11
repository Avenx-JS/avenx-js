import assert from 'assert';

// Mock DOM environment for AvenxApp
const mockElement = {
  innerHTML: '',
  querySelector: () => null,
  querySelectorAll: () => [],
};

global.document = {
  querySelector: () => mockElement,
};

import { isReactiveTarget } from '../../lib/core/reactive/proxyHandler.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxWatcher } from '../../lib/core/reactive/watcher.js';

/**
 *
 */
function testIsReactiveTarget() {
  console.log('🧪 Testing isReactiveTarget helper...');

  // Primitives
  assert.strictEqual(isReactiveTarget(null), false);
  assert.strictEqual(isReactiveTarget(undefined), false);
  assert.strictEqual(isReactiveTarget(42), false);
  assert.strictEqual(isReactiveTarget('hello'), false);
  assert.strictEqual(isReactiveTarget(true), false);

  // Plain objects and arrays
  assert.strictEqual(isReactiveTarget({}), true);
  assert.strictEqual(isReactiveTarget({ name: 'Alice' }), true);
  assert.strictEqual(isReactiveTarget([]), true);
  assert.strictEqual(isReactiveTarget(Object.create(null)), true);

  // Built-ins & custom classes
  assert.strictEqual(isReactiveTarget(new Date()), false);
  assert.strictEqual(isReactiveTarget(/regex/), false);
  assert.strictEqual(isReactiveTarget(new Map()), false);
  assert.strictEqual(isReactiveTarget(new Set()), false);
  assert.strictEqual(isReactiveTarget(Promise.resolve()), false);

  /**
   *
   */
  class CustomClass {}
  assert.strictEqual(isReactiveTarget(new CustomClass()), false);

  console.log('  ✅ isReactiveTarget helper tests passed!');
}

/**
 *
 */
function testStateDeepReactivity() {
  console.log('🧪 Testing deep reactivity on component state...');

  let changeCount = 0;
  const initialState = {
    user: {
      name: 'Alice',
      profile: {
        age: 25,
      },
    },
    tags: ['js', 'reactive'],
  };

  const state = new StateFactory().create(initialState, {
    onChange: () => {
      changeCount++;
    },
  });

  // 1. Initial changeCount is 0
  assert.strictEqual(changeCount, 0);

  // 2. Mutating nested object should trigger onChange
  state.user.name = 'Bob';
  assert.strictEqual(changeCount, 1);
  assert.strictEqual(state.user.name, 'Bob');

  // 3. Mutating deeply nested object should trigger onChange
  state.user.profile.age = 26;
  assert.strictEqual(changeCount, 2);
  assert.strictEqual(state.user.profile.age, 26);

  // 4. Mutating nested array should trigger onChange
  state.tags.push('web');
  assert.strictEqual(changeCount, 3);
  assert.deepStrictEqual([...state.tags], ['js', 'reactive', 'web']);

  // 5. Deleting nested property should trigger onChange
  delete state.user.profile.age;
  assert.strictEqual(changeCount, 4);
  assert.strictEqual(state.user.profile.age, undefined);

  console.log('  ✅ Component state deep reactivity tests passed!');
}

/**
 *
 */
function testReferentialIdentity() {
  console.log('🧪 Testing preservation of referential identity...');

  const state = new StateFactory().create({
    user: { name: 'Alice' },
  });

  const firstAccess = state.user;
  const secondAccess = state.user;

  // Verify that the exact same Proxy wrapper is returned
  assert.strictEqual(firstAccess, secondAccess, 'Should return cached proxy for the same object reference');

  console.log('  ✅ Referential identity tests passed!');
}

/**
 *
 */
function testProxyUnwrapping() {
  console.log('🧪 Testing proxy unwrapping on assignment...');

  const state = new StateFactory().create({
    user1: { name: 'Alice' },
    user2: null,
  });

  // Accessing user1 returns a proxy
  const user1Proxy = state.user1;

  // Assigning user1 proxy to user2
  state.user2 = user1Proxy;

  // Check that we don't double proxy or accumulate proxies in target raw structure.
  // The target of user2 should be the raw object of user1.
  // We verify by changing state.user2.name and seeing it mutate the underlying object.
  state.user2.name = 'Charlie';
  assert.strictEqual(state.user1.name, 'Charlie');

  console.log('Proxy unwrapping tests passed!');
}

/**
 *
 */
function testSymbolKeysAreNotTracked() {
  console.log('Testing symbol keys are not tracked');

  const symbolKey = Symbol('private');
  let watcherCount = 0;
  const state = new StateFactory().create({
    [symbolKey]: 'hidden',
  });

  const watcher = new AvenxWatcher(
    () => state[symbolKey],
    () => {
      watcherCount++;
    },
  );

  assert.strictEqual(watcher.value, 'hidden');

  delete state[symbolKey];

  assert.strictEqual(watcherCount, 0);

  console.log('Symbol key tracking tests passed!');
}

/**
 *
 */
function testSymbolKeysDoNotTriggerUpdates() {
  console.log('Testing symbol keys do not trigger updates');

  const symbolKey = Symbol('private');
  let changeCount = 0;
  let watcherCount = 0;
  const state = new StateFactory().create(
    {
      visible: 'shown',
      [symbolKey]: 'hidden',
    },
    {
      onChange: () => {
        changeCount++;
      },
    },
  );

  new AvenxWatcher(
    () => state.visible,
    () => {
      watcherCount++;
    },
  );

  state[symbolKey] = 'updated';

  assert.strictEqual(state[symbolKey], 'updated');
  assert.strictEqual(changeCount, 0);
  assert.strictEqual(watcherCount, 0);

  state.visible = 'changed';
  assert.strictEqual(changeCount, 1);
  assert.strictEqual(watcherCount, 1);

  console.log('Symbol key update tests passed!');
}

/**
 *
 */
async function testBridgeDeepReactivity() {
  console.log('🧪 Testing deep reactivity on global bridges...');

  const app = new AvenxApp({ target: '#app' });

  // Register a bridge with nested objects
  app.registerBridge('config', {
    theme: {
      dark: true,
      colors: {
        primary: 'blue',
      },
    },
    toggleTheme() {
      this.theme.dark = !this.theme.dark;
    },
  });

  const bridge = app.bridges.config;

  let colorWatcherCount = 0;
  let themeWatcherCount = 0;

  new AvenxWatcher(
    () => bridge.theme.colors.primary,
    () => {
      colorWatcherCount++;
    },
  );

  new AvenxWatcher(
    () => bridge.theme.dark,
    () => {
      themeWatcherCount++;
    },
  );

  // Mutating nested property triggers the color watcher
  bridge.theme.colors.primary = 'red';
  assert.strictEqual(colorWatcherCount, 1);
  assert.strictEqual(themeWatcherCount, 0);

  // Calling bridge method which mutates nested state triggers theme watcher
  bridge.toggleTheme();
  assert.strictEqual(colorWatcherCount, 1);
  assert.strictEqual(themeWatcherCount, 1);
  assert.strictEqual(bridge.theme.dark, false);

  console.log('  ✅ Global bridge deep reactivity tests passed!');
}

/**
 *
 */
function testBuiltinsAreNotProxied() {
  console.log('🧪 Testing that built-ins are not proxied...');

  const date = new Date(2026, 5, 23);
  const set = new Set([1, 2, 3]);

  const state = new StateFactory().create({
    time: date,
    numbers: set,
  });

  // Verify that accessed properties are the exact original instances (no proxies)
  assert.strictEqual(state.time, date);
  assert.strictEqual(state.numbers, set);

  // Calling methods on them should work exactly as normal without throwing
  assert.strictEqual(state.time.getFullYear(), 2026);
  assert.strictEqual(state.numbers.has(2), true);

  console.log('  ✅ Built-ins are not proxied tests passed!');
}

/**
 * Verifies that assigning a reactive proxy to another state property doesn't create a double proxy layer.
 */
function testDoubleWrappingPrevention() {
  console.log('🧪 Testing prevention of double wrapping for reactive proxies...');

  let changeCount = 0;
  const state = new StateFactory().create(
    {
      child1: { a: 1 },
      child2: { b: 2 },
    },
    {
      onChange: () => changeCount++,
    },
  );

  state.child1 = state.child2;

  assert.strictEqual(state.child1, state.child2, 'The proxies should be identical (no double wrapping)');

  changeCount = 0;

  state.child1.b = 3;
  assert.strictEqual(changeCount, 1, 'Mutating the assigned proxy should trigger only 1 update, not 2');
  assert.strictEqual(state.child2.b, 3, 'Mutation should reflect in the original proxy');

  console.log('  ✅ Double wrapping prevention tests passed!');
}

(async () => {
  try {
    testIsReactiveTarget();
    testStateDeepReactivity();
    testReferentialIdentity();
    testProxyUnwrapping();
    testSymbolKeysAreNotTracked();
    testSymbolKeysDoNotTriggerUpdates();
    await testBridgeDeepReactivity();
    testBuiltinsAreNotProxied();
    testDoubleWrappingPrevention();
    console.log('✅ All reactivity tests passed!');
  } catch (error) {
    console.error('❌ Reactivity tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
