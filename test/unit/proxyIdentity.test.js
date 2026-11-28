import assert from 'assert';
import {
  isReactiveTarget,
  toRaw,
  isReactive,
  markRaw,
  cleanupParentMap,
  isRootTarget,
  getOrCreateProxy,
} from '../../lib/core/reactive/proxy/identity.js';
import {
  RAW_SYMBOL,
  IS_REACTIVE_PROXY,
  PROXY_REF_SYMBOL,
  NON_REACTIVE_SYMBOL,
} from '../../lib/core/reactive/symbols.js';
import { parentMap } from '../../lib/core/reactive/watcher.js';
import { ProxyHandlerFactory } from '../../lib/core/reactive/proxyHandler.js';

console.log('🧪 Testing proxy/identity.js...');

// isReactiveTarget
assert.strictEqual(isReactiveTarget({}), true);
assert.strictEqual(isReactiveTarget([]), true);
assert.strictEqual(isReactiveTarget(Object.create(null)), true);
assert.strictEqual(isReactiveTarget(new Map()), true);
assert.strictEqual(isReactiveTarget(new Set()), true);
assert.strictEqual(isReactiveTarget(null), false);
assert.strictEqual(isReactiveTarget(42), false);
assert.strictEqual(isReactiveTarget(new Date()), false);
assert.strictEqual(isReactiveTarget(/abc/), false);

// markRaw & isReactiveTarget
const rawMarked = markRaw({ a: 1 });
assert.strictEqual(rawMarked[NON_REACTIVE_SYMBOL], true);
assert.strictEqual(isReactiveTarget(rawMarked), false);
assert.strictEqual(markRaw(null), null);
const frozen = Object.freeze({ x: 1 });
assert.strictEqual(markRaw(frozen), frozen);

// toRaw & isReactive
assert.strictEqual(toRaw(null), null);
assert.strictEqual(toRaw(123), 123);
const plain = { k: 'v' };
assert.strictEqual(toRaw(plain), plain);
assert.strictEqual(isReactive(plain), false);
assert.strictEqual(isReactive(null), false);

const fakeProxy = { [RAW_SYMBOL]: plain, [IS_REACTIVE_PROXY]: true };
assert.strictEqual(toRaw(fakeProxy), plain);
assert.strictEqual(isReactive(fakeProxy), true);

// isRootTarget
const factory = new ProxyHandlerFactory();
const root = { a: 1 };
const child = { b: 2 };
assert.strictEqual(isRootTarget(factory, root), true);
factory.rootTarget = root;
assert.strictEqual(isRootTarget(factory, root), true);
assert.strictEqual(isRootTarget(factory, child), false);

// getOrCreateProxy
const nested = { count: 1 };
const proxy1 = getOrCreateProxy(factory, nested);
const proxy2 = getOrCreateProxy(factory, nested);
assert.strictEqual(proxy1, proxy2, 'getOrCreateProxy should return cached proxy');
assert.strictEqual(isReactive(proxy1), true);
assert.strictEqual(nested[PROXY_REF_SYMBOL], proxy1);
assert.strictEqual(getOrCreateProxy(factory, proxy1), proxy1);

// cleanupParentMap
const parentObj = { child: { grandChild: {} } };
parentMap.set(parentObj.child, { parentTarget: parentObj, parentKey: 'child' });
parentMap.set(parentObj.child.grandChild, { parentTarget: parentObj.child, parentKey: 'grandChild' });
cleanupParentMap(parentObj.child);
assert.strictEqual(parentMap.has(parentObj.child), false);
assert.strictEqual(parentMap.has(parentObj.child.grandChild), false);

console.log('✅ proxy/identity.js tests passed!');
