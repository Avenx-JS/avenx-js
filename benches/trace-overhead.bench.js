import { performance } from 'perf_hooks';
import { StateFactory } from '../lib/core/reactive/createState.js';
import { AvenxWatcher } from '../lib/core/reactive/watcher.js';
import { tracer } from '../lib/core/trace/tracer.js';
import { startRecording, stopRecording } from '../lib/core/trace/recorder.js';
import { TraceNodeType } from '../lib/core/trace/schema.js';

/**
 * Measures what tracing costs.
 *
 * Two numbers matter, and they are very different promises:
 *
 * 1. **Tracing off.** This has to be free, because it is what every application
 *    and every production build runs. Each instrumented site is guarded by a
 *    single boolean read, and this benchmark is what would notice if that ever
 *    stopped being true.
 *
 * 2. **Tracing on.** This is allowed to cost something — it is a development
 *    tool doing real work — but it has to stay usable.
 *
 * Note what this benchmark is: a tight loop of state writes with no rendering,
 * no DOM and no user think-time. That makes the recorder the entire cost, which
 * is exactly what a microbenchmark should isolate — and exactly why the number
 * it produces is a worst case rather than what a developer feels. In a real
 * application, render and patch work dominate and the recorder's share
 * disappears into it. The docs quote both, and so should anyone citing this.
 */
function benchmark() {
  const iterations = 50000;
  const stateFactory = new StateFactory();

  console.log(`Running Trace Overhead benchmark with ${iterations} iterations...`);

  /**
   * The hot path: writes propagating through a watcher.
   * @param {object} state - Reactive state to drive.
   */
  const drive = (state) => {
    for (let i = 0; i < iterations; i++) {
      state.count = i;
      state.nested.value = i;
    }
  };

  /**
   * Builds a fresh state object with one watcher attached.
   * @returns {{state: object, watcher: AvenxWatcher}}
   */
  const setup = () => {
    const state = stateFactory.create({ count: 0, nested: { value: 0 } });
    const watcher = new AvenxWatcher(
      () => state.nested.value + state.count,
      () => {},
      { name: 'Bench#render' },
    );
    return { state, watcher };
  };

  // Warm up, so the first measured run is not paying for JIT.
  const warm = setup();
  drive(warm.state);
  warm.watcher.teardown();

  // 1. Tracing off — the path every production build takes.
  const off = setup();
  const startOff = performance.now();
  drive(off.state);
  const offTime = performance.now() - startOff;
  off.watcher.teardown();

  // 2. Tracing on — a development session recording as it goes.
  const on = setup();
  const recorder = startRecording({ maxNodes: 5000 });
  recorder.arm();
  const token = tracer.enter(TraceNodeType.EVENT, { eventType: 'bench' });
  const startOn = performance.now();
  drive(on.state);
  const onTime = performance.now() - startOn;
  tracer.leave(token);
  stopRecording();
  on.watcher.teardown();

  // 3. Serializing what was recorded, which a developer pays once per save.
  const startSerialize = performance.now();
  const serialized = recorder.serialize();
  const serializeTime = performance.now() - startSerialize;

  const writes = iterations * 2;
  const overhead = offTime > 0 ? ((onTime - offTime) / offTime) * 100 : 0;

  console.log('\n--- Results ---');
  console.log(`Writes:                 ${writes}`);
  console.log(`Tracing OFF:            ${offTime.toFixed(2)}ms`);
  console.log(`Tracing ON:             ${onTime.toFixed(2)}ms`);
  console.log(`Overhead when tracing:  ${overhead.toFixed(1)}%  (worst case: writes only, no rendering)`);
  console.log(`Nodes retained:         ${recorder.nodes.length} (buffer 5000)`);
  console.log(`Nodes dropped:          ${recorder.dropped}`);
  console.log(`Serialized size:        ${(serialized.length / 1024).toFixed(1)} KB`);
  console.log(`Serialize time:         ${serializeTime.toFixed(2)}ms`);
  console.log(`Total time: ${(offTime + onTime).toFixed(2)}ms`);
  console.log(`Average time per write: ${(offTime / writes).toFixed(6)}ms`);
  console.log(`Ops/sec: ${Math.round(writes / (offTime / 1000))}`);

  if (tracer.on) {
    throw new Error('Benchmark finished with tracing still enabled.');
  }
}

benchmark();
