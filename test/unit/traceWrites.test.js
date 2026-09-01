import assert from 'assert';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { tracer } from '../../lib/core/trace/tracer.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { TraceNodeType, REDACTED } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing reactive write recording...');

const factory = new StateFactory();

/**
 * Records the writes produced by mutating a piece of state.
 * @param {object} initial - Initial state.
 * @param {Function} mutate - Receives the reactive state.
 * @param {object} [options] - Recorder options.
 * @returns {object[]} The recorded write nodes.
 */
function recordWrites(initial, mutate, options = {}) {
  const state = factory.create(initial);
  const recorder = startRecording(options);
  recorder.arm();
  try {
    mutate(state);
  } finally {
    stopRecording();
  }
  return recorder.nodes.filter((n) => n.type === TraceNodeType.WRITE);
}

// --- Nothing is recorded while tracing is off -------------------------------

const quiet = factory.create({ count: 0 });
quiet.count = 5;
assert.strictEqual(tracer.on, false, 'tracing stays off');
assert.strictEqual(quiet.count, 5, 'untraced mutation behaves normally');

// --- Simple property write --------------------------------------------------

let writes = recordWrites({ count: 0 }, (state) => {
  state.count = 1;
});
assert.strictEqual(writes.length, 1, 'one assignment produces exactly one write node');
assert.strictEqual(writes[0].path, 'count');
assert.strictEqual(writes[0].from, 0);
assert.strictEqual(writes[0].to, 1);

// --- A no-op assignment records nothing -------------------------------------

writes = recordWrites({ count: 7 }, (state) => {
  state.count = 7;
});
assert.strictEqual(writes.length, 0, 'assigning the same value is not a write');

// --- Nested paths are reconstructed, and recorded once ----------------------

writes = recordWrites({ cart: { items: [{ qty: 9 }, { qty: 1 }] } }, (state) => {
  state.cart.items[1].qty = 2;
});
assert.strictEqual(
  writes.length,
  1,
  `a nested assignment records one write, not one per ancestor (got ${writes.length})`,
);
assert.strictEqual(writes[0].path, 'cart.items.1.qty', 'the full property path is reconstructed');
assert.strictEqual(writes[0].from, 1);
assert.strictEqual(writes[0].to, 2);

// --- Object values are captured, not referenced -----------------------------

writes = recordWrites({ user: null }, (state) => {
  state.user = { name: 'Ada', roles: ['admin'] };
});
assert.strictEqual(writes[0].path, 'user');
assert.strictEqual(writes[0].from, null);
assert.deepStrictEqual(writes[0].to, { name: 'Ada', roles: ['admin'] });

// --- Deletion ---------------------------------------------------------------

writes = recordWrites({ a: 1, b: 2 }, (state) => {
  delete state.a;
});
assert.strictEqual(writes.length, 1);
assert.strictEqual(writes[0].op, 'delete');
assert.strictEqual(writes[0].path, 'a');
assert.strictEqual(writes[0].from, 1);

// --- Array mutation methods -------------------------------------------------

writes = recordWrites({ items: [1, 2] }, (state) => {
  state.items.push(3);
});
assert.ok(writes.length >= 1, 'push is recorded');
const push = writes.find((w) => w.op === 'push');
assert.ok(push, 'the operation name is recorded');
assert.strictEqual(push.size, 3, 'the resulting length is recorded instead of the whole array');
assert.strictEqual(push.to, undefined, 'the array contents are not cloned on every push');

writes = recordWrites({ items: [1, 2, 3] }, (state) => {
  state.items.splice(1, 1);
});
assert.ok(
  writes.some((w) => w.op === 'splice'),
  'splice is recorded',
);

// --- Direct index assignment -----------------------------------------------

writes = recordWrites({ items: [1, 2, 3] }, (state) => {
  state.items[0] = 99;
});
assert.strictEqual(writes.length, 1);
assert.strictEqual(writes[0].path, 'items.0');
assert.strictEqual(writes[0].to, 99);

// --- Map and Set ------------------------------------------------------------

writes = recordWrites({ m: new Map() }, (state) => {
  state.m.set('a', 1);
});
assert.ok(
  writes.some((w) => w.op === 'map.set' && w.size === 1),
  'Map.set is recorded with the resulting size',
);

writes = recordWrites({ m: new Map([['a', 1]]) }, (state) => {
  state.m.delete('a');
});
assert.ok(writes.some((w) => w.op === 'map.delete'), 'Map.delete is recorded');

writes = recordWrites({ s: new Set() }, (state) => {
  state.s.add('x');
});
assert.ok(writes.some((w) => w.op === 'set.add' && w.size === 1), 'Set.add is recorded');

writes = recordWrites({ s: new Set(['x', 'y']) }, (state) => {
  state.s.clear();
});
assert.ok(writes.some((w) => w.op === 'clear' && w.size === 0), 'clear is recorded');

// --- Writes nest under whatever caused them ---------------------------------

const state = factory.create({ count: 0 });
const recorder = startRecording();
recorder.arm();
const token = tracer.enter(TraceNodeType.ACTION, { name: 'increment', component: 'Counter' });
state.count = 1;
state.count = 2;
tracer.leave(token);
stopRecording();

const action = recorder.nodes.find((n) => n.type === TraceNodeType.ACTION);
const caused = recorder.nodes.filter((n) => n.type === TraceNodeType.WRITE);
assert.strictEqual(caused.length, 2);
assert.ok(
  caused.every((w) => w.parent === action.id),
  'both writes are attributed to the action that made them',
);
assert.strictEqual(recorder.isDeterministic, true, 'attributed writes keep the trace deterministic');

// --- Redaction applies to recorded writes -----------------------------------

writes = recordWrites(
  { auth: { token: 'old-secret', user: 'ada' } },
  (s) => {
    s.auth.token = 'new-secret';
  },
  { redact: ['auth.token'] },
);
assert.strictEqual(writes[0].path, 'auth.token', 'the path is still recorded');
assert.strictEqual(writes[0].from, REDACTED, 'the old value is withheld');
assert.strictEqual(writes[0].to, REDACTED, 'the new value is withheld');

const secureRecorder = startRecording({ redact: ['auth.token'] });
secureRecorder.arm();
const secure = factory.create({ auth: { token: 'old' } });
secure.auth.token = 'hunter2';
stopRecording();
assert.ok(
  !secureRecorder.serialize().includes('hunter2'),
  'a redacted secret never reaches the serialized trace',
);

console.log('✅ All reactive write recording tests passed.');
