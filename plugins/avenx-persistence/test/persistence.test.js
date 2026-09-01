import assert from 'assert';
import '../../../test/helpers/register-happy-dom.js';
import { AvenxApp, AvenxComponent, bridge, nextTick } from '../../../lib/core/index.js';
import {
  avenxPersistence,
  browserLocalStorage,
  browserSessionStorage,
  createAvenxPersistence,
  memoryStorage,
  persist,
} from '../src/index.js';
import { getController } from '../src/registry.js';
import { captureLogs, countingStorage, installWebStorage, loggedMatching, reset, seed } from './helpers.js';

captureLogs();

const mountTarget = document.createElement('div');
mountTarget.id = 'app';
document.body.appendChild(mountTarget);

/**
 * Creates an app bound to the shared mount target.
 * @returns {AvenxApp} A fresh application instance.
 */
function createApp() {
  return new AvenxApp({ target: '#app' });
}

/**
 * Builds a persisted counter bridge, the fixture most scenarios below use.
 * @param {object} options - The persist() options; `key` defaults to 'counter'.
 * @returns {object} The bridge instance.
 */
function counterBridge(options) {
  return bridge(
    persist(
      {
        state: { count: 0, label: 'idle', session: { token: null } },

        /**
         * @returns {boolean} True while the counter is untouched.
         */
        get isPristine() {
          return this.count === 0;
        },

        increment() {
          this.count++;
        },

        rename(label) {
          this.label = label;
        },

        signIn(token) {
          this.session.token = token;
        },
      },
      { key: 'counter', ...options },
    ),
  );
}

// ---------------------------------------------------------------------------
// 1. Plugin installation and lifecycle
// ---------------------------------------------------------------------------

/**
 * The plugin installs through app.use() in both supported shapes and exposes
 * its handle on the application.
 */
async function testPluginInstallation() {
  console.log('  1. Testing plugin installation and lifecycle...');
  reset();

  const app = createApp();
  app.use(avenxPersistence, { prefix: 'shop:' });

  assert.ok(app.$persistence, 'app.$persistence is installed');
  assert.deepStrictEqual(app.$persistence.keys(), [], 'no persisted bridges are registered yet');

  // AvenxApp already guards against installing the same plugin twice.
  app.use(avenxPersistence);
  assert.ok(app.$persistence, 'a repeated install leaves the handle in place');

  const configured = createAvenxPersistence({ prefix: 'other:' });
  const secondApp = createApp();
  secondApp.use(configured);
  assert.ok(secondApp.$persistence, 'the factory form installs too');

  assert.throws(
    () => avenxPersistence.install(null),
    /Invalid AvenxApp instance/,
    'installing without an app is rejected',
  );
  assert.throws(
    () => avenxPersistence.install(createApp(), { version: 'one' }),
    /"version" that is not a finite number/,
    'bad defaults are rejected at install time',
  );

  console.log('  ✅ Plugin installation and lifecycle passed!');
}

// ---------------------------------------------------------------------------
// 2. Initial state, with nothing persisted yet
// ---------------------------------------------------------------------------

/**
 * A first-time visitor sees the bridge's declared defaults, and an application
 * that only reads state writes nothing.
 */
async function testInitialState() {
  console.log('  2. Testing initial state with no persisted value...');
  reset();

  const storage = countingStorage();
  const counter = counterBridge({ storage });

  assert.strictEqual(counter.count, 0, 'the declared default is used');
  assert.strictEqual(counter.label, 'idle', 'every declared default is used');
  assert.strictEqual(counter.isPristine, true, 'getters still work through the wrapped definition');

  await nextTick();
  assert.strictEqual(storage.counts.writes, 0, 'reading state alone never writes');
  assert.strictEqual(storage.counts.reads, 1, 'storage is consulted exactly once, at hydration');

  console.log('  ✅ Initial state with no persisted value passed!');
}

// ---------------------------------------------------------------------------
// 3. State -> storage
// ---------------------------------------------------------------------------

/**
 * A state change reaches storage, wrapped in the versioned envelope.
 */
