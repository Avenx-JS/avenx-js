/**
 * Avenx Rewind, end to end through the real framework.
 *
 * The unit tests prove the journal restores values. What matters to a user is
 * narrower and harder: after a failed optimistic update, does the *DOM* show
 * the old value again? A rewind that restores state but leaves the page
 * showing what was rolled back is worse than no rewind at all, so every case
 * here asserts on rendered text rather than on state.
 */
import assert from 'assert';
import '../helpers/register-happy-dom.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { bridge, defineBridgeName } from '../../lib/core/runtime/bridge.js';
import { atomic } from '../../lib/core/runtime/atomic.js';
import { journal } from '../../lib/core/reactive/journal.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import AvenxCompiler from '../../lib/compiler.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

/**
 * Mounts a component into a detached root and settles the first render.
 * @param {AvenxComponent} component - The instance to mount.
 * @returns {Promise<HTMLElement>} The root element.
 */
async function mount(component) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  component.mount(root);
  await component.nextTick();
  return root;
}

/**
 * The trimmed text of the first matching element.
 * @param {HTMLElement} root - Where to look.
 * @param {string} selector - A CSS selector.
 * @returns {string} The text.
 */
function text(root, selector) {
  const node = root.querySelector(selector);
  return node ? node.textContent.trim() : '';
}

/**
 * Captures whatever the logger reports while a body runs.
 * @param {function(): Promise<any>|any} body - What to run.
 * @returns {Promise<string[]>} The reported messages.
 */
async function captureErrors(body) {
  const messages = [];
  const original = logger.error;
  logger.error = (...args) => messages.push(args.join(' '));
  try {
    await body();
  } finally {
    logger.error = original;
  }
  return messages;
}

/**
 * A failed optimistic update must put the rendered text back.
 * @returns {Promise<void>}
 */
async function testOptimisticUpdateCorrectsTheDom() {
  console.log('🧪 Testing that a failed optimistic update corrects the DOM...');

  const cart = bridge({
    state: { items: [{ id: 'a', qty: 1, price: 12 }], revision: 0 },
    get total() {
      return this.items.reduce((sum, item) => sum + item.qty * item.price, 0);
    },
    addQty: atomic(function (id, n) {
      this.items.find((item) => item.id === id).qty += n;
      this.revision += 1;
    }),
  });
  defineBridgeName('cart', cart);

  // The action's outcome is whatever it returns, so the request stands in as a
  // bridge action handing back a promise the test controls.
  let reject = null;
  const api = bridge({
    state: {},
    setQty() {
      return new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
      });
    },
  });
  defineBridgeName('api', api);

  const component = new AvenxComponent(
    { id: 'a', busy: false },
    {},
    { cart, api },
    `<div>
       <span class="total">{{ cart.total }}</span>
       <span class="rev">{{ cart.revision }}</span>
       <span class="busy">{{ busy }}</span>
     </div>`,
    {
      incQty: `
        state.busy = true;
        cart.addQty(id, 1);
        return api.setQty(id, cart.total);
      `,
    },
    {},
    {},
    {},
    { atomic: { incQty: {} } },
  );

  const root = await mount(component);
  assert.strictEqual(text(root, '.total'), '12', 'the initial total renders');

  const inFlight = component.incQty();
  await component.nextTick();

  assert.strictEqual(text(root, '.total'), '24', 'the optimistic update reaches the DOM immediately');
  assert.strictEqual(text(root, '.rev'), '1', 'the bridge write made inside the transaction reaches it too');
  assert.strictEqual(text(root, '.busy'), 'true', 'and so does the component write');

  reject(new Error('server said no'));
  await inFlight.then(
    () => assert.fail('the rejection should propagate to the caller'),
    (error) => assert.strictEqual(error.message, 'server said no', 'the original error is rethrown unchanged'),
  );
  await component.nextTick();

  assert.strictEqual(text(root, '.total'), '12', 'the DOM shows the pre-transaction total again');
  assert.strictEqual(text(root, '.rev'), '0', 'the bridge write is undone in the DOM');
  assert.strictEqual(text(root, '.busy'), 'false', 'the component write is undone in the DOM');
  assert.strictEqual(cart.items[0].qty, 1, 'and the state agrees with what is rendered');

  component.destroy();
  console.log('  ✅ The DOM is corrected by the rewind, with no rollback code written.');
}

/**
 * The default policy must not let one rollback discard a later update.
 * @returns {Promise<void>}
 */
