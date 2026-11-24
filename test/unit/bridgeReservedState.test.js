import assert from 'node:assert/strict';
import { bridge } from '../../lib/core/runtime/bridge.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

for (const key of ['on', 'emit', '$dispose', '$name']) {
  let setups = 0;
  const definition = {
    state: { [key]: 'application data' },
    setup() {
      setups++;
    },
  };
  assert.throws(
    () => bridge(definition),
    (error) => error.code === AvenxErrorCodes.BRIDGE_RESERVED_KEY && error.message.includes(key),
    `state named ${key} must be rejected before the API silently hides its value`,
  );
  assert.equal(setups, 0, 'invalid definitions are rejected without running setup');
  assert.equal(definition.state[key], 'application data', 'validation does not alter the supplied state');
}

const store = bridge({
  state: { enabled: true, $status: 'ready', record: { on: 'value', emit: 'data', $name: 'nested' } },
  toggle() {
    this.enabled = !this.enabled;
    this.emit('toggled', this.enabled);
  },
});
const events = [];
const stop = store.on('toggled', (value) => events.push(value));
store.toggle();
assert.equal(store.enabled, false);
assert.deepEqual(events, [false]);
assert.equal(store.$status, 'ready', 'other dollar-prefixed state names remain valid');
assert.equal(store.record.on, 'value', 'reserved names are valid inside application data');
assert.equal(store.record.emit, 'data');
assert.equal(store.record.$name, 'nested');
stop();
store.$dispose();
assert.equal(store.enabled, true, 'the bridge API remains usable with ordinary state');

console.log('Bridge state rejects API name collisions without restricting nested data.');
