import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { bridge, defineBridgeName } from '../../lib/core/runtime/bridge.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';

/**
 * Builds a bridge shared by the components under test.
 * @returns {object} A fresh bridge instance.
 */
function makeCartBridge() {
  const cart = bridge({
    state: { items: [], lastAdded: null },

    get count() {
      return this.items.length;
    },

    add(item) {
      this.items = [...this.items, item];
      this.lastAdded = item;
      this.emit('added', item);
    },

    clear() {
      this.items = [];
      this.emit('cleared');
    },
  });
  defineBridgeName('cart', cart);
  return cart;
}

/**
 * Mounts a component the way compiled output does: bridges arrive as the third
 * constructor argument, which is how an imported bridge reaches the template.
 * @param {object} options - Component definition.
 * @param {object} options.state - Initial state.
 * @param {string} options.template - The component template.
 * @param {object} [options.methods] - Action bodies.
 * @param {object} [options.bridges] - Bridges in template scope.
 * @param {object} [options.computed] - Computed definitions.
 * @returns {{component: AvenxComponent, root: Element}} The mounted component.
 */
function mount({ state = {}, template, methods = {}, bridges = {}, computed = {} }) {
  const component = new AvenxComponent(state, computed, bridges, template, methods);
  const root = document.createElement('div');
  document.body.appendChild(root);
  // The full mount path: it installs the render watcher (which is what makes
  // bridge reads in the template reactive) and fires onMount.
  component.mount(root);
  return { component, root };
}

// ---------------------------------------------------------------------------
// Reactive template usage
// ---------------------------------------------------------------------------

/**
 * A template that reads bridge state re-renders when that state changes,
 * with no subscription written by the developer.
 */
async function testTemplateReactivity() {
  console.log('🧪 Testing reactive template usage...');

  const cart = makeCartBridge();
  const { component, root } = mount({
    template: '<div><span class="count">{{ cart.count }}</span><em>{{ cart.lastAdded }}</em></div>',
    bridges: { cart },
  });

  assert.ok(root.textContent.includes('0'), 'the initial derived value rendered');

  cart.add('apple');
  await nextTick();

  assert.ok(root.textContent.includes('1'), 'the count updated after a bridge mutation');
  assert.ok(root.textContent.includes('apple'), 'the new state value rendered');

  cart.add('pear');
  await nextTick();
  assert.ok(root.textContent.includes('2'), 'further mutations keep updating');

  component.unmount();
  console.log('  ✅ Bridge reads in a template are reactive with no manual wiring.');
}

/**
 * Optional chaining over bridge state renders without throwing.
 */
async function testOptionalChaining() {
  console.log('🧪 Testing optional chaining over bridge state...');

  const auth = bridge({
    state: { user: null },
    signIn(name) { this.user = { name }; },
  });

  const { component, root } = mount({
    template: '<div><p>{{ auth.user?.name }}</p></div>',
    bridges: { auth },
  });

  assert.ok(!root.textContent.includes('undefined'), 'a null nested read renders empty, not "undefined"');

  auth.signIn('Ada');
  await nextTick();
  assert.ok(root.textContent.includes('Ada'), 'the value renders once it exists');

  component.unmount();
  console.log('  ✅ auth.user?.name renders and updates.');
}

/**
 * Only the components that read the changed key re-render.
 */
async function testTargetedUpdates() {
  console.log('🧪 Testing targeted re-rendering...');

  const stats = bridge({
    state: { reads: 0, writes: 0 },
    read() { this.reads++; },
    write() { this.writes++; },
  });

  let readerRenders = 0;
  let writerRenders = 0;
  let unrelatedRenders = 0;

  const reader = mount({
    template: '<div>{{ stats.reads }}</div>',
    bridges: { stats },
  });
  const writer = mount({
    template: '<div>{{ stats.writes }}</div>',
    bridges: { stats },
  });
  const unrelated = mount({ state: { local: 1 }, template: '<div>{{ local }}</div>' });

  const original = [reader, writer, unrelated].map((entry) => entry.component.runUpdate.bind(entry.component));
  reader.component.runUpdate = () => { readerRenders++; return original[0](); };
  writer.component.runUpdate = () => { writerRenders++; return original[1](); };
  unrelated.component.runUpdate = () => { unrelatedRenders++; return original[2](); };

  stats.read();
  await nextTick();

  assert.strictEqual(readerRenders, 1, 'the component reading the changed key re-rendered');
  assert.strictEqual(writerRenders, 0, 'a component reading a different key did not');
  assert.strictEqual(unrelatedRenders, 0, 'a component reading no bridge state did not');

  reader.component.unmount();
  writer.component.unmount();
  unrelated.component.unmount();
  console.log('  ✅ Updates reach only the components that read the changed key.');
}

/**
 * Several components stay in sync through one bridge.
 */
