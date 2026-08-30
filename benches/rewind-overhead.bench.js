import { performance } from 'perf_hooks';
import { StateFactory } from '../lib/core/reactive/createState.js';
import { AvenxWatcher } from '../lib/core/reactive/watcher.js';
import { journal } from '../lib/core/reactive/journal.js';
import { logger } from '../lib/core/runtime/AvenxLogger.js';

/**
 * Measures what Avenx Rewind costs.
 *
 * Three numbers, and they are three different promises:
 *
 * 1. **No transaction open.** This has to be free, because it is what every
 *    write in every application pays whether or not the project uses an atomic
 *    action anywhere. Each mutation site is guarded by a single boolean read
 *    of `journal.active`, and this benchmark is what would notice if that ever
 *    stopped being true. It is the number that decides whether the feature
 *    ships at all.
 *
 * 2. **Inside a transaction.** Allowed to cost something — the journal is
 *    doing real work — but it has to stay well inside what a click can afford.
 *
 * 3. **Collection savepoints.** The one place the cost is not per-write: a
 *    mutating array method copies the array once per transaction, so the price
 *    scales with the collection rather than with the number of calls. This is
 *    what `rewind.maxSnapshotItems` exists to bound, and this benchmark is how
 *    its default was chosen.
 *
 * As with the trace benchmark, note what this is: a tight loop of state writes
 * with no rendering and no DOM. That isolates the journal, which is what a
 * microbenchmark should do — and it makes the percentages a worst case rather
 * than something a developer would feel, because in a real application render
 * and patch work dominate.
 */
function benchmark() {
  const iterations = 50000;
  const stateFactory = new StateFactory();

  console.log(`Running Rewind Overhead benchmark with ${iterations} iterations...`);

  // The rewinds below are deliberately conflict-free, but a benchmark should
  // not depend on that to stay quiet.
  const originalError = logger.error;
  logger.error = () => {};

  /**
   * The hot path: writes propagating through a watcher.
   * @param {object} state - Reactive state to drive.
   * @param {number} count - How many writes to make.
   */
  const drive = (state, count) => {
    for (let i = 0; i < count; i++) {
      state.count = i;
      state.nested.value = i;
    }
  };

  /**
   * Builds a fresh state object with one watcher attached.
   * @returns {{state: object, watcher: AvenxWatcher}} The pair.
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
  drive(warm.state, iterations);
  warm.watcher.teardown();

  // 1. No transaction open — the path every application takes on every write.
  const idle = setup();
  const startIdle = performance.now();
  drive(idle.state, iterations);
  const idleTime = performance.now() - startIdle;
  idle.watcher.teardown();

  // 2. Inside a transaction that commits.
  const open = setup();
  const startOpen = performance.now();
  journal.run({ owner: 'Bench', name: 'commit' }, () => {
    drive(open.state, iterations);
  });
  const openTime = performance.now() - startOpen;
  open.watcher.teardown();

  // 3. The same work, rewound. Two keys are journaled however many times they
  //    are written, so the rewind itself is cheap by construction — which is
  //    the property worth guarding.
  const rolled = setup();
  const startRewind = performance.now();
  try {
    journal.run({ owner: 'Bench', name: 'rollback' }, () => {
      drive(rolled.state, iterations);
      throw new Error('rollback');
    });
  } catch {
    // expected
  }
  const rewindTime = performance.now() - startRewind;
  rolled.watcher.teardown();

  // 4. Collection savepoints across a range of sizes.
  const collectionSizes = [100, 1000, 10000];
  const collectionRows = [];
  for (const size of collectionSizes) {
    const state = stateFactory.create({ rows: Array.from({ length: size }, (_, i) => i) });
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      try {
        journal.run({ owner: 'Bench', name: 'collection' }, () => {
          state.rows.push(i);
          throw new Error('rollback');
        });
      } catch {
        // expected
      }
    }
    collectionRows.push({ size, ms: performance.now() - start });
  }

  logger.error = originalError;

  const writes = iterations * 2;
  const openOverhead = idleTime > 0 ? ((openTime - idleTime) / idleTime) * 100 : 0;
  const rewindOverhead = idleTime > 0 ? ((rewindTime - idleTime) / idleTime) * 100 : 0;

  console.log('\n--- Results ---');
  console.log(`Writes:                    ${writes}`);
  console.log(`No transaction open:       ${idleTime.toFixed(2)}ms`);
  console.log(`Inside a transaction:      ${openTime.toFixed(2)}ms  (+${openOverhead.toFixed(1)}%)`);
  console.log(`Transaction + rewind:      ${rewindTime.toFixed(2)}ms  (+${rewindOverhead.toFixed(1)}%)`);
  console.log('\n--- Collection savepoints (200 transactions, one push each) ---');
  for (const row of collectionRows) {
    console.log(`  ${String(row.size).padStart(6)} entries:        ${row.ms.toFixed(2)}ms`);
  }
  console.log(`\nTotal time: ${(idleTime + openTime + rewindTime).toFixed(2)}ms`);
  console.log(`Average time per write: ${(idleTime / writes).toFixed(6)}ms`);
  console.log(`Ops/sec: ${Math.round(writes / (idleTime / 1000))}`);

  if (journal.active) {
    throw new Error('Benchmark finished with a transaction still open.');
  }
}

benchmark();
