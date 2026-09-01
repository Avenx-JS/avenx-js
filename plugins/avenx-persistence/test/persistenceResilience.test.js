import assert from 'assert';
import '../../../test/helpers/register-happy-dom.js';
import { bridge, nextTick } from '../../../lib/core/index.js';
import { memoryStorage, persist } from '../src/index.js';
import { captureLogs, failingStorage, loggedMatching, quotaError, reset } from './helpers.js';

captureLogs();

/**
 * Builds a persisted bridge that records every failure the plugin reports.
 * @param {object} options - persist() options; `key` defaults to 'resilient'.
 * @returns {{instance: object, failures: object[], storage: object}} The fixture.
 */
function makeBridge(options = {}) {
  const failures = [];
  const storage = options.storage || memoryStorage();
  const instance = bridge(
    persist(
      {
        state: { count: 0, note: 'ok' },
        increment() {
          this.count++;
        },
      },
      {
        key: 'resilient',
        storage,
        onError: (failure) => failures.push(failure),
        ...options,
      },
    ),
  );
  return { instance, failures, storage };
}

/**
 * Asserts that exactly one failure was reported, with the expected phase.
 * @param {object[]} failures - The collected failures.
 * @param {string} phase - The expected phase.
 * @param {string} what - What the scenario was testing, for the message.
 */
function assertPhase(failures, phase, what) {
  assert.strictEqual(failures.length, 1, `${what}: exactly one failure was reported, got ${failures.length}`);
  assert.strictEqual(failures[0].phase, phase, `${what}: the failure phase is "${phase}"`);
  assert.strictEqual(failures[0].key, 'resilient', `${what}: the failure names the key`);
  assert.strictEqual(typeof failures[0].message, 'string', `${what}: the failure carries a message`);
}

// ---------------------------------------------------------------------------
// 1. Unreadable persisted data
// ---------------------------------------------------------------------------

/**
 * Data that cannot be parsed, was written by something else, or does not look
 * like an envelope is ignored, and the bridge starts from its own defaults.
 */
async function testMalformedData() {
  console.log('  1. Testing malformed persisted data...');

  const cases = [
    ['not json at all', 'deserialize', 'a value that is not JSON'],
    ['"a string"', 'malformed', 'a JSON value that is not an object'],
    ['[1, 2, 3]', 'malformed', 'a JSON array'],
    ['{"count":5}', 'malformed', 'a bare state object from another library'],
    ['{"avenx":99,"version":1,"state":{}}', 'malformed', 'an envelope format this build does not know'],
    ['{"avenx":1,"state":{}}', 'malformed', 'an envelope with no version'],
    ['{"avenx":1,"version":"one","state":{}}', 'malformed', 'an envelope with an unusable version'],
    ['{"avenx":1,"version":1}', 'malformed', 'an envelope with no state'],
    ['{"avenx":1,"version":1,"state":[]}', 'malformed', 'an envelope whose state is not an object'],
  ];

  for (const [stored, phase, description] of cases) {
    reset();
    const storage = memoryStorage();
    storage.setItem('avenx:resilient', stored);
    const { instance, failures } = makeBridge({ storage });

    assert.strictEqual(instance.count, 0, `${description}: the declared default is kept`);
    assertPhase(failures, phase, description);

    // The application is unharmed: it can still change and persist state.
    instance.increment();
    await nextTick();
    assert.strictEqual(JSON.parse(storage.getItem('avenx:resilient')).state.count, 1, `${description}: persistence recovers on the next change`);
  }

  console.log('  ✅ Malformed persisted data passed!');
}

/**
 * Persisted keys the bridge no longer declares are dropped rather than
 * resurrected as state nothing reads.
 */
async function testUnknownPersistedKeys() {
  console.log('  2. Testing persisted keys the bridge no longer declares...');
  reset();

  const storage = memoryStorage();
  storage.setItem('avenx:resilient', JSON.stringify({ avenx: 1, version: 1, state: { count: 4, removedInV2: 'stale' } }));
  const { instance, failures } = makeBridge({ storage });

  assert.strictEqual(instance.count, 4, 'the keys that still exist are restored');
  assert.strictEqual(instance.removedInV2, undefined, 'a key the bridge no longer declares is not added back');
  assertPhase(failures, 'malformed', 'an unknown persisted key');
  assert.ok(failures[0].message.includes('1 key(s)'), 'the report counts them');
  assert.ok(!failures[0].message.includes('stale'), 'and never names the persisted value');

  console.log('  ✅ Unknown persisted keys passed!');
}

// ---------------------------------------------------------------------------
// 3. Storage that refuses
// ---------------------------------------------------------------------------

/**
 * A storage backend that throws on read, write or removal is reported and
 * survived.
 */