async function testOverlappingUpdatesKeepTheNewerValue() {
  console.log('🧪 Testing overlapping optimistic updates...');

  /** @type {Array<{resolve: Function, reject: Function}>} */
  const calls = [];
  const api = bridge({
    state: {},
    like() {
      return new Promise((resolve, reject) => calls.push({ resolve, reject }));
    },
  });
  defineBridgeName('likeApi', api);

  const post = new AvenxComponent(
    { likes: 4 },
    {},
    { api },
    `<div><span class="likes">{{ likes }}</span></div>`,
    { like: 'state.likes++; return api.like();' },
    {},
    {},
    {},
    { atomic: { like: {} } },
  );

  const root = await mount(post);

  const first = post.like();
  const second = post.like();
  await post.nextTick();
  assert.strictEqual(text(root, '.likes'), '6', 'both optimistic updates land');

  const messages = await captureErrors(async () => {
    calls[0].reject(new Error('first failed'));
    await first.catch(() => {});
    await post.nextTick();
  });

  assert.strictEqual(
    text(root, '.likes'),
    '6',
    'the "safe" policy refuses to discard the second update while rolling back the first',
  );
  assert.ok(
    messages.some((message) => message.includes('AVX_R29') && message.includes('likes')),
    `the conflict is reported rather than hidden: ${messages.join(' | ')}`,
  );

  calls[1].resolve('ok');
  await second;
  post.destroy();
  console.log('  ✅ A rollback does not silently discard a newer value.');
}

/**
 * A committed transaction must leave everything in place.
 * @returns {Promise<void>}
 */
async function testCommitLeavesEverythingInPlace() {
  console.log('🧪 Testing a committed transaction...');

  const component = new AvenxComponent(
    { rows: ['a'], count: 0 },
    {},
    {},
    `<div><span class="rows">{{ rows.join(',') }}</span><span class="count">{{ count }}</span></div>`,
    { addRow: "state.rows.push('b'); state.count++;" },
    {},
    {},
    {},
    { atomic: { addRow: {} } },
  );

  const root = await mount(component);
  component.addRow();
  await component.nextTick();

  assert.strictEqual(text(root, '.rows'), 'a,b', 'a committed collection mutation stands');
  assert.strictEqual(text(root, '.count'), '1', 'a committed scalar write stands');
  assert.strictEqual(journal.active, false, 'the frame is closed');

  component.destroy();
  console.log('  ✅ Commits are left alone.');
}

/**
 * A component with no atomic action must behave exactly as before.
 * @returns {Promise<void>}
 */
async function testBackwardsCompatibility() {
  console.log('🧪 Testing that a component with no atomic action is unchanged...');

  const component = new AvenxComponent(
    { count: 0 },
    {},
    {},
    `<div><span class="count">{{ count }}</span></div>`,
    { bump: 'state.count++; throw new Error("boom");' },
  );

  const root = await mount(component);
  assert.throws(() => component.bump(), /boom/, 'the action still throws');
  await component.nextTick();

  assert.strictEqual(text(root, '.count'), '1', 'a non-atomic action is not journaled and not rolled back');
  assert.strictEqual(journal.active, false, 'and no frame was ever opened');

  component.destroy();
  console.log('  ✅ Existing components are untouched.');
}

/**
 * The compiled output must carry the declaration through to a working rewind.
 * @returns {Promise<void>}
 */
async function testCompiledComponentRewinds() {
  console.log('🧪 Testing a component compiled from source...');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-rewind-int-'));
  const file = path.join(root, 'counter.component.js');
  fs.writeFileSync(
    file,
    `<state count="0" note="" />

<action name="bump" atomic>
  count++;
  note = 'touched';
  throw new Error('nope');
</action>

<div><span class="count">{{ count }}</span><span class="note">{{ note }}</span></div>
`,
  );

  const parser = new ComponentParser(new StyleProcessor({}, {}), [], null);
  const generated = parser.parse(file);
  fs.rmSync(root, { recursive: true, force: true });

  assert.ok(generated.includes('atomic: {"bump":{}}'), `the declaration reaches the generated code: ${generated}`);

  // Evaluate the generated class against the real runtime, the way a bundle does.
  const Factory = new Function('AvenxComponent', `${generated}\nreturn Counter;`);
  const Counter = Factory(AvenxComponent);
  const component = new Counter({}, {});

  const el = await mount(component);
  assert.throws(() => component.bump(), /nope/, 'the action throws');
  await component.nextTick();

  assert.strictEqual(text(el, '.count'), '0', 'the compiled atomic action rolled back');
  assert.strictEqual(text(el, '.note'), '', 'every write it made rolled back');

  component.destroy();
  console.log('  ✅ A compiled component rewinds.');
}

/**
 * The build must produce the artifacts and the diagnostics for the fixture app.
 * @returns {Promise<void>}
 */
