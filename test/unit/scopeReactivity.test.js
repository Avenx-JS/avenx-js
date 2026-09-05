/**
 * The evaluation scope, and the dependency precision that depends on it.
 *
 * The scope used to be built with `{ ...this.state, ... }`. That single spread
 * caused three defects at once, and this file pins all three:
 *
 *   1. bare identifiers in a computed registered no dependency, so the
 *      documented `<computed value="count * 2" />` never recomputed;
 *   2. spreading read the computed key currently being evaluated, re-entering
 *      its own watcher and both logging a false AVX_R04 and resetting the
 *      dependency set mid-collection;
 *   3. every key was read on every scope build, so a component depended on all
 *      of its state and re-rendered when an unreferenced key changed.
 */
import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { depMap } from '../../lib/core/reactive/watcher.js';
import { toRaw } from '../../lib/core/reactive/proxyHandler.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import {
  createReactiveScope,
  deriveScope,
  objectLayer,
  stateLayer,
  getterLayer,
  isReactiveScope,
} from '../../lib/core/reactive/scopeProxy.js';

console.log('🧪 Testing evaluation scope and dependency precision...');

/**
 * Mounts a component and waits for its first render.
 * @param {object} state - Initial state.
 * @param {object} computed - Computed definitions.
 * @param {string} template - The template.
 * @param {object} [methods] - Action bodies.
 * @returns {Promise<{component: AvenxComponent, el: Element, renders: function(): number}>} The mounted component.
 */
async function mount(state, computed, template, methods = {}) {
  let renderCount = 0;
  class Probe extends AvenxComponent {
    /** Builds the probe. */
    constructor() {
      super(state, computed, {}, template, methods, {}, {}, {});
    }
    /**
     * @returns {string} The rendered markup.
     */
    render() {
      renderCount++;
      return super.render();
    }
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const component = new Probe();
  component.mount(el);
  await component.$nextTick();
  return { component, el, renders: () => renderCount };
}

/* -------------------------------------------------------------------------
 * 1. Bare identifiers are reactive
 * ---------------------------------------------------------------------- */

{
  const { component, el } = await mount(
    { count: 0 },
    { doubled: 'count * 2' },
    '<div><span id="c">{{ count }}</span><span id="d">{{ doubled }}</span></div>',
  );

  assert.strictEqual(el.querySelector('#d').textContent, '0', 'the initial computed value renders');

  component.state.count = 1;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#d').textContent, '2', 'a bare-identifier computed recomputes');

  component.state.count = 5;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#d').textContent, '10', 'and keeps recomputing');
}

{
  // The explicit form must keep working alongside the bare one.
  const { component, el } = await mount(
    { count: 1 },
    { bare: 'count * 2', explicit: 'state.count * 3' },
    '<div><span id="b">{{ bare }}</span><span id="e">{{ explicit }}</span></div>',
  );
  component.state.count = 2;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#b').textContent, '4', 'bare form');
  assert.strictEqual(el.querySelector('#e').textContent, '6', 'explicit form');
}

{
  // Nested reads through a bare identifier.
  const { component, el } = await mount(
    { user: { name: 'Alice', age: 30 } },
    { label: "user.name + ' (' + user.age + ')'" },
    '<div><span id="l">{{ label }}</span></div>',
  );
  assert.strictEqual(el.querySelector('#l').textContent, 'Alice (30)');
  component.state.user.name = 'Bob';
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#l').textContent, 'Bob (30)', 'a nested write recomputes');
}

{
  // A computed built from another computed, both bare.
  const { component, el } = await mount(
    { n: 2 },
    { doubled: 'n * 2', quadrupled: 'doubled * 2' },
    '<div><span id="q">{{ quadrupled }}</span></div>',
  );
  assert.strictEqual(el.querySelector('#q').textContent, '8');
  component.state.n = 3;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#q').textContent, '12', 'a chained computed recomputes');
}

{
  // A conditional dependency: the branch not taken must not be depended on.
  const { component, el } = await mount(
    { flag: true, a: 1, b: 2 },
    { picked: 'flag ? a : b' },
    '<div><span id="p">{{ picked }}</span></div>',
  );
  assert.strictEqual(el.querySelector('#p').textContent, '1');
  component.state.flag = false;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#p').textContent, '2', 'switching the branch recomputes');
  component.state.a = 99;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#p').textContent, '2', 'the unread branch does not disturb the value');
}

console.log('  ✅ Bare identifiers are reactive, including nested and chained.');

/* -------------------------------------------------------------------------
 * 2. No false circular-dependency warnings
 * ---------------------------------------------------------------------- */

{
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const { component } = await mount(
      { count: 0 },
      { a: 'count * 2', b: 'count + 1', c: 'a + b' },
      '<div>{{ a }}{{ b }}{{ c }}</div>',
    );
    component.state.count = 1;
    await component.$nextTick();
    component.state.count = 2;
    await component.$nextTick();
  } finally {
    console.warn = originalWarn;
  }

  const bogus = warnings.filter((line) => line.includes('AVX_R04'));
  assert.deepStrictEqual(bogus, [], `no false circular-dependency warnings (got: ${bogus.join(' | ')})`);
}

