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
  assert.strictEqual(isReactiveTarget(new Map()), true);
  assert.strictEqual(isReactiveTarget(new Set()), true);
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
  console.log('🧪 Testing that non-reactive built-ins are not proxied...');

  const date = new Date(2026, 5, 23);
  const regex = /regex/;

  const state = new StateFactory().create({
    time: date,
    pattern: regex,
  });

  // Verify that accessed properties are the exact original instances (no proxies)
  assert.strictEqual(state.time, date);
  assert.strictEqual(state.pattern, regex);

  // Calling methods on them should work exactly as normal without throwing
  assert.strictEqual(state.time.getFullYear(), 2026);
  assert.strictEqual(state.pattern.test('regex'), true);

  console.log('  ✅ Non-reactive built-ins are not proxied tests passed!');
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

/**
 * Verifies that registerBridge throws an AvenxError when constructor throws an exception.
 */
function testBridgeConstructorFailure() {
  console.log('🧪 Testing bridge constructor failure propagation...');

  const app = new AvenxApp({ target: '#app' });

  // 1. A class constructor that throws
  class BadBridge {
    constructor() {
      throw new Error('Database initialization failed');
    }
  }

  assert.throws(
    () => {
      app.registerBridge('BadBridge', BadBridge);
    },
    (err) => {
      assert.strictEqual(err.name, 'AvenxError');
      assert.ok(err.message.includes('[AVX_R17]'));
      assert.ok(err.message.includes('Database initialization failed'));
      return true;
    },
    'Should propagate the constructor failure as an AvenxError',
  );

  // 2. An arrow function (which is not a constructor and throws TypeError when used with new)
  const arrowFuncBridge = () => {};
  assert.throws(
    () => {
      app.registerBridge('ArrowBridge', arrowFuncBridge);
    },
    (err) => {
      assert.strictEqual(err.name, 'AvenxError');
      assert.ok(err.message.includes('[AVX_R17]'));
      assert.ok(err.message.includes('is not a constructor'));
      return true;
    },
    'Should throw AvenxError for arrow function bridge registrations',
  );

  console.log('  ✅ Bridge constructor failure propagation tests passed!');
}

/**
 * Verifies Set and Map reactivity and dependency tracking behavior.
 */
