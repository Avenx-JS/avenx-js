import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { bridge, isBridge, defineBridgeName } from '../../lib/core/runtime/bridge.js';
import { AvenxWatcher } from '../../lib/core/reactive/watcher.js';
import { DisposalScope, runInScope, getScope } from '../../lib/core/reactive/scope.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import * as runtime from '../../lib/core/index.js';

/**
 * Builds the bridge used across most cases: some state, a derived getter,
 * actions that mutate and emit, and a lazily initialised resource.
 * @returns {object} A fresh bridge instance.
 */
function makeAuthBridge() {
  return bridge({
    state: {
      user: null,
      status: 'anonymous',
      history: [],
    },

    get isLoggedIn() {
      return this.status === 'authenticated';
    },

    get displayName() {
      return this.user ? this.user.name : 'Guest';
    },

    login(user) {
      this.user = user;
      this.status = 'authenticated';
      this.history = [...this.history, 'login'];
      this.emit('login', user);
    },

    logout() {
      this.user = null;
      this.status = 'anonymous';
      this.emit('logout');
    },
  });
}

/**
 * Asserts that a function throws an AvenxError carrying a specific code.
 * @param {Function} fn - The function expected to throw.
 * @param {string} code - The expected AvenxErrorCodes value.
 * @param {string} label - Description used in the assertion message.
 */
function assertThrowsCode(fn, code, label) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `${label} should throw`);
  assert.strictEqual(thrown.code, code, `${label} should throw ${code}, got ${thrown.code}: ${thrown.message}`);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * A bridge exposes its state, derived values and actions, and nothing else.
 */
function testCreation() {
  console.log('🧪 Testing bridge creation and surface...');

  const auth = makeAuthBridge();

  assert.ok(isBridge(auth), 'the result should be recognised as a bridge');
  assert.strictEqual(auth.user, null, 'state is readable');
  assert.strictEqual(auth.status, 'anonymous', 'state is readable');
  assert.strictEqual(auth.displayName, 'Guest', 'getters are readable');
  assert.strictEqual(auth.isLoggedIn, false, 'getters compute from state');
  assert.strictEqual(typeof auth.login, 'function', 'actions are callable');
  assert.strictEqual(typeof auth.on, 'function', 'on() is part of the surface');
  assert.strictEqual(typeof auth.$dispose, 'function', '$dispose() is part of the surface');

  // Emission is the bridge's own capability, never a consumer's.
  assert.strictEqual(auth.emit, undefined, 'emit is not reachable from the instance');
  assert.strictEqual('emit' in auth, false, 'emit is not reported as present');

  assert.strictEqual(isBridge({}), false, 'a plain object is not a bridge');
  assert.strictEqual(isBridge(null), false, 'null is not a bridge');

  console.log('  ✅ Bridge surface is state + getters + actions + on/$dispose.');
}

/**
 * Actions keep a stable identity so they can be passed around and compared.
 */
function testActionIdentity() {
  console.log('🧪 Testing action identity and destructuring...');

  const auth = makeAuthBridge();
  assert.strictEqual(auth.login, auth.login, 'repeated access returns the same function');

  const { login } = auth;
  login({ name: 'Ada' });
  assert.strictEqual(auth.displayName, 'Ada', 'a destructured action stays bound to the bridge');

  console.log('  ✅ Actions are stable and pre-bound.');
}

/**
 * A bridge without state, actions or getters is valid: an event-only channel.
 */
