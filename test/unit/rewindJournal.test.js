import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { journal, JournalFrame, ConflictPolicy } from '../../lib/core/reactive/journal.js';
import { bridge, defineBridgeName } from '../../lib/core/runtime/bridge.js';
import { atomic, isAtomic, atomicOptions } from '../../lib/core/runtime/atomic.js';
import { AvenxWatcher } from '../../lib/core/reactive/watcher.js';
import { AvenxError, AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

const factory = new StateFactory();

/**
 * Creates a reactive state object outside of any component.
 * @param {object} initial - The initial value.
 * @returns {object} A reactive proxy.
 */
function reactive(initial) {
  return factory.create(initial);
}

/**
 * Runs a body inside a transaction that always fails, so the rewind runs.
 * @param {function(): any} body - What to do inside the transaction.
 * @param {object} [spec] - Frame options.
 * @returns {Error} The error the transaction threw.
 */
function rollback(body, spec = {}) {
  try {
    journal.run({ owner: 'Test', name: 'action', ...spec }, () => {
      body();
      throw new Error('rollback');
    });
  } catch (error) {
    return error;
  }
  throw new Error('the transaction was expected to fail');
}

/**
 * Captures whatever the logger reports while a body runs.
 * @param {function(): any} body - What to run.
 * @returns {string[]} The reported messages.
 */
function captureErrors(body) {
  const messages = [];
  const original = logger.error;
  logger.error = (...args) => messages.push(args.join(' '));
  try {
    body();
  } finally {
    logger.error = original;
  }
  return messages;
}

/**
 * Runs every case.
 * @returns {Promise<void>}
 */
async function run() {
  console.log('\n🧪 Running Avenx Rewind journal tests...\n');

  testInactiveByDefault();
  testScalarWrites();
  testNestedWrites();
  testAddedAndDeletedKeys();
  testRepeatedWritesKeepTheFirstSavepoint();
  testArrayMutations();
  testArrayLengthTruncation();
  testMapAndSet();
  testCommitKeepsWrites();
  await testPromiseOutcomes();
  testNestingJoinsOneFrame();
  testConflictPolicies();
  testSnapshotCeiling();
  testWatchersWakeOnRewind();
  testAtomicMarker();
  testAtomicBridgeAction();
  testStackIsRepairedAfterThrow();

  console.log('\n✅ Avenx Rewind journal tests passed.\n');
}

/**
 * With no transaction open the journal must be inert.
 * @returns {void}
 */
function testInactiveByDefault() {
  console.log('  Testing that the journal is inert with no transaction open...');
  journal.reset();
  assert.strictEqual(journal.active, false, 'the journal is inactive at rest');

  const state = reactive({ count: 0 });
  state.count = 5;
  assert.strictEqual(state.count, 5, 'an ordinary write is untouched');
  assert.strictEqual(journal.current(), null, 'no frame is opened by an ordinary write');
  console.log('  ✅ Inert until a transaction opens.');
}

/**
 * A failed transaction restores plain properties.
 * @returns {void}
 */
function testScalarWrites() {
  console.log('  Testing scalar rollback...');
  const state = reactive({ count: 1, label: 'a', flag: false });

  rollback(() => {
    state.count = 9;
    state.label = 'z';
    state.flag = true;
  });

  assert.strictEqual(state.count, 1, 'count is restored');
  assert.strictEqual(state.label, 'a', 'label is restored');
  assert.strictEqual(state.flag, false, 'flag is restored');
  console.log('  ✅ Scalars are restored.');
}

/**
 * Writes through a nested object are journaled at the level they happen.
 * @returns {void}
 */
function testNestedWrites() {
  console.log('  Testing nested rollback...');
  const state = reactive({ user: { profile: { name: 'ada', age: 36 } }, rows: [{ qty: 1 }] });

  rollback(() => {
    state.user.profile.name = 'grace';
    state.user.profile.age = 45;
    state.rows[0].qty = 7;
  });

  assert.strictEqual(state.user.profile.name, 'ada', 'a two-level nested write is restored');
  assert.strictEqual(state.user.profile.age, 36, 'a sibling nested write is restored');
  assert.strictEqual(state.rows[0].qty, 1, 'an element property is restored');
  console.log('  ✅ Nested writes are restored.');
}

/**
 * A key the transaction created must be removed, not set to undefined.
 * @returns {void}
 */
function testAddedAndDeletedKeys() {
  console.log('  Testing added and deleted keys...');
  const state = reactive({ present: 1 });

  rollback(() => {
    state.added = 'new';
    delete state.present;
  });

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(state, 'added'),
    false,
    'a key the transaction created is removed rather than left as undefined',
  );
  assert.strictEqual(state.present, 1, 'a deleted key is put back with its value');
  console.log('  ✅ Key existence is restored, not just values.');
}