async function testMultipleComponents() {
  console.log('🧪 Testing several components on one bridge...');

  const cart = makeCartBridge();
  const badge = mount({ template: '<div>badge:{{ cart.count }}</div>', bridges: { cart } });
  const list = mount({ template: '<div>list:{{ cart.count }}</div>', bridges: { cart } });
  const producer = mount({
    template: '<button data-ax-ref="add" @click="addItem()">add</button>',
    methods: { addItem: 'cart.add("apple");' },
    bridges: { cart },
  });

  producer.component.$refs.add.click();
  await nextTick();

  assert.ok(badge.root.textContent.includes('badge:1'), 'the badge saw the change');
  assert.ok(list.root.textContent.includes('list:1'), 'the list saw the change');
  assert.strictEqual(cart.count, 1, 'the bridge holds the single source of truth');

  badge.component.unmount();
  list.component.unmount();
  producer.component.unmount();
  console.log('  ✅ Independent components communicate through a bridge.');
}

/**
 * A template event handler can call a bridge action.
 */
async function testActionFromTemplate() {
  console.log('🧪 Testing bridge actions from template handlers...');

  const cart = makeCartBridge();
  const { component, root } = mount({
    template:
      '<div><span>{{ cart.count }}</span>' +
      '<button data-ax-ref="add" @click="cart.add(\'apple\')">add</button>' +
      '<button data-ax-ref="clear" @click="cart.clear()">clear</button></div>',
    bridges: { cart },
  });

  component.$refs.add.click();
  await nextTick();
  assert.ok(root.textContent.includes('1'), 'the inline action call updated shared state');

  component.$refs.clear.click();
  await nextTick();
  assert.ok(root.textContent.includes('0'), 'a second action reset it');

  component.unmount();
  console.log('  ✅ Actions are callable straight from the template.');
}

// ---------------------------------------------------------------------------
// Lifecycle and cleanup
// ---------------------------------------------------------------------------

/**
 * A subscription opened in onMount is released on unmount without any
 * developer-written teardown.
 */
async function testSubscriptionCleanupOnUnmount() {
  console.log('🧪 Testing subscription cleanup on unmount...');

  const cart = makeCartBridge();
  const seen = [];

  const { component } = mount({
    state: { toast: '' },
    template: '<div>{{ toast }}</div>',
    methods: {
      onMount: 'cart.on("added", (item) => { seenPush(item); state.toast = item; });',
      seenPush: 'seen.push(args[0]);',
    },
    bridges: { cart, seen, seenPush: (item) => seen.push(item) },
  });

  cart.add('apple');
  await nextTick();
  assert.deepStrictEqual(seen, ['apple'], 'the mounted component received the event');

  component.unmount();

  cart.add('pear');
  await nextTick();
  assert.deepStrictEqual(seen, ['apple'], 'the unmounted component received nothing further');

  console.log('  ✅ Unmounting releases bridge subscriptions automatically.');
}

/**
 * Mounting, unmounting and remounting does not accumulate listeners.
 */
async function testNoDuplicateSubscriptionsAcrossRemounts() {
  console.log('🧪 Testing remount does not duplicate subscriptions...');

  const cart = makeCartBridge();
  let deliveries = 0;

  const build = () =>
    mount({
      state: { n: 0 },
      template: '<div>{{ n }}</div>',
      methods: { onMount: 'cart.on("added", () => { count(); });' },
      bridges: { cart, count: () => { deliveries++; } },
    });

  for (let i = 0; i < 3; i++) {
    const { component } = build();
    component.unmount();
  }

  cart.add('apple');
  assert.strictEqual(deliveries, 0, 'three mount/unmount cycles left no listeners behind');

  const live = build();
  cart.add('pear');
  assert.strictEqual(deliveries, 1, 'a freshly mounted component receives exactly one delivery');

  live.component.unmount();
  console.log('  ✅ Repeated mounting does not accumulate listeners.');
}

/**
 * A subscription opened from an event handler is owned by the component too.
 */
async function testSubscriptionFromEventHandler() {
  console.log('🧪 Testing subscriptions opened in event handlers...');

  const cart = makeCartBridge();
  let deliveries = 0;

  const { component } = mount({
    template: '<button data-ax-ref="sub" @click="subscribe()">subscribe</button>',
    methods: { subscribe: 'cart.on("added", () => { count(); });' },
    bridges: { cart, count: () => { deliveries++; } },
  });

  component.$refs.sub.click();
  cart.add('apple');
  assert.strictEqual(deliveries, 1, 'the handler-registered listener fired');

  component.unmount();
  cart.add('pear');
  assert.strictEqual(deliveries, 1, 'it was released with the component');

  console.log('  ✅ Handler subscriptions are component-owned.');
}

/**
 * Releasing a subscription by hand still works, and unmount afterwards is safe.
 */
