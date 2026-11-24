import assert from 'node:assert/strict';
import { bridge } from '../../lib/core/runtime/bridge.js';
import { AvenxWatcher } from '../../lib/core/reactive/watcher.js';

const node = { name: 'root' };
node.parent = node;
const history = [node];
history.push(history);
const initial = { node, selected: node, history };
initial.self = initial;

const definition = {
  state: initial,
  rename(name) {
    this.selected.name = name;
  },
  addTemporary() {
    this.temporary = true;
  },
};
const first = bridge(definition);
const second = bridge(definition);

/** @param {object} store - A bridge holding the fixture graph. */
function assertGraph(store) {
  assert.equal(store.node.parent, store.node, 'an object cycle retains its identity');
  assert.equal(store.selected, store.node, 'shared objects are copied only once');
  assert.equal(store.history[0], store.node, 'aliases through arrays remain shared');
  assert.equal(store.history[1], store.history, 'array cycles remain intact');
  assert.equal(store.self.node, store.node, 'a reference to the initial state reaches the live state');
  assert.equal(store.self.self, store.self, 'the root cycle remains intact');
}

assertGraph(first);
assertGraph(second);
assert.notEqual(first.node, node, 'initial state is copied');
assert.notEqual(first.node, second.node, 'separate bridges have separate state');

const seen = [];
const watcher = new AvenxWatcher(() => seen.push(first.node.name), null, { isEffect: true });
try {
  first.rename('changed');
  assert.equal(first.node.name, 'changed');
  assert.equal(node.name, 'root', 'actions do not change the definition');
  assert.equal(second.node.name, 'root', 'actions do not change another bridge');
  assert.deepEqual(seen, ['root', 'changed']);
  first.addTemporary();
  first.$dispose();
  assert.equal(first.temporary, undefined, 'disposal removes added state');
  assert.equal(first.node.name, 'root', 'disposal restores the original values');
  assertGraph(first);
  first.rename('reused');
  assert.equal(first.node.name, 'reused', 'the bridge remains usable after disposal');
  assert.equal(seen.at(-1), 'reused', 'existing consumers still observe mutations');
} finally {
  watcher.teardown();
}

const sparse = [];
sparse.length = 3;
sparse[2] = sparse;
const sparseStore = bridge({ state: { sparse } });
assert.equal(sparseStore.sparse.length, 3);
assert.equal(0 in sparseStore.sparse, false, 'copying does not fill sparse array holes');
assert.equal(sparseStore.sparse[2], sparseStore.sparse);

console.log('Bridge initial graphs preserve cycles, sharing, isolation, and disposal.');