{
  // A genuine cycle must still be reported.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const { component } = await mount({ n: 1 }, { x: 'y + 1', y: 'x + 1' }, '<div>{{ x }}</div>');
    component.state.n = 2;
    await component.$nextTick();
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(
    warnings.some((line) => line.includes('AVX_R04')),
    'a real cycle between two computed values is still reported',
  );
}

console.log('  ✅ False AVX_R04 warnings are gone; real cycles still report.');

/* -------------------------------------------------------------------------
 * 3. Dependency precision
 * ---------------------------------------------------------------------- */

{
  const { component, renders } = await mount(
    { used: 1, unused: 'x', alsoUnused: 5 },
    {},
    '<div><span>{{ used }}</span></div>',
  );

  const tracked = depMap.get(toRaw(component.state));
  assert.ok(tracked.has('used'), 'the key the template reads is tracked');
  assert.ok(!tracked.has('unused'), 'a key it does not read is not tracked');

  const before = renders();
  component.state.unused = 'changed';
  component.state.alsoUnused = 6;
  await component.$nextTick();
  assert.strictEqual(renders(), before, 'writing unread keys does not re-render');

  component.state.used = 2;
  await component.$nextTick();
  assert.strictEqual(renders(), before + 1, 'writing a read key does re-render');
}

{
  // Deep writes must still reach a dependency recorded on an ancestor.
  const { component, el, renders } = await mount(
    { cart: { items: [{ qty: 1 }] }, note: 'unread' },
    {},
    '<div><span id="q">{{ cart.items[0].qty }}</span></div>',
  );
  const before = renders();

  component.state.note = 'still unread';
  await component.$nextTick();
  assert.strictEqual(renders(), before, 'an unrelated key does not re-render');

  component.state.cart.items[0].qty = 7;
  await component.$nextTick();
  assert.strictEqual(el.querySelector('#q').textContent, '7', 'a deep write updates the DOM');

  component.state.cart.items.push({ qty: 2 });
  await component.$nextTick();
  assert.ok(renders() > before, 'a nested array mutation re-renders');
}

console.log('  ✅ Unrelated writes are skipped; deep writes still propagate.');

/* -------------------------------------------------------------------------
 * 4. The standalone reactive primitive keeps its contract
 * ---------------------------------------------------------------------- */

{
  // StateFactory's documented behaviour is that onChange fires for every
  // mutation, watchers or not. Only components opt into filtering.
  let changes = 0;
  const state = new StateFactory().create(
    { a: 1, nested: { b: 2 } },
    { onChange: () => { changes += 1; } },
  );
  state.a = 2;
  assert.strictEqual(changes, 1, 'a write with no watcher still notifies');
  state.nested.b = 3;
  assert.strictEqual(changes, 2, 'a nested write with no watcher still notifies');
}

console.log('  ✅ StateFactory still notifies on every mutation.');

/* -------------------------------------------------------------------------
 * 5. Scope construction primitives
 * ---------------------------------------------------------------------- */

{
  const state = new StateFactory().create({ a: 1, b: 2 });
  let getterCalls = 0;

  const scope = createReactiveScope([
    objectLayer({ top: 'wins' }),
    stateLayer(state, () => ['a', 'b']),
    getterLayer({
      lazy: () => {
        getterCalls += 1;
        return 'computed';
      },
    }),
    objectLayer({ top: 'loses', bottom: 'kept' }),
  ]);

  assert.ok(isReactiveScope(scope), 'the scope identifies itself');
  assert.strictEqual(scope.top, 'wins', 'the highest layer that binds a name wins');
  assert.strictEqual(scope.bottom, 'kept', 'lower layers still contribute names');
  assert.strictEqual(scope.a, 1, 'state reads resolve');
  assert.strictEqual(scope.missing, undefined, 'an unbound name is undefined');
  assert.ok('a' in scope, 'has() reports bound names');
  assert.ok(!('missing' in scope), 'and rejects unbound ones');

  assert.strictEqual(getterCalls, 0, 'building a scope does not run a lazy getter');
  assert.strictEqual(scope.lazy, 'computed');
  assert.strictEqual(getterCalls, 1, 'a lazy getter runs only when read');

  scope.a = 9;
  assert.strictEqual(state.a, 9, 'a write to a state name reaches the state');

  const derived = deriveScope(scope, { extra: 'added', a: 'shadowed' });
  assert.strictEqual(derived.extra, 'added', 'derivation adds names');
  assert.strictEqual(derived.a, 'shadowed', 'and shadows lower layers');
  assert.strictEqual(scope.a, 9, 'without disturbing the parent scope');

  assert.deepStrictEqual(deriveScope({ x: 1 }, { y: 2 }), { x: 1, y: 2 }, 'plain objects still derive by spread');
  assert.strictEqual(deriveScope(scope, null), scope, 'deriving nothing returns the same scope');
}

console.log('  ✅ Scope layering, precedence, laziness and derivation behave.');
console.log('✅ Evaluation scope tests passed!');