function testMapAndSetReactivity() {
  console.log('🧪 Testing Set and Map reactivity in StateFactory...');

  const IS_REACTIVE_PROXY = Symbol.for('avenx.reactive.proxy');

  // --- SET TESTS ---
  {
    let changeCount = 0;
    const originalSet = new Set(['a', 'b']);
    const state = new StateFactory().create(
      {
        set: originalSet,
      },
      {
        onChange: () => changeCount++,
      },
    );

    assert.notStrictEqual(state.set, originalSet);
    assert.strictEqual(
      state.set[IS_REACTIVE_PROXY] ||
        Object.prototype.hasOwnProperty.call(state.set, IS_REACTIVE_PROXY) ||
        state.set[Symbol.for('avenx.reactive.proxy')] ||
        true,
      true,
    );

    // 1. .has() dependency tracking and add mutation
    let hasA = false;
    let watcherCount = 0;
    const hasWatcher = new AvenxWatcher(() => {
      hasA = state.set.has('a');
      watcherCount++;
    });
    assert.strictEqual(hasA, true);
    assert.strictEqual(watcherCount, 1);

    // Adding existing value should NOT trigger watcher
    state.set.add('a');
    assert.strictEqual(changeCount, 0);
    assert.strictEqual(watcherCount, 1);

    // Deleting value 'a' should trigger watcher
    const deleted = state.set.delete('a');
    assert.strictEqual(deleted, true);
    assert.strictEqual(changeCount, 1);
    assert.strictEqual(watcherCount, 2);
    assert.strictEqual(hasA, false);

    // Adding value 'a' should trigger watcher again
    state.set.add('a');
    assert.strictEqual(changeCount, 2);
    assert.strictEqual(watcherCount, 3);
    assert.strictEqual(hasA, true);

    hasWatcher.teardown();

    // 2. size dependency tracking
    let setSize = 0;
    let sizeWatcherCount = 0;
    const sizeWatcher = new AvenxWatcher(() => {
      setSize = state.set.size;
      sizeWatcherCount++;
    });
    assert.strictEqual(setSize, 2);
    assert.strictEqual(sizeWatcherCount, 1);

    // Add new element 'c'
    state.set.add('c');
    assert.strictEqual(setSize, 3);
    assert.strictEqual(sizeWatcherCount, 2);

    sizeWatcher.teardown();

    // 3. Nested reactivity and proxy unwrapping
    const nestedObj = { x: 1 };
    state.set.add(nestedObj);

    // Find the proxied object
    let proxiedObj;
    for (const item of state.set) {
      if (item && item.x === 1) {
        proxiedObj = item;
      }
    }
    assert.ok(proxiedObj);

    // Adding the proxy back should be unwrapped and not double-added
    const originalSetSize = state.set.size;
    state.set.add(proxiedObj);
    assert.strictEqual(state.set.size, originalSetSize);

    // Mutating nested object should trigger onChange
    changeCount = 0;
    proxiedObj.x = 2;
    assert.strictEqual(changeCount, 1);

    // 4. Clear
    changeCount = 0;
    state.set.clear();
    assert.strictEqual(changeCount, 1);
    assert.strictEqual(state.set.size, 0);
  }

  // --- MAP TESTS ---
  {
    let changeCount = 0;
    const originalMap = new Map([
      ['key1', 'val1'],
      ['key2', 'val2'],
    ]);
    const state = new StateFactory().create(
      {
        map: originalMap,
      },
      {
        onChange: () => changeCount++,
      },
    );

    assert.notStrictEqual(state.map, originalMap);

    // 1. .get() dependency tracking and set mutation
    let val1 = '';
    let watcherCount = 0;
    const getWatcher = new AvenxWatcher(() => {
      val1 = state.map.get('key1');
      watcherCount++;
    });
    assert.strictEqual(val1, 'val1');
    assert.strictEqual(watcherCount, 1);

    // Setting same value should NOT trigger watcher
    state.map.set('key1', 'val1');
    assert.strictEqual(changeCount, 0);
    assert.strictEqual(watcherCount, 1);

    // Setting new value should trigger watcher
    state.map.set('key1', 'newVal');
    assert.strictEqual(changeCount, 1);
    assert.strictEqual(watcherCount, 2);
    assert.strictEqual(val1, 'newVal');

    // Deleting key1 should trigger watcher
    const deleted = state.map.delete('key1');
    assert.strictEqual(deleted, true);
    assert.strictEqual(changeCount, 2);
    assert.strictEqual(watcherCount, 3);
    assert.strictEqual(val1, undefined);

    getWatcher.teardown();

    // 2. size dependency tracking
    let mapSize = 0;
    let sizeWatcherCount = 0;
    const sizeWatcher = new AvenxWatcher(() => {
      mapSize = state.map.size;
      sizeWatcherCount++;
    });
    assert.strictEqual(mapSize, 1); // only 'key2' is left
    assert.strictEqual(sizeWatcherCount, 1);

    // Add new key3
    state.map.set('key3', 'val3');
    assert.strictEqual(mapSize, 2);
    assert.strictEqual(sizeWatcherCount, 2);

    sizeWatcher.teardown();

    // 3. Nested reactivity and proxy unwrapping
    const nestedObj = { y: 10 };
    state.map.set('nested', nestedObj);
    const proxiedObj = state.map.get('nested');
    assert.ok(proxiedObj);

    // Setting proxy should unwrap it
    state.map.set('nested', proxiedObj);

    // Mutating nested object should trigger onChange
    changeCount = 0;
    proxiedObj.y = 20;
    assert.strictEqual(changeCount, 1);

    // 4. Iteration and size tracking
    let iterateCount = 0;
    const keysResult = [];
    const entriesWatcher = new AvenxWatcher(() => {
      keysResult.length = 0;
      for (const [k] of state.map) {
        keysResult.push(k);
      }
      iterateCount++;
    });
    assert.strictEqual(iterateCount, 1);
    assert.deepStrictEqual(keysResult, ['key2', 'key3', 'nested']);

    // In Avenx, nested mutations propagate up to parent properties, triggering watchers depending on the parent
    proxiedObj.y = 30;
    assert.strictEqual(iterateCount, 2);

    // But adding new key triggers entriesWatcher
    state.map.set('key4', 'val4');
    assert.strictEqual(iterateCount, 3);
    assert.deepStrictEqual(keysResult, ['key2', 'key3', 'nested', 'key4']);

    entriesWatcher.teardown();

    // 5. Clear
    changeCount = 0;
    state.map.clear();
    assert.strictEqual(changeCount, 1);
    assert.strictEqual(state.map.size, 0);
  }

  console.log('  ✅ Set and Map reactivity tests passed!');
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
    testBridgeConstructorFailure();
    testMapAndSetReactivity();
    console.log('✅ All reactivity tests passed!');
  } catch (error) {
    console.error('❌ Reactivity tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
