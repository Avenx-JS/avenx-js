import { performance } from 'perf_hooks';
import { StateFactory } from '../lib/core/reactive/createState.js';
import { AvenxWatcher } from '../lib/core/reactive/watcher.js';

/**
 * Runs benchmarks on the reactivity core.
 */
function benchmark() {
  const iterations = 50000;
  const stateFactory = new StateFactory();

  console.log(`Running Reactivity benchmark with ${iterations} iterations...`);

  // 1. State creation
  const startCreate = performance.now();
  for (let i = 0; i < iterations; i++) {
    stateFactory.create({ a: 1, b: { c: 2 } });
  }
  const endCreate = performance.now();
  const createTime = endCreate - startCreate;

  // 2. State mutation & Deep updates triggering watchers
  const state = stateFactory.create({
    count: 0,
    nested: { value: 100 },
  });

  let watcherTriggerCount = 0;
  const watcher = new AvenxWatcher(
    () => state.nested.value + state.count,
    () => {
      watcherTriggerCount++;
    }
  );

  const startMutate = performance.now();
  for (let i = 0; i < iterations; i++) {
    state.count++;
    state.nested.value += 2;
  }
  const endMutate = performance.now();
  const mutateTime = endMutate - startMutate;
  watcher.teardown();

  // 3. Computed-like caching (AvenxWatcher with lazy = true)
  const computedState = stateFactory.create({ x: 10, y: 20 });
  const computedWatcher = new AvenxWatcher(
    () => computedState.x + computedState.y,
    null,
    { lazy: true }
  );

  // Cached read hits (value doesn't change, read repeatedly)
  const startCachedRead = performance.now();
  for (let i = 0; i < iterations; i++) {
    computedWatcher.evaluate();
  }
  const endCachedRead = performance.now();
  const cachedReadTime = endCachedRead - startCachedRead;

  // Dirty invalidation & re-eval (mutation, then read)
  const startDirtyRead = performance.now();
  for (let i = 0; i < iterations / 10; i++) {
    computedState.x++;
    computedWatcher.evaluate();
  }
  const endDirtyRead = performance.now();
  const dirtyReadTime = (endDirtyRead - startDirtyRead) * 10; // Scale to match iterations count
  computedWatcher.teardown();

  const totalTime = createTime + mutateTime + cachedReadTime + dirtyReadTime;
  const avgTime = totalTime / iterations;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per operation: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
  console.log(`  - State Creation: ${createTime.toFixed(2)}ms`);
  console.log(`  - Mutation & Watchers: ${mutateTime.toFixed(2)}ms`);
  console.log(`  - Cached reads: ${cachedReadTime.toFixed(2)}ms`);
  console.log(`  - Invalidation + reads: ${dirtyReadTime.toFixed(2)}ms`);
}

benchmark();
