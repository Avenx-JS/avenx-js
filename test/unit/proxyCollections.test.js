import assert from 'assert';
import {
  mutatingArrayMethods,
  getMapMethod,
  getSetMethod,
} from '../../lib/core/reactive/proxy/collections.js';
import { isReactive } from '../../lib/core/reactive/proxy/identity.js';
import { ProxyHandlerFactory } from '../../lib/core/reactive/proxyHandler.js';

console.log('🧪 Testing proxy/collections.js...');

// mutatingArrayMethods
for (const method of ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill']) {
  assert.ok(mutatingArrayMethods.has(method), `mutatingArrayMethods should include ${method}`);
}
assert.strictEqual(mutatingArrayMethods.has('map'), false);

// getMapMethod
const mapChanges = [];
const mapFactory = new ProxyHandlerFactory({
  onChange: (key) => mapChanges.push(key),
});
const rawMap = new Map([['obj', { n: 1 }]]);
mapFactory.rootTarget = rawMap;
const mapProxy = new Proxy(rawMap, mapFactory.create());

assert.strictEqual(getMapMethod(mapFactory, rawMap, 'size', mapProxy), 1);
const got = getMapMethod(mapFactory, rawMap, 'get', mapProxy)('obj');
assert.strictEqual(isReactive(got), true);
assert.strictEqual(got.n, 1);
assert.strictEqual(getMapMethod(mapFactory, rawMap, 'has', mapProxy)('obj'), true);

getMapMethod(mapFactory, rawMap, 'set', mapProxy)('second', 2);
assert.strictEqual(rawMap.get('second'), 2);
assert.ok(mapChanges.length > 0);

getMapMethod(mapFactory, rawMap, 'delete', mapProxy)('second');
assert.strictEqual(rawMap.has('second'), false);

getMapMethod(mapFactory, rawMap, 'clear', mapProxy)();
assert.strictEqual(rawMap.size, 0);

// getSetMethod
const setChanges = [];
const setFactory = new ProxyHandlerFactory({
  onChange: (key) => setChanges.push(key),
});
const rawSet = new Set([{ id: 1 }]);
setFactory.rootTarget = rawSet;
const setProxy = new Proxy(rawSet, setFactory.create());

assert.strictEqual(getSetMethod(setFactory, rawSet, 'size', setProxy), 1);
getSetMethod(setFactory, rawSet, 'add', setProxy)('hello');
assert.strictEqual(rawSet.has('hello'), true);
assert.ok(setChanges.length > 0);

const values = [...getSetMethod(setFactory, rawSet, 'values', setProxy)()];
assert.strictEqual(values.length, 2);
assert.strictEqual(isReactive(values[0]), true);

getSetMethod(setFactory, rawSet, 'delete', setProxy)('hello');
assert.strictEqual(rawSet.has('hello'), false);

getSetMethod(setFactory, rawSet, 'clear', setProxy)();
assert.strictEqual(rawSet.size, 0);

console.log('✅ proxy/collections.js tests passed!');