/**
 * Writing one key three times must still restore the value it had first.
 * @returns {void}
 */
function testRepeatedWritesKeepTheFirstSavepoint() {
  console.log('  Testing repeated writes to one key...');
  const state = reactive({ n: 0 });

  rollback(() => {
    state.n = 1;
    state.n = 2;
    state.n = 3;
  });

  assert.strictEqual(state.n, 0, 'the savepoint is the value before the transaction, not the previous write');
  console.log('  ✅ The first savepoint wins.');
}

/**
 * Array methods have no before/after pair, so the array is saved whole.
 * @returns {void}
 */
function testArrayMutations() {
  console.log('  Testing array mutation rollback...');
  const state = reactive({ items: [1, 2, 3] });

  rollback(() => {
    state.items.push(4, 5);
    state.items.splice(0, 1);
    state.items.reverse();
  });

  assert.deepStrictEqual([...state.items], [1, 2, 3], 'the array is restored to its savepoint');
  console.log('  ✅ Array mutations are restored.');
}

/**
 * `arr.length = 0` discards elements no single pair describes.
 * @returns {void}
 */
function testArrayLengthTruncation() {
  console.log('  Testing array truncation rollback...');
  const state = reactive({ items: ['a', 'b', 'c'] });

  rollback(() => {
    state.items.length = 0;
  });

  assert.deepStrictEqual([...state.items], ['a', 'b', 'c'], 'truncation is restored from the savepoint');
  console.log('  ✅ Truncation is restored.');
}

/**
 * Maps and Sets take savepoints in the same way arrays do.
 * @returns {void}
 */
function testMapAndSet() {
  console.log('  Testing Map and Set rollback...');
  const state = reactive({ byId: new Map([['a', 1]]), tags: new Set(['x']) });

  rollback(() => {
    state.byId.set('b', 2);
    state.byId.delete('a');
    state.tags.add('y');
    state.tags.delete('x');
  });

  assert.deepStrictEqual([...state.byId.entries()], [['a', 1]], 'the Map is restored');
  assert.deepStrictEqual([...state.tags.values()], ['x'], 'the Set is restored');

  const cleared = reactive({ byId: new Map([['a', 1]]), tags: new Set(['x']) });
  rollback(() => {
    cleared.byId.clear();
    cleared.tags.clear();
  });
  assert.deepStrictEqual([...cleared.byId.entries()], [['a', 1]], 'Map.clear is restored');
  assert.deepStrictEqual([...cleared.tags.values()], ['x'], 'Set.clear is restored');
  console.log('  ✅ Collections are restored.');
}

/**
 * A transaction that returns normally keeps everything it wrote.
 * @returns {void}
 */
function testCommitKeepsWrites() {
  console.log('  Testing that a committed transaction keeps its writes...');
  const state = reactive({ count: 0, items: [] });

  const result = journal.run({ owner: 'Test', name: 'commit' }, () => {
    state.count = 3;
    state.items.push('a');
    return 'done';
  });

  assert.strictEqual(result, 'done', 'the action return value passes through');
  assert.strictEqual(state.count, 3, 'a committed write stands');
  assert.deepStrictEqual([...state.items], ['a'], 'a committed push stands');
  assert.strictEqual(journal.active, false, 'the frame is closed on commit');
  console.log('  ✅ Commits stand.');
}

/**
 * A returned promise decides the outcome.
 * @returns {Promise<void>}
 */
async function testPromiseOutcomes() {
  console.log('  Testing promise outcomes...');
  const state = reactive({ count: 0 });

  const resolved = await journal.run({ owner: 'Test', name: 'ok' }, () => {
    state.count = 5;
    return Promise.resolve('fine');
  });
  assert.strictEqual(resolved, 'fine', 'a resolved value passes through');
  assert.strictEqual(state.count, 5, 'a resolved transaction commits');
  assert.strictEqual(journal.active, false, 'the frame is closed while the promise is in flight');

  let caught = null;
  await journal
    .run({ owner: 'Test', name: 'bad' }, () => {
      state.count = 9;
      return Promise.reject(new Error('server said no'));
    })
    .catch((error) => {
      caught = error;
    });

  assert.strictEqual(caught && caught.message, 'server said no', 'the rejection is rethrown unchanged');
  assert.strictEqual(state.count, 5, 'a rejected transaction is rewound');
  console.log('  ✅ Resolution commits, rejection rewinds.');
}

