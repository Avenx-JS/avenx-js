import assert from 'node:assert/strict';
import { browserLocalStorage, browserSessionStorage } from '../src/storage.js';

const probe = '__avenx_persistence_probe__';
for (const [area, resolve] of [
  ['localStorage', browserLocalStorage],
  ['sessionStorage', browserSessionStorage],
]) {
  const original = Object.getOwnPropertyDescriptor(globalThis, area);
  try {
    for (const stored of ['existing application data', '']) {
      const before = new Map([
        [probe, stored],
        [`${probe}:1`, 'another existing entry'],
        ['customer', 'keep this too'],
      ]);
      const entries = new Map(before);
      const writes = [];
      const removals = [];
      const storage = {
        getItem: (key) => entries.get(key) ?? null,
        setItem(key, value) {
          writes.push(key);
          entries.set(key, value);
        },
        removeItem(key) {
          removals.push(key);
          entries.delete(key);
        },
      };
      Object.defineProperty(globalThis, area, { configurable: true, value: storage });
      assert.equal(resolve(), storage, `${area} remains usable`);
      assert.deepEqual(entries, before, 'probing must preserve every existing value, including empty strings');
      assert.ok(writes.length > 0, 'availability is still tested with a write');
      assert.ok(
        writes.every((key) => !before.has(key)),
        'existing entries must never be overwritten',
      );
      assert.ok(
        removals.every((key) => !before.has(key)),
        'existing entries must never be removed',
      );
      assert.ok(
        writes.every((key) => !entries.has(key)),
        'successful probes leave no temporary entries',
      );

      storage.setItem = () => {
        throw new Error('storage writes are blocked');
      };
      const fallback = resolve();
      assert.notEqual(fallback, storage, 'blocked storage still falls back to memory');
      fallback.setItem('new', 'value');
      assert.equal(fallback.getItem('new'), 'value');
      assert.deepEqual(entries, before, 'a failed probe also preserves existing data');
    }
  } finally {
    if (original) Object.defineProperty(globalThis, area, original);
    else delete globalThis[area];
  }
}

console.log('Web Storage availability probes preserve existing data and clean up their own entries.');