async function testPersistingChanges() {
  console.log('  3. Testing persistence of state changes...');
  reset();

  const storage = countingStorage();
  const counter = counterBridge({ storage, version: 3 });

  counter.increment();
  await nextTick();

  const stored = JSON.parse(storage.getItem('avenx:counter'));
  assert.strictEqual(stored.avenx, 1, 'the envelope records its own format version');
  assert.strictEqual(stored.version, 3, 'the envelope records the application schema version');
  assert.deepStrictEqual(
    stored.state,
    { count: 1, label: 'idle', session: { token: null } },
    'every persisted key is stored',
  );
  assert.ok(!('isPristine' in stored.state), 'getters are derived, not persisted');

  counter.signIn('abc');
  await nextTick();
  assert.strictEqual(
    JSON.parse(storage.getItem('avenx:counter')).state.session.token,
    'abc',
    'a nested mutation is persisted',
  );

  console.log('  ✅ Persisting state changes passed!');
}

// ---------------------------------------------------------------------------
// 4. Write economy: no loops, no redundant writes
// ---------------------------------------------------------------------------

/**
 * Many mutations in one tick produce one write, a write that would reproduce
 * what storage already holds is skipped, and restoring never writes back.
 */
async function testWriteEconomy() {
  console.log('  4. Testing write coalescing and loop avoidance...');
  reset();

  const storage = countingStorage();
  const counter = counterBridge({ storage });

  counter.increment();
  counter.increment();
  counter.increment();
  await nextTick();
  assert.strictEqual(storage.counts.writes, 1, 'a burst of mutations in one tick collapses into one write');
  assert.strictEqual(counter.count, 3, 'every mutation still applied');

  counter.rename('idle');
  await nextTick();
  assert.strictEqual(storage.counts.writes, 1, 'assigning the value already stored writes nothing');

  // $dispose runs the bridge cleanup and resets state; the next read re-runs
  // setup(), which restores. That round trip is the one a page reload makes.
  const writesBeforeReload = storage.counts.writes;
  counter.$dispose();
  assert.strictEqual(counter.count, 3, 'state came back from storage after a teardown');
  await nextTick();
  assert.strictEqual(storage.counts.writes, writesBeforeReload, 'restoring state does not write it straight back');

  console.log('  ✅ Write coalescing and loop avoidance passed!');
}

// ---------------------------------------------------------------------------
// 5. Storage -> state
// ---------------------------------------------------------------------------

/**
 * State left behind by an earlier page load is restored, and keys that are
 * absent from it keep the bridge's declared defaults.
 */
async function testRestoringState() {
  console.log('  5. Testing restoration of persisted state...');
  reset();

  const storage = countingStorage();
  seed(storage, 'avenx:counter', { count: 42, session: { token: 'xyz' } });

  const counter = counterBridge({ storage });
  assert.strictEqual(counter.count, 42, 'a persisted value is restored');
  assert.strictEqual(counter.session.token, 'xyz', 'nested persisted values are restored');
  assert.strictEqual(counter.label, 'idle', 'a key absent from storage keeps its declared default');
  assert.strictEqual(counter.isPristine, false, 'getters recompute from the restored state');

  counter.increment();
  await nextTick();
  assert.strictEqual(
    JSON.parse(storage.getItem('avenx:counter')).state.count,
    43,
    'the restored value is the base for later changes',
  );

  console.log('  ✅ Restoring persisted state passed!');
}

/**
 * Restoration can be switched off while saving continues.
 */
async function testRestoreDisabled() {
  console.log('  5b. Testing restore: false...');
  reset();

  const storage = countingStorage();
  seed(storage, 'avenx:counter', { count: 99 });

  const counter = counterBridge({ storage, restore: false });
  assert.strictEqual(counter.count, 0, 'nothing was restored');
  assert.strictEqual(storage.counts.reads, 0, 'storage was not even read');

  counter.increment();
  await nextTick();
  assert.strictEqual(JSON.parse(storage.getItem('avenx:counter')).state.count, 1, 'saving still happens');

  console.log('  ✅ restore: false passed!');
}

// ---------------------------------------------------------------------------
// 6. Several persisted bridges side by side
// ---------------------------------------------------------------------------

/**
 * Two persisted bridges keep independent keys, and a shared key is refused.
 */
