import assert from 'assert';
import { EventBinder } from '../../lib/core/events/bindEvents.js';
import { EventExecutor } from '../../lib/core/events/eventExecutor.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

// Override WeakMap to track active keys
const originalWeakMap = global.WeakMap;
const trackedWeakMaps = [];
global.WeakMap = class TrackedWeakMap {
  constructor() {
    this.map = new originalWeakMap();
    this.keys = new Set();
    trackedWeakMaps.push(this);
  }
  set(key, val) {
    this.keys.add(key);
    return this.map.set(key, val);
  }
  delete(key) {
    this.keys.delete(key);
    return this.map.delete(key);
  }
  get(key) {
    return this.map.get(key);
  }
  has(key) {
    return this.map.has(key);
  }
};

try {
  console.log('🧪 Testing event delegation memory leak prevention...');

  // 1. Test EventExecutor teardown
  console.log('  Testing EventExecutor.teardown()...');
  let called = false;
  const executor = new EventExecutor(() => { called = true; });
  executor.execute('dummy');
  assert.strictEqual(called, true, 'Should run handler initially');

  executor.teardown();
  assert.strictEqual(executor.runHandler, null, 'runHandler should be nullified after teardown');
  assert.throws(() => executor.execute('dummy'), TypeError, 'Should throw since handler is null');

  // 2. Test EventBinder teardown
  console.log('  Testing EventBinder.teardown()...');
  const binder = new EventBinder();
  
  // Create a real DOM element
  const el = document.createElement('button');
  el.setAttribute('@click', 'doSomething');
  binder.bind(el, executor);

  // Verify elements are tracked in the binder's WeakMap
  const mapsWithKeys = trackedWeakMaps.filter(m => m.keys.size > 0);
  assert.ok(mapsWithKeys.length > 0, 'WeakMaps should track some keys after binding');

  // Perform teardown
  binder.teardown();

  // Verify tracked keys are no longer present or maps are reset
  // After teardown, #boundEvents and #onceExecuted are reset to new empty WeakMaps.
  // The newly created WeakMaps should have 0 tracked keys initially.
  const activeWeakMapsAfterTeardown = trackedWeakMaps.slice(mapsWithKeys.length);
  activeWeakMapsAfterTeardown.forEach(m => {
    assert.strictEqual(m.keys.size, 0, 'New WeakMap should be empty after teardown');
  });

  // 3. Test unmount component teardown flow
  console.log('  Testing component unmount teardown...');
  const comp = new AvenxComponent(
    { count: 0 },
    {},
    {},
    `<button id="btn" @click="count++">Increment</button>`,
    {},
  );
  
  // Set up a real target element
  const target = document.createElement('div');

  comp.__setMountTarget(target);
  comp.update();

  // Unmount
  comp.unmount();

  // Verify that target internal references are cleaned up
  assert.strictEqual(target.__avenx_comp_instance, undefined, 'Component instance reference should be cleaned from DOM element');

  console.log('  ✅ Event delegation memory leak prevention tests passed!');
} catch (error) {
  console.error('❌ Event delegation memory leak prevention tests failed!');
  console.error(error);
  process.exit(1);
} finally {
  // Restore original WeakMap to prevent breaking other tests
  global.WeakMap = originalWeakMap;
}
