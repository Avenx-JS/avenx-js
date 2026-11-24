import assert from 'node:assert/strict';
import { bridge } from '../../lib/core/runtime/bridge.js';

let facade;
let reads = 0;
const profile = bridge({
  state: { user: null },
  get displayName() {
    reads++;
    return this.user.name;
  },
  setup() {
    facade = this;
  },
});

assert.equal(profile.user, null);
assert.deepEqual(Object.keys(facade), ['user', 'displayName']);
const descriptors = Object.getOwnPropertyDescriptors(facade);
assert.equal(reads, 0, 'enumeration and reflection do not evaluate derived getters');
assert.equal(descriptors.user.writable, true, 'state can be identified without assigning it');
assert.equal(descriptors.user.value, null);
assert.equal(typeof descriptors.displayName.get, 'function', 'derived members have accessor descriptors');
assert.equal(descriptors.displayName.set, undefined, 'a derived getter cannot be assigned');
assert.equal(descriptors.displayName.writable, undefined);
facade.user = { name: 'Ada' };
assert.equal(descriptors.displayName.get(), 'Ada', 'the reflected accessor reads current bridge state');
assert.equal(reads, 1);
assert.throws(() => {
  facade.displayName = 'changed';
}, /not assignable/);

console.log('Bridge facade reflection does not run derived getters.');