async function testMultipleBridges() {
  console.log('  6. Testing multiple persisted bridges...');
  reset();

  const storage = memoryStorage();
  seed(storage, 'avenx:theme', { mode: 'dark' });

  const theme = bridge(
    persist(
      {
        state: { mode: 'light' },
        toggle() {
          this.mode = this.mode === 'light' ? 'dark' : 'light';
        },
      },
      { key: 'theme', storage },
    ),
  );
  const counter = counterBridge({ storage });

  assert.strictEqual(theme.mode, 'dark', 'the theme bridge restored its own key');
  assert.strictEqual(counter.count, 0, 'the counter bridge is unaffected by it');

  theme.toggle();
  counter.increment();
  await nextTick();

  assert.strictEqual(JSON.parse(storage.getItem('avenx:theme')).state.mode, 'light', 'each bridge writes its own key');
  assert.strictEqual(JSON.parse(storage.getItem('avenx:counter')).state.count, 1, 'the other key is untouched');

  const app = createApp();
  app.use(avenxPersistence);
  assert.deepStrictEqual(app.$persistence.keys().sort(), ['counter', 'theme'], 'both keys are registered');

  assert.throws(
    () => persist({ state: { mode: 'light' } }, { key: 'theme', storage }),
    /already used by another persisted bridge/,
    'two bridges may not share one key',
  );

  console.log('  ✅ Multiple persisted bridges passed!');
}

// ---------------------------------------------------------------------------
// 7. Keys and prefixes
// ---------------------------------------------------------------------------

/**
 * The storage key is the prefix plus the key, and the prefix can be set
 * per bridge or once for the whole application.
 */
async function testKeysAndPrefixes() {
  console.log('  7. Testing custom keys and prefixes...');
  reset();

  const storage = memoryStorage();
  const scoped = bridge(
    persist(
      {
        state: { value: 1 },
        bump() {
          this.value++;
        },
      },
      { key: 'checkout/step', storage, prefix: 'shop::' },
    ),
  );
  scoped.bump();
  await nextTick();
  assert.ok(storage.getItem('shop::checkout/step'), 'the per-bridge prefix and key form the storage key');

  reset();
  const appStorage = memoryStorage();
  const app = createApp();
  app.use(avenxPersistence, { prefix: 'myapp:', storage: appStorage });

  const counter = counterBridge({});
  counter.increment();
  await nextTick();
  assert.ok(appStorage.getItem('myapp:counter'), 'application defaults reach a bridge that names neither');
  assert.strictEqual(appStorage.getItem('avenx:counter'), null, 'the built-in prefix was overridden');

  console.log('  ✅ Custom keys and prefixes passed!');
}

// ---------------------------------------------------------------------------
// 8. Storage adapters
// ---------------------------------------------------------------------------

/**
 * Any object with the Web Storage methods is a usable backend, including the
 * browser's own two areas.
 */
async function testStorageAdapters() {
  console.log('  8. Testing storage adapters...');
  reset();

  const written = [];
  const custom = {
    values: new Map(),
    getItem(key) {
      return this.values.has(key) ? this.values.get(key) : null;
    },
    setItem(key, value) {
      written.push(key);
      this.values.set(key, value);
    },
    removeItem(key) {
      this.values.delete(key);
    },
  };

  const counter = counterBridge({ storage: custom });
  counter.increment();
  await nextTick();
  assert.deepStrictEqual(written, ['avenx:counter'], 'the custom adapter received the write');

  reset();
  const restoreGlobals = installWebStorage();
  try {
    const sessionCounter = counterBridge({ key: 'session-counter', storage: browserSessionStorage() });
    sessionCounter.increment();
    await nextTick();
    assert.ok(globalThis.sessionStorage.getItem('avenx:session-counter'), 'sessionStorage is written through directly');

    reset();
    const localCounter = counterBridge({ key: 'local-counter', storage: browserLocalStorage() });
    localCounter.increment();
    await nextTick();
    assert.ok(globalThis.localStorage.getItem('avenx:local-counter'), 'localStorage is the browser default');
    assert.strictEqual(
      browserLocalStorage(),
      globalThis.localStorage,
      'the platform object is used as the adapter, unwrapped',
    );
  } finally {
    restoreGlobals();
  }

  // A browser that refuses to store anything must not stop the application:
  // the plugin degrades to memory, warns once, and carries on.
  reset();
  const blocked = installWebStorage({
    local: {
      getItem: () => null,
      setItem() {
        throw new Error('storage is disabled');
      },
      removeItem() {},
    },
  });
  try {
    const fallback = browserLocalStorage();
    const blockedCounter = counterBridge({ key: 'blocked-counter', storage: fallback });
    blockedCounter.increment();
    await nextTick();
    assert.strictEqual(blockedCounter.count, 1, 'the application keeps working with storage blocked');
    assert.strictEqual(loggedMatching('falling back to in-memory storage').length, 1, 'the fallback is reported once');
  } finally {
    blocked();
  }

  reset();
  assert.ok(browserLocalStorage(), 'an environment with no localStorage at all still yields an adapter');
  assert.strictEqual(loggedMatching('localStorage is unavailable').length, 1, 'and says so');

  reset();
  const scratch = memoryStorage();
  scratch.setItem('a', 1);
  assert.strictEqual(scratch.getItem('a'), '1', 'the memory adapter stores strings');
  assert.strictEqual(scratch.getItem('missing'), null, 'an absent entry reads as null');
  scratch.removeItem('a');
  assert.strictEqual(scratch.getItem('a'), null, 'removal works');

  assert.throws(
    () => persist({ state: { a: 1 } }, { key: 'bad-adapter', storage: { getItem() {} } }),
    /not a storage adapter/,
    'an incomplete adapter is rejected where it is declared',
  );

  console.log('  ✅ Storage adapters passed!');
}

