/**
 * @file forDestructuredEntries.test.js
 * @description `<@for [key, value] in source>` must bind both names for an
 * object and for a Map, on the compiled path as well as the fallback path.
 *
 * The compiled path's `normaliseList()` turned a plain object into its values
 * and a Map into its values, so each row was a bare value and destructuring it
 * into `[key, value]` read `value[0]` and `value[1]` -- both undefined. The
 * loop ran the right number of times and rendered empty rows, and a key built
 * from a destructured name was `undefined` for every row, which the keyed path
 * reported as a stream of AVX_W20 duplicate-key warnings. The fallback
 * renderer's list manager already produced `[key, value]` entries for both
 * sources, so the two paths disagreed.
 *
 * The fix makes the compiled path iterate entries, matching the fallback path
 * and the templates documentation.
 */
import assert from 'assert';
import { compileComponent } from '../../benches/support/compileFixture.js';

let seq = 0;

/**
 * Mounts a compiled class, optionally with its render program removed so the
 * same class takes the string path.
 * @param {Function} ComponentClass - The compiled class.
 * @param {boolean} compiled - Whether to keep the program.
 * @returns {{host: Element, component: object}} The mount.
 */
function mount(ComponentClass, compiled) {
  const program = ComponentClass.__axProgram;
  if (!compiled) {
    delete ComponentClass.__axProgram;
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const component = new ComponentClass({}, {});
  component.mount(host);

  ComponentClass.__axProgram = program;
  assert.strictEqual(component.$compiled, compiled, `expected $compiled === ${compiled}`);
  return { host, component };
}

/**
 * Reads the rendered row texts.
 * @param {Element} host - The mount point.
 * @returns {string[]} One entry per rendered row.
 */
const rows = (host) => [...host.querySelectorAll('li')].map((li) => li.textContent.trim());

/**
 * Runs a callback while capturing AVX_W20 warnings.
 * @param {function(): void} run - The work to observe.
 * @returns {string[]} The duplicate-key warnings emitted.
 */
function duplicateKeyWarningsDuring(run) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    run();
  } finally {
    console.warn = originalWarn;
  }
  return warnings.filter((w) => w.includes('AVX_W20'));
}

const Destructured = compileComponent(
  `<state settings='{"a":1,"b":2}' m2="[]" />
<div>
  <ul id="o"><@for [key, value] in state.settings key="key"><li>{{ index }} {{ key }}: {{ value }}</li></@for></ul>
  <ul id="m"><@for [mk, mv] in state.m2 key="mk"><li>{{ index }} {{ mk }}:{{ mv }}</li></@for></ul>
</div>`,
  `ForDestructured${seq++}`,
);
assert.ok(Destructured.__axProgram, 'the destructured loops must compile, or this tests only the fallback path');

/**
 * Drives one render path through the documented object and Map examples.
 * @param {boolean} compiled - Which path.
 */
async function testDestructuredEntries(compiled) {
  const label = compiled ? 'compiled path' : 'fallback path';
  console.log(`🧪 Testing destructured <@for> entries on the ${label}...`);

  let mounted;
  const warnings = duplicateKeyWarningsDuring(() => {
    mounted = mount(Destructured, compiled);
  });
  const { host, component } = mounted;
  const list = (id) => rows(host.querySelector(`#${id}`));

  // 1. An object binds each enumerable property as `[key, value]`, in
  //    property order, and the implicit `index` is still available.
  assert.deepStrictEqual(list('o'), ['0 a: 1', '1 b: 2'], `${label}: an object loop binds key and value per entry`);

  // 2. A key built from a destructured name resolves, so a correct loop does
  //    not report duplicate keys.
  assert.deepStrictEqual(warnings, [], `${label}: a key built from a destructured name must not report AVX_W20`);

  // 3. A Map binds each entry as `[key, value]`, in insertion order.
  component.state.m2 = new Map([
    ['k', 1],
    ['x', 2],
  ]);
  await component.$nextTick();
  assert.deepStrictEqual(list('m'), ['0 k:1', '1 x:2'], `${label}: a Map loop binds key and value per entry`);

  // 4. Replacing the object re-renders every row from the new entries.
  component.state.settings = { c: 3, a: 4 };
  await component.$nextTick();
  assert.deepStrictEqual(list('o'), ['0 c: 3', '1 a: 4'], `${label}: a replaced object renders its new entries`);

  component.unmount();
  host.remove();
  console.log(`  ✅ destructured entries bind on the ${label}`);
}

/**
 * A single destructured name still binds the entry's key, and the two paths
 * render the same rows for it.
 */
async function testSingleNameDestructuring() {
  console.log('🧪 Testing a single destructured name binds the key...');

  const Single = compileComponent(
    `<state settings='{"a":1,"b":2}' />
<ul><@for [key] in state.settings key="key"><li>{{ key }}</li></@for></ul>`,
    `ForDestructuredSingle${seq++}`,
  );
  assert.ok(Single.__axProgram, 'a single-name destructured loop must compile');

  const compiled = mount(Single, true);
  const fallback = mount(Single, false);
  assert.deepStrictEqual(rows(compiled.host), ['a', 'b'], 'the compiled path binds the key');
  assert.deepStrictEqual(rows(fallback.host), rows(compiled.host), 'both paths render the same rows');

  compiled.component.unmount();
  fallback.component.unmount();
  compiled.host.remove();
  fallback.host.remove();
  console.log('  ✅ a single destructured name binds the key on both paths');
}

try {
  await testDestructuredEntries(true);
  await testDestructuredEntries(false);
  await testSingleNameDestructuring();
  console.log('Destructured <@for> entry tests passed!');
} catch (error) {
  console.error('Destructured <@for> entry tests failed!');
  console.error(error);
  process.exit(1);
}