async function testStorageFailures() {
  console.log('  3. Testing storage failures...');

  reset();
  const unreadable = makeBridge({ storage: failingStorage({ onGet: new Error('read denied') }) });
  assert.strictEqual(unreadable.instance.count, 0, 'an unreadable store leaves the defaults in place');
  assertPhase(unreadable.failures, 'read', 'an unreadable store');

  reset();
  const unwritable = makeBridge({ storage: failingStorage({ onSet: new Error('write denied') }) });
  unwritable.instance.increment();
  await nextTick();
  assert.strictEqual(unwritable.instance.count, 1, 'the application state change still happened');
  assertPhase(unwritable.failures, 'write', 'an unwritable store');

  reset();
  const unclearable = makeBridge({ storage: failingStorage({ onRemove: new Error('removal denied') }) });
  unclearable.instance.increment();
  await nextTick();
  unclearable.failures.length = 0;
  const { getController } = await import('../src/registry.js');
  getController('resilient').clear();
  assertPhase(unclearable.failures, 'write', 'a store that refuses removal');

  console.log('  ✅ Storage failures passed!');
}

/**
 * A full quota is reported as its own phase, so an application can tell it
 * apart from a store that is broken, and a later write still succeeds once
 * there is room again.
 */
async function testQuotaExceeded() {
  console.log('  4. Testing quota exhaustion...');
  reset();

  const inner = memoryStorage();
  let full = true;
  const storage = {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      if (full) {
        throw quotaError();
      }
      inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
  };

  const { instance, failures } = makeBridge({ storage });

  instance.increment();
  await nextTick();
  assertPhase(failures, 'quota', 'a full quota');
  assert.ok(failures[0].message.includes('quota'), 'the message says what happened');
  assert.strictEqual(instance.count, 1, 'the application carries on');

  // Nothing was recorded as written, so the next change retries rather than
  // deciding storage is already up to date.
  full = false;
  instance.increment();
  await nextTick();
  assert.strictEqual(JSON.parse(inner.getItem('avenx:resilient')).state.count, 2, 'the write is retried once storage accepts it again');

  console.log('  ✅ Quota exhaustion passed!');
}

// ---------------------------------------------------------------------------
// 5. Serializers that fail
// ---------------------------------------------------------------------------

/**
 * A serializer that throws, or that returns something other than a string,
 * loses the write and nothing else.
 */
async function testSerializationFailures() {
  console.log('  5. Testing serialization failures...');

  reset();
  const throwing = makeBridge({
    serialize: () => {
      throw new Error('cannot encode');
    },
  });
  throwing.instance.increment();
  await nextTick();
  assert.strictEqual(throwing.instance.count, 1, 'state still changed');
  assert.strictEqual(throwing.storage.getItem('avenx:resilient'), null, 'nothing was written');
  assertPhase(throwing.failures, 'serialize', 'a serializer that throws');

  reset();
  const wrongType = makeBridge({ serialize: () => ({ not: 'a string' }) });
  wrongType.instance.increment();
  await nextTick();
  assertPhase(wrongType.failures, 'serialize', 'a serializer that returns a non-string');
  assert.ok(wrongType.failures[0].message.includes('object'), 'the report names the type it got');

  reset();
  const badDeserializer = memoryStorage();
  badDeserializer.setItem('avenx:resilient', '{}');
  const failingParse = makeBridge({
    storage: badDeserializer,
    deserialize: () => {
      throw new Error('cannot decode');
    },
  });
  assert.strictEqual(failingParse.instance.count, 0, 'the defaults are kept');
  assertPhase(failingParse.failures, 'deserialize', 'a deserializer that throws');

  // State that JSON cannot represent is the everyday form of this failure: a
  // node that points back at its parent serializes with neither the default
  // serializer nor most custom ones.
  reset();
  const circularStorage = memoryStorage();
  const failures = [];
  const circular = bridge(
    persist(
      {
        state: { tree: null },
        buildCycle() {
          const node = { name: 'root', parent: null };
          node.parent = node;
          this.tree = node;
        },
      },
      { key: 'resilient', storage: circularStorage, onError: (failure) => failures.push(failure) },
    ),
  );

  circular.buildCycle();
  await nextTick();
  assert.strictEqual(circular.tree.name, 'root', 'the cycle is still perfectly good application state');
  assert.strictEqual(circularStorage.getItem('avenx:resilient'), null, 'but it was not persisted');
  assertPhase(failures, 'serialize', 'state holding a cycle');

  console.log('  ✅ Serialization failures passed!');
}

// ---------------------------------------------------------------------------
// 6. Versioning and stale data
// ---------------------------------------------------------------------------

/**
 * State written by an earlier release is discarded unless a migration accepts
 * responsibility for it.
 */
