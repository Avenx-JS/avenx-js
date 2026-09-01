import assert from 'assert';
import { Resource } from '../../lib/core/reactive/Resource.js';

async function testOutOfOrderRaceCondition() {
  console.log('🧪 Testing Resource out-of-order race condition guard...');
  let resolveFirst;
  let resolveSecond;
  let callCount = 0;

  const handler = () => {
    callCount++;
    if (callCount === 1) {
      return new Promise((res) => { resolveFirst = res; });
    }
    return new Promise((res) => { resolveSecond = res; });
  };

  const resource = new Resource('testResource', handler, {});
  resource.refetch();

  resolveSecond('latest-result');
  await Promise.resolve();

  assert.strictEqual(resource.status, 'resolved');
  assert.strictEqual(resource.value, 'latest-result');

  resolveFirst('stale-first-result');
  await Promise.resolve();

  assert.strictEqual(resource.value, 'latest-result');
  console.log('  ✅ Race condition guard passed!');
}

function testAbortSignal() {
  console.log('🧪 Testing AbortController signal support...');
  const signals = [];
  const handler = (signal) => {
    signals.push(signal);
    return new Promise(() => {});
  };

  const resource = new Resource('abortTest', handler, {});
  assert.strictEqual(signals.length, 1);
  assert.strictEqual(signals[0].aborted, false);

  resource.refetch();
  assert.strictEqual(signals.length, 2);
  assert.strictEqual(signals[0].aborted, true);
  assert.strictEqual(signals[1].aborted, false);
  console.log('  ✅ AbortSignal propagation passed!');
}

function testMutateAPI() {
  console.log('🧪 Testing Resource.mutate() API...');
  let callCount = 0;
  const handler = () => {
    callCount++;
    return 'initial';
  };

  let updateCalled = false;
  const mockContext = {
    renderWatcher: { dirty: false },
    update: () => { updateCalled = true; },
  };

  const resource = new Resource('mutateTest', handler, mockContext);
  const countBefore = callCount;

  resource.mutate('optimistic-value');

  assert.strictEqual(resource.value, 'optimistic-value');
  assert.strictEqual(resource.status, 'resolved');
  assert.strictEqual(resource.loading, false);
  assert.strictEqual(callCount, countBefore);
  assert.strictEqual(mockContext.renderWatcher.dirty, true);
  assert.strictEqual(updateCalled, true);
  console.log('  ✅ mutate() API passed!');
}

async function testNonThrowingAccessors() {
  console.log('🧪 Testing non-throwing status accessors...');
  let rejectPromise;
  const handler = () => new Promise((_, rej) => { rejectPromise = rej; });

  const resource = new Resource('statusTest', handler, {});

  assert.strictEqual(resource.loading, true);
  assert.strictEqual(resource.status, 'pending');
  assert.strictEqual(resource.error, undefined);

  const testError = new Error('network failed');
  rejectPromise(testError);
  await Promise.resolve();

  assert.strictEqual(resource.loading, false);
  assert.strictEqual(resource.status, 'rejected');
  assert.strictEqual(resource.error, testError);
  console.log('  ✅ Non-throwing accessors passed!');
}

async function testTeardown() {
  console.log('🧪 Testing Resource teardown...');
  let resolvePromise;
  const handler = () => new Promise((res) => { resolvePromise = res; });

  const resource = new Resource('teardownTest', handler, {});
  resource.teardown();

  resolvePromise('resolved-after-teardown');
  await Promise.resolve();

  assert.strictEqual(resource.status, 'pending');
  assert.strictEqual(resource.value, undefined);
  console.log('  ✅ Teardown cleanup passed!');
}

async function runTests() {
  try {
    await testOutOfOrderRaceCondition();
    testAbortSignal();
    testMutateAPI();
    await testNonThrowingAccessors();
    await testTeardown();
    console.log('✅ All Resource tests passed successfully!');
  } catch (error) {
    console.error('❌ Resource tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