/**
 * A nested transaction joins the enclosing one rather than opening a second.
 * @returns {void}
 */
function testNestingJoinsOneFrame() {
  console.log('  Testing nested transactions...');
  const state = reactive({ outer: 0, inner: 0 });
  let innerFrames = -1;

  rollback(() => {
    state.outer = 1;
    journal.run({ owner: 'Test', name: 'inner' }, () => {
      state.inner = 1;
      innerFrames = journal.frames.length;
    });
  });

  assert.strictEqual(innerFrames, 1, 'a nested transaction does not open a second frame');
  assert.strictEqual(state.outer, 0, 'the outer write is rewound');
  assert.strictEqual(state.inner, 0, 'the inner write is rewound by the outer frame');
  console.log('  ✅ Nesting joins one frame.');
}

/**
 * The three conflict policies.
 * @returns {void}
 */
function testConflictPolicies() {
  console.log('  Testing conflict policies...');

  // safe: a value written after the transaction is left alone and reported.
  const safe = reactive({ likes: 4 });
  const frame = journal.begin({ owner: 'Post', name: 'like', onConflict: ConflictPolicy.SAFE });
  safe.likes = 5;
  journal.close(frame);
  safe.likes = 6; // a second, later write

  const messages = captureErrors(() => {
    const outcome = frame.rewind();
    assert.strictEqual(outcome.restored, 0, 'nothing is restored over a newer value');
    assert.strictEqual(outcome.conflicts.length, 1, 'the conflict is reported');
    assert.strictEqual(outcome.conflicts[0].expected, 5, 'the report names what the transaction wrote');
    assert.strictEqual(outcome.conflicts[0].found, 6, 'and what it found instead');
  });
  assert.strictEqual(messages.length, 0, 'frame.rewind() itself does not log; the journal does');
  assert.strictEqual(safe.likes, 6, 'the newer value survives under "safe"');

  // force: the transaction is the authority.
  const forced = reactive({ likes: 4 });
  const forcedFrame = journal.begin({ owner: 'Post', name: 'like', onConflict: ConflictPolicy.FORCE });
  forced.likes = 5;
  journal.close(forcedFrame);
  forced.likes = 6;
  forcedFrame.rewind();
  assert.strictEqual(forced.likes, 4, '"force" restores over a newer value');

  // abort: report loudly through an AvenxError.
  const aborting = reactive({ likes: 4 });
  let thrown = null;
  try {
    journal.run({ owner: 'Post', name: 'like', onConflict: ConflictPolicy.ABORT }, () => {
      aborting.likes = 5;
      // Simulate a later write landing before the rewind runs.
      const open = journal.current();
      open.entries[0].last = 999;
      throw new Error('rollback');
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof AvenxError, '"abort" raises an AvenxError');
  assert.strictEqual(thrown.code, AvenxErrorCodes.TRANSACTION_REWIND_FAILED, 'reported as AVX_R29');
  assert.ok(
    thrown.cause instanceof Error && thrown.cause.message === 'rollback',
    'the failure that started the rewind travels as the cause rather than being lost',
  );
  console.log('  ✅ safe, force and abort behave as specified.');
}

/**
 * A collection past the ceiling is reported rather than silently truncated.
 * @returns {void}
 */
function testSnapshotCeiling() {
  console.log('  Testing the collection snapshot ceiling...');
  const state = reactive({ rows: [1, 2, 3, 4, 5] });

  const messages = captureErrors(() => {
    try {
      journal.run({ owner: 'Test', name: 'big', maxSnapshotItems: 2 }, () => {
        state.rows.push(6);
        throw new Error('rollback');
      });
    } catch {
      // expected
    }
  });

  assert.deepStrictEqual([...state.rows], [1, 2, 3, 4, 5, 6], 'an unsnapshotted collection is left as it is');
  assert.ok(
    messages.some((message) => message.includes('AVX_R29') && message.includes('maxSnapshotItems')),
    `expected an AVX_R29 report naming the ceiling, got: ${messages.join(' | ')}`,
  );
  console.log('  ✅ The ceiling is reported, not hidden.');
}

/**
 * A rewind must wake watchers, or the UI keeps showing the rolled-back value.
 * @returns {void}
 */
function testWatchersWakeOnRewind() {
  console.log('  Testing that a rewind wakes watchers...');
  const state = reactive({ count: 0, items: [1] });

  const seen = [];
  const watcher = new AvenxWatcher(
    () => `${state.count}:${state.items.length}`,
    (value) => seen.push(value),
    { name: 'probe' },
  );

  rollback(() => {
    state.count = 4;
    state.items.push(2);
  });

  assert.ok(seen.includes('0:1'), `expected the watcher to see the restored value, saw: ${seen.join(', ')}`);
  watcher.teardown();
  console.log('  ✅ Watchers wake on rewind.');
}

/**
 * The atomic() marker.
 * @returns {void}
 */
function testAtomicMarker() {
  console.log('  Testing the atomic() marker...');
  const fn = function addQty(id, n) {
    return id + n;
  };
  const marked = atomic(fn, { onConflict: 'force' });

  assert.strictEqual(marked, fn, 'atomic() returns the same function');
  assert.strictEqual(marked.name, 'addQty', 'the name survives');
  assert.strictEqual(marked.length, 2, 'the arity survives');
  assert.strictEqual(isAtomic(marked), true, 'the mark is readable');
  assert.strictEqual(atomicOptions(marked).onConflict, 'force', 'the options are readable');
  assert.strictEqual(isAtomic(() => {}), false, 'an unmarked function is not atomic');
  assert.strictEqual(
    Object.keys(marked).length,
    0,
    'the mark is a symbol, so it stays out of the member namespace',
  );

  assert.throws(() => atomic('not a function'), /AVX_R21/, 'atomic() rejects a non-function');
  console.log('  ✅ atomic() marks without changing the function.');
}

/**
 * A bridge action declared atomic rolls back everything it wrote.
 * @returns {void}
 */
function testAtomicBridgeAction() {
  console.log('  Testing an atomic bridge action...');
  const cart = bridge({
    state: { items: [{ id: 'a', qty: 1 }], revision: 0 },
    get total() {
      return this.items.reduce((sum, item) => sum + item.qty, 0);
    },
    addQty: atomic(function (id, n) {
      this.items.find((item) => item.id === id).qty += n;
      this.revision++;
      if (n > 10) throw new Error('too many');
    }),
    plainAdd(id, n) {
      this.items.find((item) => item.id === id).qty += n;
      throw new Error('not atomic');
    },
  });
  defineBridgeName('cart', cart);

  cart.addQty('a', 2);
  assert.strictEqual(cart.items[0].qty, 3, 'a committed atomic action stands');
  assert.strictEqual(cart.revision, 1, 'and everything else it wrote stands');
  assert.strictEqual(cart.total, 3, 'the getter follows');

  assert.throws(() => cart.addQty('a', 50), /too many/, 'the original error is rethrown');
  assert.strictEqual(cart.items[0].qty, 3, 'the failed write is rewound');
  assert.strictEqual(cart.revision, 1, 'the sibling write is rewound too');
  assert.strictEqual(cart.total, 3, 'the getter follows the rewind');

  assert.throws(() => cart.plainAdd('a', 5), /not atomic/, 'a plain action still throws');
  assert.strictEqual(cart.items[0].qty, 8, 'a plain action is not journaled');
  console.log('  ✅ Atomic bridge actions roll back; plain ones do not.');
}

/**
 * An exception must not leave the journal recording into a finished frame.
 * @returns {void}
 */
function testStackIsRepairedAfterThrow() {
  console.log('  Testing stack repair...');
  journal.reset();
  const state = reactive({ n: 0 });

  for (let i = 0; i < 3; i++) {
    try {
      journal.run({ owner: 'Test', name: `t${i}` }, () => {
        state.n = i + 1;
        throw new Error('rollback');
      });
    } catch {
      // expected
    }
  }

  assert.strictEqual(journal.frames.length, 0, 'no frame is left open');
  assert.strictEqual(journal.active, false, 'the hot-path flag is back to false');
  assert.strictEqual(state.n, 0, 'every transaction rewound');

  const frame = new JournalFrame({ name: 'unused' });
  assert.strictEqual(frame.empty, true, 'a frame that recorded nothing is empty');
  console.log('  ✅ The stack is repaired after a throw.');
}

run().catch((error) => {
  console.error('❌ Avenx Rewind journal tests failed:', error);
  process.exit(1);
});