function testMinimalBridges() {
  console.log('🧪 Testing minimal bridge shapes...');

  const empty = bridge({});
  assert.ok(isBridge(empty), 'an empty definition is valid');
  assert.deepStrictEqual({ ...empty }, {}, 'an empty bridge has no data');

  const notifications = bridge({
    ping() {
      this.emit('ping', Date.now());
    },
  });
  let seen = 0;
  notifications.on('ping', () => { seen++; });
  notifications.ping();
  assert.strictEqual(seen, 1, 'a stateless bridge still carries events');

  const dataOnly = bridge({ state: { theme: 'light' } });
  assert.strictEqual(dataOnly.theme, 'light', 'a bridge may be data only');

  console.log('  ✅ Empty, event-only and data-only bridges all work.');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * State changes through actions, and is read-only from outside.
 */
function testStateUpdates() {
  console.log('🧪 Testing state updates...');

  const auth = makeAuthBridge();
  auth.login({ name: 'Ada', role: 'admin' });

  assert.strictEqual(auth.user.name, 'Ada', 'action mutations are visible');
  assert.strictEqual(auth.status, 'authenticated', 'multiple keys update');
  assert.strictEqual(auth.isLoggedIn, true, 'getters see new state');
  // Reactive arrays are Proxies, so compare the values they hold.
  assert.deepStrictEqual([...auth.history], ['login'], 'array state updates');

  auth.logout();
  assert.strictEqual(auth.user, null, 'state resets through actions');
  assert.strictEqual(auth.displayName, 'Guest', 'getters follow');

  console.log('  ✅ State updates flow through actions.');
}

/**
 * Assigning or deleting state from outside is refused with an actionable error.
 */
function testStateIsReadOnlyForConsumers() {
  console.log('🧪 Testing consumer writes are refused...');

  const auth = makeAuthBridge();
  defineBridgeName('auth', auth);

  assertThrowsCode(() => { auth.user = { name: 'Mallory' }; }, AvenxErrorCodes.BRIDGE_READONLY_STATE, 'assigning state');
  assertThrowsCode(() => { auth.isLoggedIn = true; }, AvenxErrorCodes.BRIDGE_READONLY_STATE, 'assigning a getter');
  assertThrowsCode(() => { auth.brandNew = 1; }, AvenxErrorCodes.BRIDGE_READONLY_STATE, 'adding a property');
  assertThrowsCode(() => { delete auth.user; }, AvenxErrorCodes.BRIDGE_READONLY_STATE, 'deleting state');

  let message = '';
  try {
    auth.user = 1;
  } catch (error) {
    message = error.message;
  }
  assert.ok(message.includes('auth.user'), 'the error names the bridge and the member');
  assert.ok(message.includes('action'), 'the error points at the fix');

  assert.strictEqual(auth.user, null, 'no refused write leaked through');

  console.log('  ✅ Consumer writes are refused and explained.');
}

/**
 * Nested state is reactive, and the definition literal is never mutated.
 */
function testNestedStateAndIsolation() {
  console.log('🧪 Testing nested state and definition isolation...');

  const initial = { profile: { name: 'Guest', tags: ['a'] } };
  const prefs = bridge({
    state: initial,
    rename(name) { this.profile.name = name; },
    tag(value) { this.profile.tags.push(value); },
  });

  prefs.rename('Ada');
  prefs.tag('b');

  assert.strictEqual(prefs.profile.name, 'Ada', 'nested writes work');
  assert.deepStrictEqual([...prefs.profile.tags], ['a', 'b'], 'nested arrays mutate');
  assert.strictEqual(initial.profile.name, 'Guest', 'the definition literal is untouched');
  assert.deepStrictEqual(initial.profile.tags, ['a'], 'the definition array is untouched');

  console.log('  ✅ Nested state is reactive and the definition is copied.');
}

/**
 * Two bridges built from the same definition object do not share state.
 */
function testInstancesDoNotShareState() {
  console.log('🧪 Testing instances are independent...');

  const makeCounter = () => bridge({ state: { n: 0, items: [] }, bump() { this.n++; this.items.push(this.n); } });
  const a = makeCounter();
  const b = makeCounter();

  a.bump();
  a.bump();

  assert.strictEqual(a.n, 2, 'the first instance advanced');
  assert.strictEqual(b.n, 0, 'the second instance is untouched');
  assert.deepStrictEqual([...b.items], [], 'array state is not shared between instances');

  console.log('  ✅ Bridge instances are independent.');
}

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

/**
 * Reads inside a watcher subscribe to exactly the keys touched.
 */
function testReactiveTracking() {
  console.log('🧪 Testing reactive tracking of bridge reads...');

  const auth = makeAuthBridge();

  let userRuns = 0;
  const userWatcher = new AvenxWatcher(() => { userRuns++; return auth.displayName; }, null, { isEffect: true });
  let statusRuns = 0;
  const statusWatcher = new AvenxWatcher(() => { statusRuns++; return auth.status; }, null, { isEffect: true });

  assert.strictEqual(userRuns, 1, 'the watcher ran once to collect dependencies');

  auth.login({ name: 'Ada' });

  assert.ok(userRuns > 1, 'a dependent watcher re-ran after the change');
  assert.ok(statusRuns > 1, 'a watcher on another key also re-ran');
  assert.strictEqual(auth.displayName, 'Ada', 'the derived value is current');

  // A watcher that reads nothing from the bridge must not be woken by it.
  let unrelatedRuns = 0;
  const unrelated = new AvenxWatcher(() => { unrelatedRuns++; return 1; }, null, { isEffect: true });
  const before = unrelatedRuns;
  auth.logout();
  assert.strictEqual(unrelatedRuns, before, 'an unrelated watcher is not woken');

  userWatcher.teardown();
  statusWatcher.teardown();
  unrelated.teardown();

  console.log('  ✅ Tracking is per-key and does not over-notify.');
}

/**
 * A watcher reading only a getter still re-runs when the getter's inputs change.
 */
function testGetterTracking() {
  console.log('🧪 Testing tracking through getters...');

  const cart = bridge({
    state: { items: [] },
    get count() { return this.items.length; },
    get total() { return this.items.reduce((sum, item) => sum + item.price, 0); },
    add(item) { this.items = [...this.items, item]; },
  });

  let runs = 0;
  let last = null;
  const watcher = new AvenxWatcher(() => { runs++; last = cart.total; return last; }, null, { isEffect: true });

  cart.add({ price: 10 });
  cart.add({ price: 5 });

  assert.strictEqual(runs, 3, 'the watcher re-ran for each change');
  assert.strictEqual(last, 15, 'the derived total is correct');
  assert.strictEqual(cart.count, 2, 'other getters agree');

  watcher.teardown();
  console.log('  ✅ Getters propagate reactivity to their readers.');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Events reach every subscriber with the emitted payload.
 */
function testEvents() {
  console.log('🧪 Testing events and payloads...');

  const auth = makeAuthBridge();
  const first = [];
  const second = [];

  auth.on('login', (user) => first.push(user.name));
  auth.on('login', (user) => second.push(user.name));
  auth.on('logout', () => first.push('out'));

  auth.login({ name: 'Ada' });
  auth.logout();

  assert.deepStrictEqual(first, ['Ada', 'out'], 'the first listener saw both events');
  assert.deepStrictEqual(second, ['Ada'], 'the second listener saw only what it subscribed to');

  let payload = 'unset';
  auth.on('logout', (value) => { payload = value; });
  auth.logout();
  assert.strictEqual(payload, undefined, 'an event without a payload delivers undefined');

  console.log('  ✅ Events fan out with their payloads.');
}

/**
 * Unsubscribing works, is idempotent, and never affects other listeners.
 */
function testUnsubscribe() {
  console.log('🧪 Testing unsubscribe...');

  const auth = makeAuthBridge();
  const seen = [];

  const off = auth.on('login', () => seen.push('a'));
  auth.on('login', () => seen.push('b'));

  auth.login({ name: 'One' });
  off();
  off(); // idempotent
  auth.login({ name: 'Two' });

  assert.deepStrictEqual(seen, ['a', 'b', 'b'], 'only the released listener stopped');

  console.log('  ✅ Unsubscribing is precise and idempotent.');
}

/**
 * The same handler subscribed twice is only registered once.
 */
function testDuplicateSubscription() {
  console.log('🧪 Testing duplicate subscriptions...');

  const auth = makeAuthBridge();
  let calls = 0;
  const handler = () => { calls++; };

  const offA = auth.on('login', handler);
  const offB = auth.on('login', handler);

  auth.login({ name: 'Ada' });
  assert.strictEqual(calls, 1, 'the same handler runs once, not twice');

  offA();
  offB();
  auth.login({ name: 'Ada' });
  assert.strictEqual(calls, 1, 'both handles release the same registration');

  console.log('  ✅ Duplicate subscriptions do not double-fire.');
}

/**
 * A throwing listener is contained: the others still run.
 */
function testListenerErrorIsolation() {
  console.log('🧪 Testing listener error isolation...');

  const auth = makeAuthBridge();
  const reached = [];
  const originalError = console.error;
  console.error = () => {};

  try {
    auth.on('login', () => { throw new Error('listener exploded'); });
    auth.on('login', () => reached.push('second'));
    auth.login({ name: 'Ada' });
  } finally {
    console.error = originalError;
  }

  assert.deepStrictEqual(reached, ['second'], 'a faulty listener does not stop the rest');
  assert.strictEqual(auth.displayName, 'Ada', 'the action completed');

  console.log('  ✅ One faulty listener cannot break the others.');
}

/**
 * Listeners may subscribe or unsubscribe while an event is being delivered.
 */
function testMutationDuringEmit() {
  console.log('🧪 Testing subscription changes during emit...');

  const hub = bridge({ fire() { this.emit('tick'); } });
  const order = [];

  const offSecond = hub.on('tick', () => order.push('second'));
  hub.on('tick', () => {
    order.push('first-removes-second');
    offSecond();
  });

  hub.fire();
  const afterFirstRound = [...order];
  hub.fire();

  assert.ok(afterFirstRound.includes('second'), 'listeners registered before the emit all run');
  assert.strictEqual(
    order.filter((entry) => entry === 'second').length,
    1,
    'a listener removed during delivery does not run again',
  );

  console.log('  ✅ Emitting is safe while the listener set changes.');
}

/**
 * Invalid event names and handlers are refused rather than silently ignored.
 */
function testInvalidEventUsage() {
  console.log('🧪 Testing invalid event usage...');

  const auth = makeAuthBridge();

  assertThrowsCode(() => auth.on('', () => {}), AvenxErrorCodes.BRIDGE_INVALID_EVENT, 'an empty event name');
  assertThrowsCode(() => auth.on(null, () => {}), AvenxErrorCodes.BRIDGE_INVALID_EVENT, 'a null event name');
  assertThrowsCode(() => auth.on('login'), AvenxErrorCodes.BRIDGE_INVALID_EVENT, 'a missing handler');
  assertThrowsCode(() => auth.on('login', 'nope'), AvenxErrorCodes.BRIDGE_INVALID_EVENT, 'a non-function handler');

  const emitter = bridge({ bad() { this.emit(42); } });
  assertThrowsCode(() => emitter.bad(), AvenxErrorCodes.BRIDGE_INVALID_EVENT, 'emitting a non-string name');

  console.log('  ✅ Invalid subscriptions and emissions are refused.');
}

// ---------------------------------------------------------------------------
// Multiple consumers
// ---------------------------------------------------------------------------

/**
 * Every consumer of the module sees the same instance and the same updates.
 */
function testMultipleConsumers() {
  console.log('🧪 Testing multiple consumers...');

  const cart = bridge({
    state: { items: [] },
    get count() { return this.items.length; },
    add(item) { this.items = [...this.items, item]; this.emit('added', item); },
  });

  const views = [0, 0, 0];
  const watchers = views.map((_, index) =>
    new AvenxWatcher(() => { views[index] = cart.count; return views[index]; }, null, { isEffect: true }),
  );

  const notified = [];
  cart.on('added', (item) => notified.push(`a:${item}`));
  cart.on('added', (item) => notified.push(`b:${item}`));

  cart.add('apple');
  cart.add('pear');

  assert.deepStrictEqual(views, [2, 2, 2], 'every reader converged on the same value');
  assert.deepStrictEqual(notified, ['a:apple', 'b:apple', 'a:pear', 'b:pear'], 'every subscriber got every event');

  watchers.forEach((watcher) => watcher.teardown());
  console.log('  ✅ Consumers share one source of truth.');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * setup() runs once, lazily, on first use.
 */
function testLazySetup() {
  console.log('🧪 Testing lazy setup...');

  let runs = 0;
  const feed = bridge({
    state: { ready: false },
    setup() { runs++; this.ready = true; },
    poke() { return this.ready; },
  });

  assert.strictEqual(runs, 0, 'defining a bridge does not run setup');
  assert.strictEqual(feed.ready, true, 'the first read runs setup');
  assert.strictEqual(runs, 1, 'setup ran once');

  feed.ready;
  feed.poke();
  assert.strictEqual(runs, 1, 'further access does not re-run setup');

  const viaAction = bridge({ state: { n: 0 }, setup() { runs++; }, act() {} });
  viaAction.act();
  assert.strictEqual(runs, 2, 'calling an action also initialises the bridge');

  const viaSubscribe = bridge({ setup() { runs++; } });
  viaSubscribe.on('x', () => {});
  assert.strictEqual(runs, 3, 'subscribing also initialises the bridge');

  console.log('  ✅ setup() is lazy and runs exactly once.');
}

/**
 * setup() is detached: it belongs to the module, not to whoever touched it.
 */
function testSetupIsDetached() {
  console.log('🧪 Testing setup detachment...');

  let scopeSeenInsideSetup = 'unset';
  let trackedInsideSetup = false;

  const probe = bridge({
    state: { value: 1 },
    setup() {
      scopeSeenInsideSetup = getScope();
      // Reading state here must not attach the reader's render watcher.
      trackedInsideSetup = this.value === 1;
    },
  });

  const consumerScope = new DisposalScope('Consumer');
  let outerRuns = 0;
  let watcher = null;

  runInScope(consumerScope, () => {
    watcher = new AvenxWatcher(() => { outerRuns++; return probe.value; }, null, { isEffect: true });
  });

  assert.strictEqual(scopeSeenInsideSetup, null, 'setup runs with no owning scope');
  assert.ok(trackedInsideSetup, 'setup could still read state');
  assert.strictEqual(outerRuns, 1, 'the consumer watcher ran once');

  watcher.teardown();
  consumerScope.dispose();
  console.log('  ✅ setup() is detached from the first caller.');
}

/**
 * $dispose() runs cleanup, drops listeners and restores initial state.
 */
function testDispose() {
  console.log('🧪 Testing $dispose...');

  let cleanups = 0;
  let setups = 0;
  const socket = bridge({
    state: { connected: false, log: [] },
    setup() {
      setups++;
      this.connected = true;
      return () => { cleanups++; };
    },
    push(entry) { this.log = [...this.log, entry]; this.emit('entry', entry); },
  });

  const received = [];
  socket.on('entry', (entry) => received.push(entry));
  socket.push('one');

  assert.strictEqual(setups, 1, 'setup ran on first use');
  assert.deepStrictEqual(received, ['one'], 'the listener received the event');

  socket.$dispose();

  assert.strictEqual(cleanups, 1, 'the cleanup returned by setup ran');
  assert.deepStrictEqual([...socket.log], [], 'state was restored to its initial value');
  assert.strictEqual(setups, 2, 'reading after disposal re-initialises the bridge');

  socket.push('two');
  assert.deepStrictEqual(received, ['one'], 'listeners were dropped by disposal');

  socket.$dispose();
  assert.strictEqual(cleanups, 2, 'disposal is repeatable');

  console.log('  ✅ $dispose() releases everything and leaves the bridge reusable.');
}

/**
 * Disposal resets state in place, so consumers are notified and keep working.
 *
 * Regression: an earlier implementation replaced the reactive state object,
 * which stranded every watcher that had already tracked the old one — the
 * bridge kept updating while its consumers silently froze.
 */
function testDisposeKeepsConsumersLive() {
  console.log('🧪 Testing that disposal does not strand consumers...');

  const counter = bridge({
    state: { n: 0 },
    bump() { this.n++; },
    addKey() { this.extra = 'x'; },
  });

  let runs = 0;
  let seen = null;
  const watcher = new AvenxWatcher(() => { runs++; seen = counter.n; return seen; }, null, { isEffect: true });

  counter.bump();
  counter.bump();
  assert.strictEqual(seen, 2, 'the watcher tracked the bridge');

  counter.addKey();
  const runsBeforeDispose = runs;
  counter.$dispose();

  assert.ok(runs > runsBeforeDispose, 'disposal re-ran the dependent watcher');
  assert.strictEqual(seen, 0, 'disposal notified the watcher that state reverted');
  assert.strictEqual(counter.extra, undefined, 'keys added after creation are removed');

  counter.bump();
  assert.strictEqual(seen, 1, 'the watcher is still subscribed after disposal');
  assert.strictEqual(seen, counter.n, 'the consumer and the bridge agree');

  watcher.teardown();
  console.log('  ✅ Disposal resets in place and keeps subscriptions valid.');
}

/**
 * A setup() that throws is reported with the bridge name and does not retry forever.
 */
function testSetupFailure() {
  console.log('🧪 Testing setup failure reporting...');

  const broken = bridge({
    state: { value: 1 },
    setup() { throw new Error('cannot reach the network'); },
  });
  defineBridgeName('broken', broken);

  let thrown = null;
  try {
    broken.value;
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'the failure surfaces at the point of use');
  assert.strictEqual(thrown.code, AvenxErrorCodes.BRIDGE_SETUP_FAILED, 'it carries the setup error code');
  assert.ok(thrown.message.includes('broken'), 'it names the bridge');
  assert.ok(thrown.message.includes('cannot reach the network'), 'it keeps the original cause');

  assert.strictEqual(broken.value, 1, 'the bridge stays usable and does not loop on setup');

  console.log('  ✅ setup() failures are attributed and non-fatal.');
}

// ---------------------------------------------------------------------------
// Scope ownership
// ---------------------------------------------------------------------------

/**
 * Subscriptions made inside a scope are released with that scope.
 */
function testScopeOwnedSubscriptions() {
  console.log('🧪 Testing scope-owned subscriptions...');

  const hub = bridge({ fire(value) { this.emit('tick', value); } });
  const seen = [];

  const scope = new DisposalScope('Widget');
  runInScope(scope, () => {
    hub.on('tick', (value) => seen.push(`scoped:${value}`));
  });
  hub.on('tick', (value) => seen.push(`free:${value}`));

  hub.fire(1);
  scope.dispose();
  hub.fire(2);

  assert.deepStrictEqual(
    seen,
    ['scoped:1', 'free:1', 'free:2'],
    'disposing a scope released only its own subscription',
  );

  console.log('  ✅ Scopes own the subscriptions opened inside them.');
}

/**
 * Releasing a subscription early removes it from its scope, and subscribing
 * inside an already-disposed scope never registers.
 */
function testScopeEdgeCases() {
  console.log('🧪 Testing scope edge cases...');

  const hub = bridge({ fire() { this.emit('tick'); } });
  const scope = new DisposalScope('Widget');

  let calls = 0;
  let off = null;
  runInScope(scope, () => { off = hub.on('tick', () => { calls++; }); });

  off();
  hub.fire();
  assert.strictEqual(calls, 0, 'an early release stops delivery');

  scope.dispose(); // must not double-run the disposer
  assert.strictEqual(calls, 0, 'disposing after an early release is harmless');

  let lateCalls = 0;
  runInScope(scope, () => { hub.on('tick', () => { lateCalls++; }); });
  hub.fire();
  assert.strictEqual(lateCalls, 0, 'subscribing in a disposed scope never registers');

  console.log('  ✅ Early release and disposed scopes behave correctly.');
}

// ---------------------------------------------------------------------------
// Async
// ---------------------------------------------------------------------------

/**
 * An async action may write state before and after an await.
 */
async function testAsyncActions() {
  console.log('🧪 Testing async actions...');

  const remote = bridge({
    state: { status: 'idle', data: null, error: null },
    async load(shouldFail) {
      this.status = 'loading';
      await Promise.resolve();
      if (shouldFail) {
        this.status = 'error';
        this.error = 'boom';
        this.emit('failed', 'boom');
        return;
      }
      this.data = { value: 42 };
      this.status = 'ready';
      this.emit('loaded', this.data);
    },
  });

  const events = [];
  remote.on('loaded', () => events.push('loaded'));
  remote.on('failed', (reason) => events.push(`failed:${reason}`));

  const pending = remote.load(false);
  assert.strictEqual(remote.status, 'loading', 'the pre-await write is visible immediately');
  await pending;

  assert.strictEqual(remote.status, 'ready', 'the post-await write landed');
  assert.deepStrictEqual({ ...remote.data }, { value: 42 }, 'async data is stored');

  await remote.load(true);
  assert.strictEqual(remote.status, 'error', 'a failure path can record its own state');
  assert.deepStrictEqual(events, ['loaded', 'failed:boom'], 'both outcomes emitted');

  console.log('  ✅ Async actions keep write access across await.');
}

/**
 * An action's rejection reaches the caller instead of being swallowed.
 */
async function testAsyncActionRejection() {
  console.log('🧪 Testing async action rejection...');

  const remote = bridge({
    state: { status: 'idle' },
    async load() {
      this.status = 'loading';
      throw new Error('network down');
    },
  });

  let caught = null;
  try {
    await remote.load();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'the rejection propagates to the caller');
  assert.strictEqual(caught.message, 'network down', 'the original error is preserved');
  assert.strictEqual(remote.status, 'loading', 'state written before the throw is kept');

  console.log('  ✅ Action failures surface at the call site.');
}

// ---------------------------------------------------------------------------
// Invalid definitions
// ---------------------------------------------------------------------------

/**
 * Misuse of the definition object is refused at creation with a clear code.
 */
function testInvalidDefinitions() {
  console.log('🧪 Testing invalid definitions...');

  assertThrowsCode(() => bridge(), AvenxErrorCodes.BRIDGE_INVALID_DEFINITION, 'no definition');
  assertThrowsCode(() => bridge(null), AvenxErrorCodes.BRIDGE_INVALID_DEFINITION, 'a null definition');
  assertThrowsCode(() => bridge('auth'), AvenxErrorCodes.BRIDGE_INVALID_DEFINITION, 'a string definition');
  assertThrowsCode(() => bridge([]), AvenxErrorCodes.BRIDGE_INVALID_DEFINITION, 'an array definition');

  // Data must live in `state`, so a stray top-level value is a mistake.
  assertThrowsCode(
    () => bridge({ user: null, login() {} }),
    AvenxErrorCodes.BRIDGE_INVALID_MEMBER,
    'a top-level data member',
  );
  assertThrowsCode(() => bridge({ state: 'nope' }), AvenxErrorCodes.BRIDGE_INVALID_MEMBER, 'a non-object state');
  assertThrowsCode(() => bridge({ state: [] }), AvenxErrorCodes.BRIDGE_INVALID_MEMBER, 'an array state');
  assertThrowsCode(() => bridge({ setup: 'nope' }), AvenxErrorCodes.BRIDGE_INVALID_MEMBER, 'a non-function setup');

  // Names owned by the Bridge API cannot be redeclared.
  assertThrowsCode(() => bridge({ on() {} }), AvenxErrorCodes.BRIDGE_RESERVED_KEY, 'redeclaring on');
  assertThrowsCode(() => bridge({ emit() {} }), AvenxErrorCodes.BRIDGE_RESERVED_KEY, 'redeclaring emit');
  assertThrowsCode(() => bridge({ $dispose() {} }), AvenxErrorCodes.BRIDGE_RESERVED_KEY, 'redeclaring $dispose');
  assertThrowsCode(
    () => bridge({ state: { total: 0 }, get total() { return 1; } }),
    AvenxErrorCodes.BRIDGE_RESERVED_KEY,
    'a getter colliding with a state key',
  );
  assertThrowsCode(
    () => bridge({ state: { save: 0 }, save() {} }),
    AvenxErrorCodes.BRIDGE_RESERVED_KEY,
    'an action colliding with a state key',
  );

  let message = '';
  try {
    bridge({ user: null });
  } catch (error) {
    message = error.message;
  }
  assert.ok(message.includes('state:'), 'the error shows how to fix the mistake');

  console.log('  ✅ Invalid definitions fail fast with actionable messages.');
}

/**
 * Assigning over an action or getter from inside the bridge is refused too.
 */
function testInternalWriteGuards() {
  console.log('🧪 Testing internal write guards...');

  const guarded = bridge({
    state: { n: 0 },
    get double() { return this.n * 2; },
    act() {},
    clobberGetter() { this.double = 99; },
    clobberAction() { this.act = null; },
  });

  assertThrowsCode(() => guarded.clobberGetter(), AvenxErrorCodes.BRIDGE_RESERVED_KEY, 'overwriting a getter');
  assertThrowsCode(() => guarded.clobberAction(), AvenxErrorCodes.BRIDGE_RESERVED_KEY, 'overwriting an action');
  assert.strictEqual(typeof guarded.act, 'function', 'the action survived');

  console.log('  ✅ Actions and getters cannot be clobbered.');
}

// ---------------------------------------------------------------------------
// Interop
// ---------------------------------------------------------------------------

/**
 * Spreading or serialising a bridge yields its data, not its API.
 */
function testSnapshotting() {
  console.log('🧪 Testing snapshots...');

  const auth = makeAuthBridge();
  auth.login({ name: 'Ada' });

  const snapshot = { ...auth };
  assert.deepStrictEqual(Object.keys(snapshot).sort(), ['displayName', 'history', 'isLoggedIn', 'status', 'user']);
  assert.strictEqual(snapshot.login, undefined, 'actions are not part of a data snapshot');
  assert.strictEqual(snapshot.on, undefined, 'the API is not part of a data snapshot');

  const parsed = JSON.parse(JSON.stringify(auth));
  assert.strictEqual(parsed.user.name, 'Ada', 'a bridge serialises to its data');
  assert.strictEqual(parsed.displayName, 'Ada', 'derived values are included');

  // The snapshot is detached from the bridge.
  auth.logout();
  assert.strictEqual(snapshot.status, 'authenticated', 'an existing snapshot does not change');

  console.log('  ✅ Bridges snapshot to plain data.');
}

/**
 * Registering a bridge with the app indexes it without re-wrapping it.
 */
function testAppRegistration() {
  console.log('🧪 Testing app registration...');

  document.body.innerHTML = '<div id="registration-root"></div>';
  const app = new AvenxApp({ target: '#registration-root' });
  const auth = makeAuthBridge();

  app.registerBridge('auth', auth);

  assert.strictEqual(app.bridges.auth, auth, 'the instance is indexed as-is, not re-proxied');
  assertThrowsCode(
    () => { app.bridges.auth.user = 1; },
    AvenxErrorCodes.BRIDGE_READONLY_STATE,
    'registration preserves the read-only facade',
  );

  assertThrowsCode(
    () => app.registerBridge('auth', auth),
    AvenxErrorCodes.BRIDGE_ALREADY_EXISTS,
    'registering the same name twice',
  );

  // Plain-object bridges register and stay writable.
  app.registerBridge('plain', { value: 1 });
  app.bridges.plain.value = 2;
  assert.strictEqual(app.bridges.plain.value, 2, 'plain-object bridges are unaffected');

  console.log('  ✅ Registration indexes bridges without changing them.');
}

/**
 * defineBridgeName labels a bridge for diagnostics without exposing a setter.
 */
function testNaming() {
  console.log('🧪 Testing bridge naming...');

  const anonymous = bridge({ state: { a: 1 } });
  assert.strictEqual(anonymous.$name, 'bridge', 'an unnamed bridge has a neutral default');

  defineBridgeName('settings', anonymous);
  assert.strictEqual(anonymous.$name, 'settings', 'the compiler can label a bridge');

  assert.strictEqual(anonymous.$setName, undefined, 'the naming channel is not part of the public surface');
  assert.ok(!Object.keys(anonymous).includes('$name'), '$name is not enumerable data');

  assert.strictEqual(defineBridgeName('x', { plain: true }).plain, true, 'naming a non-bridge is a no-op');

  console.log('  ✅ Naming is compiler-driven and invisible to consumers.');
}

/**
 * Reading a member that does not exist is undefined, not a crash.
 */
function testUnknownMembers() {
  console.log('🧪 Testing unknown member reads...');

  const auth = makeAuthBridge();
  assert.strictEqual(auth.doesNotExist, undefined, 'unknown members read as undefined');
  assert.strictEqual('doesNotExist' in auth, false, 'unknown members are not reported as present');
  assert.strictEqual(auth[Symbol.iterator], undefined, 'unknown symbols read as undefined');
  assert.strictEqual(auth.then, undefined, 'a bridge is not thenable');

  console.log('  ✅ Unknown members read as undefined.');
}

/**
 * Runs the suite.
 */
async function run() {
  console.log('=== Bridge core tests ===\n');
  testCreation();
  testActionIdentity();
  testMinimalBridges();
  testStateUpdates();
  testStateIsReadOnlyForConsumers();
  testNestedStateAndIsolation();
  testInstancesDoNotShareState();
  testReactiveTracking();
  testGetterTracking();
  testEvents();
  testUnsubscribe();
  testDuplicateSubscription();
  testListenerErrorIsolation();
  testMutationDuringEmit();
  testInvalidEventUsage();
  testMultipleConsumers();
  testLazySetup();
  testSetupIsDetached();
  testDispose();
  testDisposeKeepsConsumersLive();
  testSetupFailure();
  testScopeOwnedSubscriptions();
  testScopeEdgeCases();
  await testAsyncActions();
  await testAsyncActionRejection();
  testInvalidDefinitions();
  testInternalWriteGuards();
  testSnapshotting();
  testAppRegistration();
  testNaming();
  testUnknownMembers();
  testNoClassBridgeApi();
  console.log('\n✅ All bridge core tests passed!');
}

/**
 * The class-based Bridge API is gone. bridge() is the only way to declare one.
 *
 * This guards the removal: re-exporting AvenxBridge, or teaching
 * registerBridge to construct a class again, would resurrect an API that
 * cannot be typed, tree-shaken or checked by the compiler.
 */
function testNoClassBridgeApi() {
  console.log('🧪 Testing that the class Bridge API is gone...');

  assert.ok(!('AvenxBridge' in runtime), 'AvenxBridge is not exported from the runtime');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(AvenxErrorCodes, 'BRIDGE_CONSTRUCTION_FAILED'),
    'the class-construction error code is retired',
  );

  document.body.innerHTML = '<div id="no-class-root"></div>';
  const app = new AvenxApp({ target: '#no-class-root' });

  // bridge() instances stay the supported path and are indexed untouched.
  const auth = makeAuthBridge();
  app.registerBridge('auth', auth);
  assert.strictEqual(app.bridges.auth, auth, 'bridge() instances register as-is');

  console.log('  ✅ Only bridge() declares a bridge.');
}

run().catch((error) => {
  console.error('❌ Bridge core tests failed:', error);
  process.exit(1);
});