async function testManualUnsubscribe() {
  console.log('🧪 Testing manual unsubscribe...');

  const cart = makeCartBridge();
  let deliveries = 0;
  let release = null;

  const { component } = mount({
    template: '<div>x</div>',
    methods: { onMount: 'keep(cart.on("added", () => { count(); }));' },
    bridges: {
      cart,
      count: () => { deliveries++; },
      keep: (off) => { release = off; },
    },
  });

  cart.add('apple');
  assert.strictEqual(deliveries, 1, 'the listener fired');

  release();
  cart.add('pear');
  assert.strictEqual(deliveries, 1, 'the manual release stopped delivery');

  component.unmount(); // must not double-release
  cart.add('plum');
  assert.strictEqual(deliveries, 1, 'unmounting after a manual release is harmless');

  console.log('  ✅ Manual and automatic release coexist.');
}

/**
 * A bridge outlives the components that use it: unmounting a consumer must not
 * reset shared state.
 */
async function testBridgeOutlivesComponents() {
  console.log('🧪 Testing bridge lifetime is independent of components...');

  const cart = makeCartBridge();
  const first = mount({ template: '<div>{{ cart.count }}</div>', bridges: { cart } });
  cart.add('apple');
  await nextTick();
  first.component.unmount();

  assert.strictEqual(cart.count, 1, 'state survived the consumer');

  const second = mount({ template: '<div>{{ cart.count }}</div>', bridges: { cart } });
  assert.ok(second.root.textContent.includes('1'), 'a later component sees the existing state');

  second.component.unmount();
  console.log('  ✅ Bridges outlive their consumers.');
}

/**
 * Emitting to a component that has unmounted mid-flight does not throw.
 */
async function testEmitToUnmountedComponent() {
  console.log('🧪 Testing emit during unmount...');

  const cart = makeCartBridge();
  let errors = 0;
  const originalError = console.error;
  console.error = () => { errors++; };

  try {
    const { component } = mount({
      state: { toast: '' },
      template: '<div>{{ toast }}</div>',
      methods: { onMount: 'cart.on("added", () => { state.toast = "x"; });' },
      bridges: { cart },
    });

    // A listener that unmounts its own component while the event is in flight.
    cart.on('added', () => component.unmount());
    cart.add('apple');
    await nextTick();
  } finally {
    console.error = originalError;
  }

  assert.strictEqual(errors, 0, 'no error was logged while unmounting mid-emit');
  console.log('  ✅ Unmounting during delivery is safe.');
}

// ---------------------------------------------------------------------------
// Scope and precedence
// ---------------------------------------------------------------------------

/**
 * An isolated component sees no bridges at all, as its contract promises.
 */
function testIsolatedComponent() {
  console.log('🧪 Testing the isolated contract...');

  const cart = makeCartBridge();
  cart.add('apple');

  const component = new AvenxComponent(
    { local: 'yes' },
    {},
    { cart },
    '<div>{{ local }}</div>',
    {},
    {},
    {},
    {},
    { contracts: ['isolated'] },
  );
  const root = document.createElement('div');
  document.body.appendChild(root);
  component.mount(root);

  assert.ok(root.textContent.includes('yes'), 'local state still renders');
  assert.deepStrictEqual(
    component._getBridges(),
    {},
    'an isolated component is handed no bridges at all',
  );

  // A non-isolated component with the same bridges does receive them.
  const open = new AvenxComponent({ local: 'yes' }, {}, { cart }, '<div>{{ cart.count }}</div>', {});
  const openRoot = document.createElement('div');
  document.body.appendChild(openRoot);
  open.mount(openRoot);
  assert.ok(openRoot.textContent.includes('1'), 'the same bridge is reachable without the contract');

  component.unmount();
  open.unmount();
  console.log('  ✅ Isolated components cannot reach bridges.');
}

/**
 * Local state wins over a bridge of the same name, so a bridge can never
 * silently shadow a component's own data.
 */
function testStatePrecedence() {
  console.log('🧪 Testing name precedence...');

  const value = bridge({ state: { label: 'from-bridge' } });
  const { component, root } = mount({
    state: { value: 'from-state' },
    template: '<div>{{ value }}</div>',
    bridges: { value },
  });

  assert.ok(root.textContent.includes('from-state'), 'component state takes precedence over a same-named bridge');

  component.unmount();
  console.log('  ✅ Component state is never shadowed by a bridge.');
}

/**
 * Runs the suite.
 */
async function run() {
  console.log('=== Bridge/component integration tests ===\n');
  await testTemplateReactivity();
  await testOptionalChaining();
  await testTargetedUpdates();
  await testMultipleComponents();
  await testActionFromTemplate();
  await testSubscriptionCleanupOnUnmount();
  await testNoDuplicateSubscriptionsAcrossRemounts();
  await testSubscriptionFromEventHandler();
  await testManualUnsubscribe();
  await testBridgeOutlivesComponents();
  await testEmitToUnmountedComponent();
  testIsolatedComponent();
  testStatePrecedence();
  console.log('\n✅ All bridge/component integration tests passed!');
}

run().catch((error) => {
  console.error('❌ Bridge/component integration tests failed:', error);
  process.exit(1);
});