// ---------------------------------------------------------------------------
// 9. Choosing what is persisted
// ---------------------------------------------------------------------------

/**
 * include and exclude narrow what leaves the application, and a name that
 * matches no declared state key is reported rather than ignored.
 */
async function testIncludeExclude() {
  console.log('  9. Testing include and exclude...');
  reset();

  const storage = memoryStorage();
  const included = counterBridge({ storage, include: ['count'] });
  included.increment();
  included.rename('busy');
  await nextTick();

  const includedState = JSON.parse(storage.getItem('avenx:counter')).state;
  assert.deepStrictEqual(includedState, { count: 1 }, 'only the included key is persisted');

  reset();
  const otherStorage = memoryStorage();
  const excluded = counterBridge({ storage: otherStorage, exclude: ['session'] });
  excluded.increment();
  excluded.signIn('secret');
  await nextTick();

  const excludedState = JSON.parse(otherStorage.getItem('avenx:counter')).state;
  assert.deepStrictEqual(excludedState, { count: 1, label: 'idle' }, 'the excluded key never leaves the application');

  reset();
  assert.throws(
    () => counterBridge({ include: ['typo'] }),
    /which the bridge does not declare in state/,
    'an unknown include key is refused',
  );
  reset();
  assert.throws(
    () => counterBridge({ exclude: ['typo'] }),
    /which the bridge does not declare in state/,
    'an unknown exclude key is refused',
  );
  reset();
  assert.throws(
    () => counterBridge({ include: ['count'], exclude: ['label'] }),
    /both "include" and "exclude"/,
    'the two are mutually exclusive',
  );
  reset();
  assert.throws(
    () => counterBridge({ exclude: ['count', 'label', 'session'] }),
    /would persist no state at all/,
    'excluding everything is a mistake worth naming',
  );

  console.log('  ✅ include and exclude passed!');
}

// ---------------------------------------------------------------------------
// 10. Serialization
// ---------------------------------------------------------------------------

/**
 * A custom serializer sees a detached plain snapshot and owns the whole
 * round trip.
 */
async function testCustomSerialization() {
  console.log('  10. Testing custom serialization...');
  reset();

  const storage = memoryStorage();
  const seen = [];

  /**
   * A deliberately unusual format, to prove nothing assumes JSON.
   * @param {object} envelope - The envelope to encode.
   * @returns {string} The encoded envelope.
   */
  const serialize = (envelope) => {
    seen.push(envelope);
    return `v${envelope.version}|${JSON.stringify(envelope.state)}`;
  };

  /**
   * @param {string} raw - The encoded envelope.
   * @returns {object} The decoded envelope.
   */
  const deserialize = (raw) => {
    const separator = raw.indexOf('|');
    return { avenx: 1, version: Number(raw.slice(1, separator)), state: JSON.parse(raw.slice(separator + 1)) };
  };

  const counter = counterBridge({ storage, version: 7, serialize, deserialize });
  counter.increment();
  await nextTick();

  assert.strictEqual(
    storage.getItem('avenx:counter'),
    'v7|{"count":1,"label":"idle","session":{"token":null}}',
    'the custom format was stored',
  );
  assert.strictEqual(seen[0].version, 7, 'the serializer receives the envelope');
  assert.ok(!seen[0].state.__isReactive, 'the serializer receives a plain snapshot');
  seen[0].state.count = 999;
  assert.strictEqual(counter.count, 1, 'mutating the snapshot cannot reach application state');

  counter.$dispose();
  assert.strictEqual(counter.count, 1, 'the custom format round-trips back into state');

  console.log('  ✅ Custom serialization passed!');
}

