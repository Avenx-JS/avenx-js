import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

class WatchTestComponent extends AvenxComponent {
  constructor() {
    super({
      count: 0,
      user: {
        name: 'Alice',
        details: {
          age: 30,
        },
      },
      tags: ['html', 'js'],
    });
  }
}

/**
 * Test 1: Watch a state key string.
 */
function testWatchKeyString() {
  console.log('🧪 Testing $watch with a key string...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  let lastNew = null;
  let lastOld = null;

  comp.$watch('count', (newVal, oldVal) => {
    watchCount++;
    lastNew = newVal;
    lastOld = oldVal;
  });

  assert.strictEqual(watchCount, 0);

  comp.state.count = 5;
  assert.strictEqual(watchCount, 1);
  assert.strictEqual(lastNew, 5);
  assert.strictEqual(lastOld, 0);

  console.log('  ✅ Key string watcher triggered successfully.');
}

/**
 * Test 2: Watch a state dot-separated path string.
 */
function testWatchPathString() {
  console.log('🧪 Testing $watch with a nested path string...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  let lastNew = null;
  let lastOld = null;

  comp.$watch('user.name', (newVal, oldVal) => {
    watchCount++;
    lastNew = newVal;
    lastOld = oldVal;
  });

  assert.strictEqual(watchCount, 0);

  comp.state.user.name = 'Bob';
  assert.strictEqual(watchCount, 1);
  assert.strictEqual(lastNew, 'Bob');
  assert.strictEqual(lastOld, 'Alice');

  console.log('  ✅ Nested path string watcher triggered successfully.');
}

/**
 * Test 3: Watch a function getter.
 */
function testWatchGetter() {
  console.log('🧪 Testing $watch with a function getter...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  let lastNew = null;
  let lastOld = null;

  comp.$watch(
    () => comp.state.count + comp.state.user.details.age,
    (newVal, oldVal) => {
      watchCount++;
      lastNew = newVal;
      lastOld = oldVal;
    },
  );

  assert.strictEqual(watchCount, 0);

  // Change first dependency
  comp.state.count = 2;
  assert.strictEqual(watchCount, 1);
  assert.strictEqual(lastNew, 32);
  assert.strictEqual(lastOld, 30);

  // Change second dependency
  comp.state.user.details.age = 31;
  assert.strictEqual(watchCount, 2);
  assert.strictEqual(lastNew, 33);
  assert.strictEqual(lastOld, 32);

  console.log('  ✅ Function getter watcher evaluated dependencies and triggered successfully.');
}

/**
 * Test 4: Option { immediate: true }.
 */
function testWatchImmediate() {
  console.log('🧪 Testing $watch with { immediate: true } option...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  let lastNew = null;
  let lastOld = null;

  comp.$watch(
    'count',
    (newVal, oldVal) => {
      watchCount++;
      lastNew = newVal;
      lastOld = oldVal;
    },
    { immediate: true },
  );

  // Should trigger immediately on register
  assert.strictEqual(watchCount, 1);
  assert.strictEqual(lastNew, 0);
  assert.strictEqual(lastOld, undefined);

  // Mutate should trigger normally
  comp.state.count = 10;
  assert.strictEqual(watchCount, 2);
  assert.strictEqual(lastNew, 10);
  assert.strictEqual(lastOld, 0);

  console.log('  ✅ Immediate watcher executed immediately on creation.');
}

/**
 * Test 5: Option { deep: true }.
 */
function testWatchDeep() {
  console.log('🧪 Testing $watch with { deep: true } option...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  let lastNew = null;
  let lastOld = null;

  // Deep watch the user object
  comp.$watch(
    'user',
    (newVal, oldVal) => {
      watchCount++;
      lastNew = newVal;
      lastOld = oldVal;
    },
    { deep: true },
  );

  assert.strictEqual(watchCount, 0);

  // Mutate nested field
  comp.state.user.details.age = 35;
  assert.strictEqual(watchCount, 1);
  // newVal and oldVal point to the same object
  assert.strictEqual(lastNew, comp.state.user);
  assert.strictEqual(lastOld, comp.state.user);
  assert.strictEqual(lastNew.details.age, 35);

  // Deep watch an array
  let arrayWatchCount = 0;
  comp.$watch(
    'tags',
    () => {
      arrayWatchCount++;
    },
    { deep: true },
  );

  comp.state.tags.push('css');
  assert.strictEqual(arrayWatchCount, 1);

  console.log('  ✅ Deep watcher tracked and triggered on nested mutations.');
}

/**
 * Test 6: Automatic watcher cleanup on unmount.
 */
function testWatcherTeardown() {
  console.log('🧪 Testing $watch automatic cleanup on component unmount...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  comp.$watch('count', () => {
    watchCount++;
  });

  comp.state.count = 1;
  assert.strictEqual(watchCount, 1);

  // Unmount
  comp.unmount();

  // Mutating after unmount should NOT trigger callback
  comp.state.count = 2;
  assert.strictEqual(watchCount, 1);

  console.log('  ✅ Watcher cleaned up successfully on component unmount.');
}

/**
 * Test 7: Watch an array of sources (multi-source watching).
 */
function testWatchArrayOfSources() {
  console.log('🧪 Testing $watch with an array of sources...');
  const comp = new WatchTestComponent();

  let watchCount = 0;
  let lastNew = null;
  let lastOld = null;

  // Watch an array combining a getter function and a key string path
  comp.$watch(
    [() => comp.state.count, 'user.name'],
    (newVals, oldVals) => {
      watchCount++;
      lastNew = newVals;
      lastOld = oldVals;
    },
  );

  assert.strictEqual(watchCount, 0);

  // Mutate first source in array (count)
  comp.state.count = 5;
  assert.strictEqual(watchCount, 1);
  assert.deepStrictEqual(lastNew, [5, 'Alice']);
  assert.deepStrictEqual(lastOld, [0, 'Alice']);

  // Mutate second source in array (user.name)
  comp.state.user.name = 'Bob';
  assert.strictEqual(watchCount, 2);
  assert.deepStrictEqual(lastNew, [5, 'Bob']);
  assert.deepStrictEqual(lastOld, [5, 'Alice']);

  // Unmount cleanup test for array watcher
  comp.unmount();
  comp.state.count = 10;
  comp.state.user.name = 'Charlie';
  assert.strictEqual(watchCount, 2, 'Watchers should be cleaned up on unmount');

  console.log('  ✅ Array of sources watcher triggered and cleaned up successfully.');
}

/**
 * Test 8: watch(...) method and destroy() / $destroy() alias cleanup.
 */
function testWatchMethodAndDestroy() {
  console.log('🧪 Testing watch(...) method and destroy() / $destroy() cleanup...');
  const comp = new WatchTestComponent();

  let countWatch = 0;
  comp.watch(
    () => comp.state.count,
    () => {
      countWatch++;
    },
  );

  comp.state.count = 10;
  assert.strictEqual(countWatch, 1);

  // Calling destroy() should trigger unmount and teardown
  comp.destroy();

  comp.state.count = 20;
  assert.strictEqual(countWatch, 1, 'Watcher registered via watch() must not trigger after destroy()');

  // Test $destroy() alias
  const comp2 = new WatchTestComponent();
  let countWatch2 = 0;
  comp2.watch(
    () => comp2.state.count,
    () => {
      countWatch2++;
    },
  );

  comp2.state.count = 15;
  assert.strictEqual(countWatch2, 1);

  comp2.$destroy();
  comp2.state.count = 25;
  assert.strictEqual(countWatch2, 1, 'Watcher registered via watch() must not trigger after $destroy()');

  console.log('  ✅ watch(...) method and destroy() / $destroy() cleanup passed.');
}

/**
 * Test 9: Declarative watch option automatic cleanup on unmount.
 */
function testDeclarativeWatchOption() {
  console.log('🧪 Testing declarative watch option automatic cleanup on unmount...');
  let watchCount = 0;

  class DeclarativeWatchComponent extends AvenxComponent {
    constructor() {
      super({
        state: { num: 0 },
        watch: {
          num() {
            watchCount++;
          },
        },
      });
    }
  }

  const comp = new DeclarativeWatchComponent();
  comp.state.num = 1;
  assert.strictEqual(watchCount, 1);

  comp.unmount();
  comp.state.num = 2;
  assert.strictEqual(watchCount, 1, 'Declarative watcher must not trigger after unmount');

  console.log('  ✅ Declarative watch option automatic cleanup on unmount passed.');
}

/**
 * Test 10: Watcher registered on already unmounted component.
 */
function testUnmountedRegistration() {
  console.log('🧪 Testing watcher registered on already unmounted component...');
  const comp = new WatchTestComponent();
  comp.unmount();

  let watchCount = 0;
  comp.$watch('count', () => {
    watchCount++;
  });

  comp.state.count = 100;
  assert.strictEqual(watchCount, 0, 'Watcher registered on unmounted component must be immediately torn down');

  console.log('  ✅ Unmounted watcher registration safety check passed.');
}

/**
 * Test 11: Execution timing with flush: 'pre' | 'post' | 'sync' against DOM patches.
 */
async function testWatchFlushDomTiming() {
  console.log('🧪 Testing $watch flush timing ("pre", "post", "sync") against DOM patches...');

  class ListComponent extends AvenxComponent {
    constructor() {
      super({ messages: ['one'] });
    }
    render() {
      const lis = this.state.messages.map((m) => `<li>${m}</li>`).join('');
      return `<div><ul class="chat-messages">${lis}</ul></div>`;
    }
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const comp = new ListComponent();
  comp.mount(host);

  assert.strictEqual(comp.el.querySelectorAll('li').length, 1);

  const observations = [];
  comp.$watch(
    'messages',
    () => {
      observations.push({ when: 'pre', lis: comp.el.querySelectorAll('li').length });
    },
    { flush: 'pre' },
  );
  comp.$watch(
    'messages',
    () => {
      observations.push({ when: 'sync', lis: comp.el.querySelectorAll('li').length });
    },
    { flush: 'sync' },
  );
  comp.$watch(
    'messages',
    () => {
      observations.push({ when: 'post', lis: comp.el.querySelectorAll('li').length });
    },
    { flush: 'post' },
  );

  comp.state.messages = ['one', 'two', 'three'];

  // Before microtask flush: 'pre' and 'sync' have already fired (seeing 1 <li>); 'post' has not.
  assert.deepStrictEqual(observations, [
    { when: 'pre', lis: 1 },
    { when: 'sync', lis: 1 },
  ]);

  await comp.$nextTick();

  // After DOM patch flush: 'post' has fired and observed 3 <li>s.
  assert.strictEqual(comp.el.querySelectorAll('li').length, 3);
  assert.deepStrictEqual(observations, [
    { when: 'pre', lis: 1 },
    { when: 'sync', lis: 1 },
    { when: 'post', lis: 3 },
  ]);

  comp.unmount();
  host.remove();
  console.log('  ✅ $watch flush timing ("pre", "post", "sync") tests passed.');
}

/**
 * Test 12: Documented chat-messages scroll example with { flush: 'post' }.
 */
async function testWatchFlushChatScrollExample() {
  console.log('🧪 Testing documented { flush: "post" } chat scroll example...');

  class ChatComponent extends AvenxComponent {
    constructor() {
      super({ messages: ['hello'] });
    }
    render() {
      const lis = this.state.messages.map((m) => `<li>${m}</li>`).join('');
      return `<div><ul class="chat-messages">${lis}</ul></div>`;
    }
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const comp = new ChatComponent();
  comp.mount(host);

  let observedScrollTop = -1;
  let observedCount = 0;

  comp.$watch(
    'messages.length',
    () => {
      const listEl = comp.el.querySelector('.chat-messages');
      Object.defineProperty(listEl, 'scrollHeight', {
        configurable: true,
        get: () => listEl.querySelectorAll('li').length * 24,
      });
      listEl.scrollTop = listEl.scrollHeight;
      observedScrollTop = listEl.scrollTop;
      observedCount = listEl.querySelectorAll('li').length;
    },
    { flush: 'post' },
  );

  comp.state.messages = ['hello', 'world', 'avenx'];
  assert.strictEqual(observedScrollTop, -1, 'post watcher must not run before DOM patch');

  await comp.$nextTick();
  assert.strictEqual(observedCount, 3);
  assert.strictEqual(observedScrollTop, 72);

  comp.unmount();
  host.remove();
  console.log('  ✅ Documented { flush: "post" } chat scroll example passed.');
}

async function runTests() {
  try {
    testWatchKeyString();
    testWatchPathString();
    testWatchGetter();
    testWatchImmediate();
    testWatchDeep();
    testWatcherTeardown();
    testWatchArrayOfSources();
    testWatchMethodAndDestroy();
    testDeclarativeWatchOption();
    testUnmountedRegistration();
    await testWatchFlushDomTiming();
    await testWatchFlushChatScrollExample();
    console.log('✅ All $watch API tests passed!');
  } catch (error) {
    console.error('❌ $watch API tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