async function testVersioning() {
  console.log('  6. Testing versioning and stale state...');

  reset();
  const staleStorage = memoryStorage();
  staleStorage.setItem('avenx:resilient', JSON.stringify({ avenx: 1, version: 1, state: { count: 7 } }));
  const stale = makeBridge({ storage: staleStorage, version: 2 });
  assert.strictEqual(stale.instance.count, 0, 'data from an older version does not reach a newer application');
  assertPhase(stale.failures, 'version', 'stale persisted data');
  assert.ok(stale.failures[0].message.includes('version 1'), 'the report names the version it found');
  assert.ok(stale.failures[0].message.includes('expects 2'), 'and the version it wanted');

  reset();
  const migratedStorage = memoryStorage();
  migratedStorage.setItem('avenx:resilient', JSON.stringify({ avenx: 1, version: 1, state: { total: 7 } }));
  const seenVersions = [];
  const migrated = makeBridge({
    storage: migratedStorage,
    version: 2,
    migrate: (state, from, to) => {
      seenVersions.push([from, to]);
      return { count: state.total };
    },
  });
  assert.strictEqual(migrated.instance.count, 7, 'a migration upgrades the persisted shape');
  assert.deepStrictEqual(seenVersions, [[1, 2]], 'migrate receives both versions');
  assert.strictEqual(migrated.failures.length, 0, 'a successful migration reports nothing');

  migrated.instance.increment();
  await nextTick();
  const rewritten = JSON.parse(migratedStorage.getItem('avenx:resilient'));
  assert.strictEqual(rewritten.version, 2, 'the next write records the current version');
  assert.strictEqual(rewritten.state.count, 8, 'and the migrated shape');

  reset();
  const declinedStorage = memoryStorage();
  declinedStorage.setItem('avenx:resilient', JSON.stringify({ avenx: 1, version: 1, state: { count: 7 } }));
  const declined = makeBridge({ storage: declinedStorage, version: 2, migrate: () => null });
  assert.strictEqual(declined.instance.count, 0, 'a migration may decline by returning null');
  assertPhase(declined.failures, 'migrate', 'a declined migration');

  reset();
  const brokenStorage = memoryStorage();
  brokenStorage.setItem('avenx:resilient', JSON.stringify({ avenx: 1, version: 1, state: { count: 7 } }));
  const broken = makeBridge({
    storage: brokenStorage,
    version: 2,
    migrate: () => {
      throw new Error('migration bug');
    },
  });
  assert.strictEqual(broken.instance.count, 0, 'a migration that throws discards the data rather than the application');
  assertPhase(broken.failures, 'migrate', 'a migration that throws');

  console.log('  ✅ Versioning and stale state passed!');
}

// ---------------------------------------------------------------------------
// 7. Reporting
// ---------------------------------------------------------------------------

/**
 * Every failure reaches the Avenx logger as well as the callback, an onError
 * that throws is contained, and no persisted value is ever written to a log.
 */
async function testReporting() {
  console.log('  7. Testing failure reporting...');
  reset();

  const storage = memoryStorage();
  storage.setItem('avenx:resilient', JSON.stringify({ avenx: 1, version: 1, state: { count: 4, secret: 'hunter2' } }));

  const instance = bridge(
    persist(
      {
        state: { count: 0 },
        increment() {
          this.count++;
        },
      },
      {
        key: 'resilient',
        storage,
        onError: () => {
          throw new Error('the application handler is broken');
        },
      },
    ),
  );

  assert.strictEqual(instance.count, 4, 'restoration succeeded despite the broken handler');
  assert.strictEqual(loggedMatching('[avenx-persistence]').length > 0, true, 'the failure reached the logger');
  assert.strictEqual(loggedMatching('onError callback threw').length, 1, 'a broken handler is reported rather than propagated');
  assert.strictEqual(loggedMatching('hunter2').length, 0, 'no persisted value appears in any log line');

  instance.increment();
  await nextTick();
  assert.strictEqual(JSON.parse(storage.getItem('avenx:resilient')).state.count, 5, 'the application is still persisting');

  console.log('  ✅ Failure reporting passed!');
}

/**
 * Runs the suite.
 */
async function runTests() {
  console.log('🧪 Starting Avenx Persistence Resilience Test Suite...\n');

  await testMalformedData();
  await testUnknownPersistedKeys();
  await testStorageFailures();
  await testQuotaExceeded();
  await testSerializationFailures();
  await testVersioning();
  await testReporting();

  console.log('\n🎉 ALL AVENX PERSISTENCE RESILIENCE TESTS PASSED SUCCESSFULLY!\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failure in Avenx Persistence Plugin:');
    console.error(err);
    process.exit(1);
  });