// ---------------------------------------------------------------------------
// 11. Interaction with Avenx reactivity
// ---------------------------------------------------------------------------

/**
 * Persistence rides on the same reactivity a template does: restored state
 * renders, and a change both re-renders and persists.
 */
async function testReactivityIntegration() {
  console.log('  11. Testing interaction with Avenx reactivity...');
  reset();

  const storage = countingStorage();
  seed(storage, 'avenx:counter', { count: 5, label: 'restored' });
  const counter = counterBridge({ storage });

  const component = new AvenxComponent(
    {},
    {},
    { counter },
    '<div><span class="count">{{ counter.count }}</span><em>{{ counter.label }}</em></div>',
    {},
  );
  const root = document.createElement('div');
  document.body.appendChild(root);
  component.mount(root);

  assert.ok(root.textContent.includes('5'), 'the restored value rendered');
  assert.ok(root.textContent.includes('restored'), 'every restored value rendered');

  const writesBefore = storage.counts.writes;
  counter.increment();
  await nextTick();

  assert.ok(root.textContent.includes('6'), 'the mutation re-rendered the template');
  assert.strictEqual(storage.counts.writes, writesBefore + 1, 'and produced exactly one write');
  assert.strictEqual(JSON.parse(storage.getItem('avenx:counter')).state.count, 6, 'the DOM and storage agree');

  component.unmount();
  counter.increment();
  await nextTick();
  assert.strictEqual(
    JSON.parse(storage.getItem('avenx:counter')).state.count,
    7,
    'persistence outlives the components that read it',
  );

  console.log('  ✅ Interaction with Avenx reactivity passed!');
}

// ---------------------------------------------------------------------------
// 12. Teardown
// ---------------------------------------------------------------------------

/**
 * $dispose runs the persistence cleanup, and a definition's own setup cleanup
 * still runs alongside it.
 */
async function testCleanup() {
  console.log('  12. Testing cleanup and unsubscription...');
  reset();

  const storage = countingStorage();
  let setupRuns = 0;
  let cleanupRuns = 0;

  const tracked = bridge(
    persist(
      {
        state: { value: 0 },
        setup() {
          setupRuns++;
          return () => {
            cleanupRuns++;
          };
        },
        bump() {
          this.value++;
        },
      },
      { key: 'tracked', storage },
    ),
  );

  tracked.bump();
  await nextTick();
  assert.strictEqual(setupRuns, 1, "the definition's own setup ran");
  assert.strictEqual(cleanupRuns, 0, 'and has not been cleaned up yet');

  const controller = getController('tracked');
  assert.strictEqual(controller.active, true, 'the controller is watching');

  const writesBeforeDispose = storage.counts.writes;
  tracked.$dispose();
  assert.strictEqual(cleanupRuns, 1, "the definition's own cleanup ran");
  assert.strictEqual(controller.active, false, 'the watcher was torn down');

  // $dispose resets state to the declared defaults. With the watcher gone that
  // reset must not be mistaken for a change worth persisting.
  await nextTick();
  assert.strictEqual(storage.counts.writes, writesBeforeDispose, 'the reset performed by $dispose was not persisted');
  assert.strictEqual(
    JSON.parse(storage.getItem('avenx:tracked')).state.value,
    1,
    'the last real value is still stored',
  );

  assert.strictEqual(tracked.value, 1, 'the next read restores and re-subscribes');
  assert.strictEqual(setupRuns, 2, 'setup ran again on re-initialization');
  assert.strictEqual(getController('tracked').active, true, 'the controller is watching again');

  tracked.bump();
  await nextTick();
  assert.strictEqual(
    JSON.parse(storage.getItem('avenx:tracked')).state.value,
    2,
    'and saving works after the round trip',
  );

  console.log('  ✅ Cleanup and unsubscription passed!');
}

// ---------------------------------------------------------------------------
// 13. app.$persistence
// ---------------------------------------------------------------------------

/**
 * The application handle can write early and discard stored data.
 */
