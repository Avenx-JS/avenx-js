import assert from 'assert';
import { evaluateComputedWatcher } from '../../lib/core/reactive/proxy/computed.js';
import { ProxyHandlerFactory } from '../../lib/core/reactive/proxyHandler.js';
import { track, trigger } from '../../lib/core/reactive/watcher.js';

console.log('🧪 Testing proxy/computed.js...');

const raw = { count: 2 };
let evalCount = 0;
const notified = [];

const factory = new ProxyHandlerFactory({
  computedKeys: ['doubled'],
  getComputedValue: (key) => {
    if (key === 'doubled') {
      evalCount++;
      track(raw, 'count');
      return raw.count * 2;
    }
    return undefined;
  },
  onChange: (key) => notified.push(key),
});

const proxy = new Proxy(raw, factory.create());

assert.strictEqual(evaluateComputedWatcher(factory, 'doubled', proxy), 4);
assert.strictEqual(evalCount, 1);

// Cached on second read
assert.strictEqual(evaluateComputedWatcher(factory, 'doubled', proxy), 4);
assert.strictEqual(evalCount, 1);

// Invalidates when dependency triggers
raw.count = 5;
trigger(raw, 'count');
assert.deepStrictEqual(notified, ['doubled']);
assert.strictEqual(evaluateComputedWatcher(factory, 'doubled', proxy), 10);
assert.strictEqual(evalCount, 2);

factory.teardown();
console.log('✅ proxy/computed.js tests passed!');
