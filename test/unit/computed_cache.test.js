const assert = require('assert');
const { StateFactory } = require('../../lib/core/reactive/createState');

/**
 *
 */
function testComputedCachingAndInvalidation() {
  console.log('🧪 Testing computed property caching...');

  let evaluations = 0;
  const initialState = {
    count: 5,
    other: 10,
  };

  const state = new StateFactory().create(initialState, {
    computedKeys: ['double'],
    getComputedValue: (key, stateProxy) => {
      if (key === 'double') {
        evaluations++;
        return stateProxy.count * 2;
      }
    },
  });

  // 1. Initial read should evaluate the computed property
  assert.strictEqual(state.double, 10);
  assert.strictEqual(evaluations, 1);

  // 2. Subsequent read of the same key should return cached value
  assert.strictEqual(state.double, 10);
  assert.strictEqual(evaluations, 1);

  // 3. Mutating unrelated property should not invalidate computed property
  state.other = 20;
  assert.strictEqual(state.double, 10);
  assert.strictEqual(evaluations, 1);

  // 4. Mutating dependency should invalidate and force re-evaluation on next read
  state.count = 6;
  assert.strictEqual(evaluations, 1); // lazy evaluation
  assert.strictEqual(state.double, 12);
  assert.strictEqual(evaluations, 2);

  // 5. Subsequent read returns cached value again
  assert.strictEqual(state.double, 12);
  assert.strictEqual(evaluations, 2);

  console.log('  ✅ Computed property caching tests passed!');
}

/**
 *
 */
function testNestedDependencyInvalidation() {
  console.log('🧪 Testing computed dependency on nested state...');

  let evaluations = 0;
  const initialState = {
    user: {
      name: 'Alice',
      profile: {
        age: 25,
      },
    },
  };

  const state = new StateFactory().create(initialState, {
    computedKeys: ['userInfo'],
    getComputedValue: (key, stateProxy) => {
      if (key === 'userInfo') {
        evaluations++;
        return `${stateProxy.user.name}: ${stateProxy.user.profile.age}`;
      }
    },
  });

  assert.strictEqual(state.userInfo, 'Alice: 25');
  assert.strictEqual(evaluations, 1);

  // Read again, should cache
  assert.strictEqual(state.userInfo, 'Alice: 25');
  assert.strictEqual(evaluations, 1);

  // Mutate deeply nested property, should invalidate
  state.user.profile.age = 26;
  assert.strictEqual(state.userInfo, 'Alice: 26');
  assert.strictEqual(evaluations, 2);

  // Mutate intermediate nested property, should invalidate
  state.user.name = 'Bob';
  assert.strictEqual(state.userInfo, 'Bob: 26');
  assert.strictEqual(evaluations, 3);

  console.log('  ✅ Nested computed dependency invalidation tests passed!');
}

/**
 *
 */
function testMultiLevelComputed() {
  console.log('🧪 Testing multi-level computed properties dependency...');

  let doubleEvals = 0;
  let quadEvals = 0;
  const initialState = {
    count: 2,
  };

  const state = new StateFactory().create(initialState, {
    computedKeys: ['double', 'quad'],
    getComputedValue: (key, stateProxy) => {
      if (key === 'double') {
        doubleEvals++;
        return stateProxy.count * 2;
      }
      if (key === 'quad') {
        quadEvals++;
        return stateProxy.double * 2;
      }
    },
  });

  // 1. Read quad
  assert.strictEqual(state.quad, 8);
  assert.strictEqual(doubleEvals, 1);
  assert.strictEqual(quadEvals, 1);

  // 2. Read quad again (should cache both)
  assert.strictEqual(state.quad, 8);
  assert.strictEqual(doubleEvals, 1);
  assert.strictEqual(quadEvals, 1);

  // 3. Mutate target.count
  state.count = 3;
  assert.strictEqual(state.quad, 12);
  assert.strictEqual(doubleEvals, 2);
  assert.strictEqual(quadEvals, 2);

  console.log('  ✅ Multi-level computed properties invalidation tests passed!');
}

/**
 *
 */
function testArrayMutations() {
  console.log('🧪 Testing computed property dependency on arrays...');

  let evaluations = 0;
  const initialState = {
    items: [1, 2, 3],
  };

  const state = new StateFactory().create(initialState, {
    computedKeys: ['itemCount'],
    getComputedValue: (key, stateProxy) => {
      if (key === 'itemCount') {
        evaluations++;
        return stateProxy.items.length;
      }
    },
  });

  assert.strictEqual(state.itemCount, 3);
  assert.strictEqual(evaluations, 1);

  // Array push should invalidate computed property
  state.items.push(4);
  assert.strictEqual(state.itemCount, 4);
  assert.strictEqual(evaluations, 2);

  // Array pop should invalidate
  state.items.pop();
  assert.strictEqual(state.itemCount, 3);
  assert.strictEqual(evaluations, 3);

  console.log('  ✅ Array mutation invalidation tests passed!');
}

try {
  testComputedCachingAndInvalidation();
  testNestedDependencyInvalidation();
  testMultiLevelComputed();
  testArrayMutations();
  console.log('✅ All computed property caching tests passed!');
} catch (error) {
  console.error('❌ Computed property caching tests failed!');
  console.error(error);
  process.exit(1);
}