async function testFixtureAppBuilds() {
  console.log('🧪 Testing the rewind fixture application...');

  const fixture = path.join(process.cwd(), 'test', 'fixtures', 'rewind-app');
  const warnings = [];
  const originalWarn = logger.warn;
  const originalInfo = logger.info;
  logger.warn = (...args) => warnings.push(args.join(' '));
  logger.info = () => {};

  let result;
  try {
    const compiler = new AvenxCompiler({ rootDir: fixture });
    result = compiler.build();
  } finally {
    logger.warn = originalWarn;
    logger.info = originalInfo;
  }

  assert.ok(result.files.includes('bundle.js'), 'the bundle is produced');

  const joined = warnings.join('\n');
  assert.ok(joined.includes('[AVX_W42] cart.setField'), `AVX_W42 fires on the dynamic write: ${joined}`);
  assert.ok(joined.includes('[AVX_W43] session.save'), `AVX_W43 fires on the emit and the storage write: ${joined}`);
  assert.ok(
    joined.includes('[AVX_W44] PostCard.like and PostCard.unlike'),
    `AVX_W44 fires on the like/unlike pair: ${joined}`,
  );
  assert.ok(
    !/\[AVX_W44\][^\n]*cart\.addQty and CartItem\./.test(joined),
    `AVX_W44 stays quiet on a caller and its callee: ${joined}`,
  );

  const bundle = fs.readFileSync(path.join(fixture, 'dist', 'bundle.js'), 'utf-8');
  assert.ok(bundle.includes('atomic: {"decQty"'), 'the compiled component carries its atomic descriptor');
  assert.ok(bundle.includes('"onConflict":"force"'), 'and the declared conflict policy');

  const atlas = JSON.parse(fs.readFileSync(path.join(fixture, 'dist', 'bundle.atlas.json'), 'utf-8'));
  const addQty = atlas.nodes.find((node) => node.id === 'action:bridge:cart.addQty');
  assert.strictEqual(addQty.atomic, true, 'the Atlas artifact records the declaration');
  const save = atlas.nodes.find((node) => node.id === 'action:bridge:session.save');
  assert.strictEqual(save.irreversible.length, 2, 'and the effects a rewind cannot undo');

  console.log('  ✅ The fixture application builds and reports exactly what it should.');
}

/**
 * Unmounting while a transaction is in flight must not break anything.
 * @returns {Promise<void>}
 */
async function testUnmountDuringTransaction() {
  console.log('🧪 Testing unmount while a transaction is in flight...');

  let reject = null;
  const api = bridge({
    state: {},
    go() {
      return new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
      });
    },
  });
  defineBridgeName('unmountApi', api);

  const component = new AvenxComponent(
    { n: 0 },
    {},
    { api },
    `<div><span class="n">{{ n }}</span></div>`,
    { go: 'state.n = 5; return api.go();' },
    {},
    {},
    {},
    { atomic: { go: {} } },
  );

  const root = await mount(component);
  const inFlight = component.go();
  await component.nextTick();
  assert.strictEqual(text(root, '.n'), '5', 'the optimistic write rendered');

  component.destroy();
  reject(new Error('too late'));
  await inFlight.catch((error) => assert.strictEqual(error.message, 'too late', 'the rejection still propagates'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(journal.frames.length, 0, 'the frame is released even though the component is gone');
  assert.strictEqual(journal.active, false, 'and the journal is idle again');
  console.log('  ✅ A component can unmount mid-transaction.');
}

/**
 * An atomic bridge action inside an atomic component action must undo once.
 * @returns {Promise<void>}
 */
async function testNestedAtomicUndoesOnce() {
  console.log('🧪 Testing nested atomic actions...');

  const counter = bridge({
    state: { hits: 0 },
    bump: atomic(function () {
      this.hits += 1;
    }),
  });
  defineBridgeName('counter', counter);

  const component = new AvenxComponent(
    { local: 0 },
    {},
    { counter },
    `<div><span class="hits">{{ counter.hits }}</span><span class="local">{{ local }}</span></div>`,
    { both: 'state.local = 1; counter.bump(); throw new Error("nope");' },
    {},
    {},
    {},
    { atomic: { both: {} } },
  );

  const root = await mount(component);
  assert.throws(() => component.both(), /nope/, 'the outer action throws');
  await component.nextTick();

  assert.strictEqual(text(root, '.hits'), '0', 'the inner transaction is undone by the outer frame');
  assert.strictEqual(text(root, '.local'), '0', 'and so is the outer write');
  assert.strictEqual(counter.hits, 0, 'exactly once, not twice');

  // The inner action on its own still commits.
  counter.bump();
  assert.strictEqual(counter.hits, 1, 'an atomic bridge action called directly still commits');

  component.destroy();
  console.log('  ✅ A nested transaction undoes exactly once.');
}

/**
 * Runs every case.
 * @returns {Promise<void>}
 */
async function run() {
  await testOptimisticUpdateCorrectsTheDom();
  await testOverlappingUpdatesKeepTheNewerValue();
  await testCommitLeavesEverythingInPlace();
  await testBackwardsCompatibility();
  await testUnmountDuringTransaction();
  await testNestedAtomicUndoesOnce();
  await testCompiledComponentRewinds();
  await testFixtureAppBuilds();
  console.log('\n🎉 Avenx Rewind integration tests passed.');
}

run().catch((error) => {
  console.error('❌ Avenx Rewind integration tests failed:', error);
  process.exit(1);
});
