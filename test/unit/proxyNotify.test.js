import assert from 'assert';
import {
  hasDependentOnPath,
  isConnected,
  notifyChange,
} from '../../lib/core/reactive/proxy/notify.js';
import { AvenxWatcher, depMap, parentMap, track } from '../../lib/core/reactive/watcher.js';
import { ProxyHandlerFactory } from '../../lib/core/reactive/proxyHandler.js';

console.log('🧪 Testing proxy/notify.js...');

// isConnected
const factory = new ProxyHandlerFactory();
const root = { a: { b: 1 } };
const detached = { c: 2 };
assert.strictEqual(isConnected(factory, detached), true, 'connected when rootTarget is null');
factory.rootTarget = root;
assert.strictEqual(isConnected(factory, root), true);
parentMap.set(root.a, { parentTarget: root, parentKey: 'a' });
assert.strictEqual(isConnected(factory, root.a), true);
assert.strictEqual(isConnected(factory, detached), false);
parentMap.delete(root.a);

// hasDependentOnPath
const target = { items: [{ qty: 1 }] };
parentMap.set(target.items, { parentTarget: target, parentKey: 'items' });
parentMap.set(target.items[0], { parentTarget: target.items, parentKey: 0 });

assert.strictEqual(hasDependentOnPath(target.items[0], 'qty'), false);

const watcher = new AvenxWatcher(
  () => {
    track(target, 'items');
  },
  () => {},
);
assert.strictEqual(hasDependentOnPath(target, 'items'), true);
assert.strictEqual(hasDependentOnPath(target.items[0], 'qty'), true, 'should walk parentMap up to observed ancestor');
assert.strictEqual(hasDependentOnPath(target, 'other'), false);
watcher.teardown();
parentMap.delete(target.items[0]);
parentMap.delete(target.items);
depMap.delete(target);

// notifyChange
const calls = [];
const notifyFactory = new ProxyHandlerFactory({
  onlyNotifyObserved: true,
  onChange: (key, t) => calls.push({ key, t }),
});
notifyFactory.rootTarget = target;
notifyChange(notifyFactory, target, 'unobserved');
assert.strictEqual(calls.length, 0, 'unobserved key should not notify when onlyNotifyObserved is true');

notifyChange(notifyFactory, target, undefined);
assert.strictEqual(calls.length, 1, 'structural change (key=undefined) notifies unconditionally');

notifyChange(notifyFactory, detached, undefined);
assert.strictEqual(calls.length, 1, 'disconnected target should not notify');

console.log('✅ proxy/notify.js tests passed!');