async function testPersistenceHandle() {
  console.log('  13. Testing app.$persistence...');
  reset();

  const storage = countingStorage();
  const app = createApp();
  app.use(avenxPersistence, { storage });

  const counter = counterBridge({});
  const theme = bridge(
    persist(
      {
        state: { mode: 'light' },
        toggle() {
          this.mode = 'dark';
        },
      },
      { key: 'theme' },
    ),
  );

  counter.increment();
  theme.toggle();

  // Before the tick the write is still queued; flush() is what a pagehide
  // handler would call.
  app.$persistence.flush();
  assert.strictEqual(
    JSON.parse(storage.getItem('avenx:counter')).state.count,
    1,
    'flush wrote the counter immediately',
  );
  assert.strictEqual(JSON.parse(storage.getItem('avenx:theme')).state.mode, 'dark', 'flush wrote every key');

  await nextTick();
  assert.strictEqual(storage.counts.writes, 2, 'the queued save found nothing left to do');

  app.$persistence.clear('theme');
  assert.strictEqual(storage.getItem('avenx:theme'), null, 'clear removed one key');
  assert.ok(storage.getItem('avenx:counter'), 'and left the others alone');
  assert.strictEqual(theme.mode, 'dark', 'clearing storage does not change live state');

  app.$persistence.clear();
  assert.strictEqual(storage.getItem('avenx:counter'), null, 'clear without a key removes every key');

  assert.throws(
    () => app.$persistence.clear('nope'),
    /no persisted bridge uses the key "nope"/,
    'an unknown key is named, not ignored',
  );

  console.log('  ✅ app.$persistence passed!');
}

// ---------------------------------------------------------------------------
// 14. persist() argument validation
// ---------------------------------------------------------------------------

/**
 * Configuration mistakes are refused where they are written.
 */
async function testValidation() {
  console.log('  14. Testing persist() validation...');
  reset();

  assert.throws(
    () => persist(null, { key: 'a' }),
    /expects a bridge definition object/,
    'a missing definition is refused',
  );
  assert.throws(() => persist({ state: {} }, {}), /requires a non-empty "key"/, 'a missing key is refused');
  assert.throws(() => persist({ state: {} }, { key: '  ' }), /requires a non-empty "key"/, 'a blank key is refused');
  assert.throws(
    () => persist({ count: 0 }, { key: 'a' }),
    /expects the definition to declare a "state" object/,
    'a definition without state is refused',
  );
  assert.throws(
    () => persist({ state: { a: 1 }, setup: 3 }, { key: 'a' }),
    /"setup" member that is not a function/,
    'a non-function setup is refused',
  );
  assert.throws(
    () => persist({ state: { a: 1 } }, { key: 'a', serialize: 'no' }),
    /"serialize" that is not a function/,
    'a non-function serializer is refused',
  );
  assert.throws(
    () => persist({ state: { a: 1 } }, { key: 'a', migrate: 'no' }),
    /"migrate" that is not a function/,
    'a non-function migrate is refused',
  );
  assert.throws(
    () => persist({ state: { a: 1 } }, { key: 'a', restore: 'yes' }),
    /"restore" that is not a boolean/,
    'a non-boolean restore is refused',
  );
  assert.throws(
    () => persist({ state: { a: 1 } }, { key: 'a', prefix: 5 }),
    /"prefix" that is not a string/,
    'a non-string prefix is refused',
  );

  assert.strictEqual(loggedMatching('[avenx-persistence]').length, 0, 'validation errors are thrown, not logged');

  console.log('  ✅ persist() validation passed!');
}

/**
 * Runs the suite.
 */
async function runTests() {
  console.log('🧪 Starting Avenx Persistence Plugin Test Suite...\n');

  await testPluginInstallation();
  await testInitialState();
  await testPersistingChanges();
  await testWriteEconomy();
  await testRestoringState();
  await testRestoreDisabled();
  await testMultipleBridges();
  await testKeysAndPrefixes();
  await testStorageAdapters();
  await testIncludeExclude();
  await testCustomSerialization();
  await testReactivityIntegration();
  await testCleanup();
  await testPersistenceHandle();
  await testValidation();

  console.log('\n🎉 ALL AVENX PERSISTENCE PLUGIN TESTS PASSED SUCCESSFULLY!\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failure in Avenx Persistence Plugin:');
    console.error(err);
    process.exit(1);
  });
