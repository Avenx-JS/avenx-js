import assert from 'assert';
import {
  get,
  set,
  deleteProperty,
  ownKeys,
  getOwnPropertyDescriptor,
} from '../../lib/core/reactive/proxy/traps.js';
import { isReactive } from '../../lib/core/reactive/proxy/identity.js';
import { RAW_SYMBOL, IS_REACTIVE_PROXY } from '../../lib/core/reactive/symbols.js';
import { ProxyHandlerFactory } from '../../lib/core/reactive/proxyHandler.js';

console.log('🧪 Testing proxy/traps.js...');

const changes = [];
let keysChangedCount = 0;
const factory = new ProxyHandlerFactory({
  computedKeys: ['total'],
  getComputedValue: () => 42,
  onChange: (key) => changes.push(key),
  onKeysChanged: () => {
    keysChangedCount++;
  },
});

const raw = { a: 1, nested: { b: 2 } };
factory.rootTarget = raw;
const proxy = new Proxy(raw, factory.create());

// get
assert.strictEqual(get(factory, raw, IS_REACTIVE_PROXY, proxy), true);
assert.strictEqual(get(factory, raw, RAW_SYMBOL, proxy), raw);
assert.strictEqual(get(factory, raw, 'a', proxy), 1);
assert.strictEqual(get(factory, raw, 'total', proxy), 42);
const nestedProxy = get(factory, raw, 'nested', proxy);
assert.strictEqual(isReactive(nestedProxy), true);
assert.strictEqual(nestedProxy.b, 2);

// set
assert.strictEqual(set(factory, raw, 'a', 10), true);
assert.strictEqual(raw.a, 10);
assert.ok(changes.includes('a'));

assert.strictEqual(set(factory, raw, 'added', 99), true);
assert.strictEqual(keysChangedCount, 1);

// ownKeys & getOwnPropertyDescriptor
assert.deepStrictEqual(ownKeys(factory, raw), ['a', 'nested', 'added', 'total']);
assert.deepStrictEqual(
  ownKeys(factory, raw.nested).filter((k) => typeof k !== 'symbol'),
  ['b'],
);
assert.deepStrictEqual(getOwnPropertyDescriptor(factory, raw, 'total'), {
  enumerable: true,
  configurable: true,
});
assert.strictEqual(getOwnPropertyDescriptor(factory, raw.nested, 'total'), undefined);

// deleteProperty
assert.strictEqual(deleteProperty(factory, raw, 'added'), true);
assert.strictEqual('added' in raw, false);
assert.strictEqual(keysChangedCount, 2);

console.log('✅ proxy/traps.js tests passed!');
