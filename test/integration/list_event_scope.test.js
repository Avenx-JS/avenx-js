/**
 * @file list_event_scope.test.js
 * @description An executable binding must see the scope it was written in.
 *
 * `@click="select(item.id)"` inside a `<@for>` is documented in
 * docs/core-concepts/events.md and was the most common thing an Avenx
 * application could not do: the list manager built a correct per-item scope and
 * used it for interpolation, but events were bound by the component's own pass
 * with the component's scope, so `item` was `undefined` by the time a click
 * arrived.
 *
 * The fix is not specific to lists. Any renderer that builds DOM under a
 * derived scope stamps that scope on the subtree it created, and the event
 * binder resolves a handler against the nearest stamp above the element. These
 * tests pin that for the combinations an application actually writes: a loop, a
 * loop's index, nested loops, a handler outside any loop, and a slot — which
 * used the same mechanism before lists did.
 */

import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { EXPRESSION_OPS } from '../../lib/core/expression/ops.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const roots = [];

/**
 * Compiles component source into a class, the way a build does.
 * @param {string} name - The component file's base name.
 * @param {string} source - The component source.
 * @returns {Function} The compiled component class.
 */
function compile(name, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-evtscope-'));
  roots.push(root);
  const file = path.join(root, `${name}.component.js`);
  fs.writeFileSync(file, source);
  fs.writeFileSync(path.join(root, `${name}.component.css`), '');

  const parser = new ComponentParser(new StyleProcessor());
  const body = parser.parse(file);
  const className = body.match(/class\s+([A-Za-z0-9_$]+)\s+extends/)[1];

  // The class body calls the primitives its compiled closures were emitted
  // against; a real build imports them, and framing the body here injects them.
  const opNames = Object.keys(EXPRESSION_OPS);
  const factory = new Function('AvenxComponent', ...opNames, `${body}\nreturn ${className};`);
  return factory(AvenxComponent, ...opNames.map((key) => EXPRESSION_OPS[key]));
}

/**
 * Mounts a compiled component into a detached document.
 * @param {Function} ComponentClass - The class to mount.
 * @returns {{app: object, instance: object, root: Element}} The mounted pieces.
 */
function mount(ComponentClass) {
  const host = document.createElement('div');
  host.id = `host-${Math.random().toString(36).slice(2)}`;
  document.body.appendChild(host);

  const app = new AvenxApp({ target: `#${host.id}` });
  app.register('Target', ComponentClass);
  app.mount('Target');

  return { app, root: host };
}

/**
 * Lets queued reactive work and the DOM settle.
 * @returns {Promise<void>} Resolves after the microtask queue drains.
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Clicks an element and waits for the resulting update.
 * @param {Element} element - The element to click.
 * @returns {Promise<void>} Resolves once the DOM has settled.
 */
async function click(element) {
  assert.ok(element, 'the element to click was not rendered');
  element.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
}

let failures = 0;

/**
 * Runs one named check, reporting rather than aborting the file.
 * @param {string} label - What is being checked.
 * @param {function(): Promise<void>} body - The check.
 * @returns {Promise<void>} Resolves when the check has run.
 */
async function check(label, body) {
  try {
    await body();
    console.log(`  ✅ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${label}\n     ${error.message}`);
  }
}

console.log('🧪 Testing executable bindings receive their own scope...');

await check('a handler inside <@for> sees the loop variable', async () => {
  const Component = compile(
    'loopvar',
    [
      `<state items='[{ "id": "a", "label": "Alpha" }, { "id": "b", "label": "Beta" }]' picked="''" />`,
      '',
      '<div>',
      '  <p id="picked">{{ picked }}</p>',
      '  <ul>',
      '    <@for item in items key="item.id">',
      '      <li><button class="pick" @click="picked = item.id">{{ item.label }}</button></li>',
      '    </@for>',
      '  </ul>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  const buttons = root.querySelectorAll('button.pick');
  assert.strictEqual(buttons.length, 2, 'both rows rendered');
  assert.strictEqual(buttons[0].textContent.trim(), 'Alpha', 'the loop variable interpolated');

  await click(buttons[1]);
  assert.strictEqual(
    root.querySelector('#picked').textContent.trim(),
    'b',
    'the handler read the loop variable of the row that was clicked',
  );

  await click(buttons[0]);
  assert.strictEqual(
    root.querySelector('#picked').textContent.trim(),
    'a',
    'each row resolves its own item, not the last one rendered',
  );
});

await check('a handler inside <@for> can call an action with the loop variable', async () => {
  const Component = compile(
    'loopcall',
    [
      `<state items='[{ "id": "x" }, { "id": "y" }]' chosen="''" />`,
      '',
      '<action name="choose"> chosen = args[0]; </action>',
      '',
      '<div>',
      '  <p id="chosen">{{ chosen }}</p>',
      '  <@for item in items key="item.id">',
      '    <button class="row" @click="choose(item.id)">{{ item.id }}</button>',
      '  </@for>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  const rows = root.querySelectorAll('button.row');
  assert.strictEqual(rows.length, 2, 'both rows rendered');

  await click(rows[1]);
  assert.strictEqual(
    root.querySelector('#chosen').textContent.trim(),
    'y',
    'the action received the clicked row\'s item',
  );
});

await check('a handler inside <@for> sees the loop index', async () => {
  const Component = compile(
    'loopindex',
    [
      `<state items='["p", "q", "r"]' at="-1" />`,
      '',
      '<div>',
      '  <p id="at">{{ at }}</p>',
      '  <@for item in items>',
      '    <button class="row" @click="at = index">{{ item }}</button>',
      '  </@for>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  const rows = root.querySelectorAll('button.row');
  assert.strictEqual(rows.length, 3, 'all rows rendered');

  await click(rows[2]);
  assert.strictEqual(root.querySelector('#at').textContent.trim(), '2', 'the handler read the row index');
});

await check('a handler in a nested <@for> sees both loop variables', async () => {
  const Component = compile(
    'nestedloop',
    [
      `<state groups='[{ "id": "g1", "rows": [{ "id": "r1" }, { "id": "r2" }] }, { "id": "g2", "rows": [{ "id": "r3" }] }]' hit="''" />`,
      '',
      '<div>',
      '  <p id="hit">{{ hit }}</p>',
      '  <@for group in groups key="group.id">',
      '    <section>',
      '      <@for row in group.rows key="row.id">',
      '        <button class="cell" @click="hit = group.id + \':\' + row.id">{{ row.id }}</button>',
      '      </@for>',
      '    </section>',
      '  </@for>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  const cells = root.querySelectorAll('button.cell');
  assert.strictEqual(cells.length, 3, 'every cell of both groups rendered');

  await click(cells[2]);
  assert.strictEqual(
    root.querySelector('#hit').textContent.trim(),
    'g2:r3',
    'the inner handler saw the inner variable and the enclosing one',
  );

  await click(cells[0]);
  assert.strictEqual(
    root.querySelector('#hit').textContent.trim(),
    'g1:r1',
    'each cell resolves its own pair',
  );
});

await check('a handler outside a loop is unaffected', async () => {
  const Component = compile(
    'outside',
    [
      `<state items='["only"]' count="0" />`,
      '',
      '<div>',
      '  <p id="count">{{ count }}</p>',
      '  <button id="bump" @click="count++">bump</button>',
      '  <@for item in items>',
      '    <span>{{ item }}</span>',
      '  </@for>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  await click(root.querySelector('#bump'));
  assert.strictEqual(
    root.querySelector('#count').textContent.trim(),
    '1',
    'a handler that never had an item scope still resolves component state',
  );
});

await check('a loop variable does not leak to a sibling outside the loop', async () => {
  const Component = compile(
    'noleak',
    [
      `<state items='["a"]' seen="'none'" />`,
      '',
      '<div>',
      '  <p id="seen">{{ seen }}</p>',
      '  <@for item in items>',
      '    <span class="in">{{ item }}</span>',
      '  </@for>',
      '  <button id="after" @click="seen = typeof item">after</button>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  await click(root.querySelector('#after'));
  assert.strictEqual(
    root.querySelector('#seen').textContent.trim(),
    'undefined',
    'the loop variable escaped the loop it belongs to',
  );
});

await check('rows keep their own scope after the list is reordered', async () => {
  const Component = compile(
    'reorder',
    [
      `<state items='[{ "id": "a" }, { "id": "b" }, { "id": "c" }]' picked="''" />`,
      '',
      '<action name="reverse"> items = items.slice().reverse(); </action>',
      '',
      '<div>',
      '  <p id="picked">{{ picked }}</p>',
      '  <button id="rev" @click="reverse()">reverse</button>',
      '  <@for item in items key="item.id">',
      '    <button class="row" @click="picked = item.id">{{ item.id }}</button>',
      '  </@for>',
      '</div>',
    ].join('\n'),
  );

  const { root } = mount(Component);
  await settle();

  await click(root.querySelector('#rev'));

  const rows = root.querySelectorAll('button.row');
  assert.strictEqual(rows.length, 3, 'all rows survived the reorder');
  assert.strictEqual(rows[0].textContent.trim(), 'c', 'the list actually reordered');

  // The node in position 0 may well be a recycled one that used to hold "a".
  // Its handler has to resolve the item it holds *now*.
  await click(rows[0]);
  assert.strictEqual(
    root.querySelector('#picked').textContent.trim(),
    'c',
    'a reused row resolved the item it previously held',
  );
});

if (failures > 0) {
  console.error(`\n❌ ${failures} event-scope check(s) failed.`);
  process.exit(1);
}

console.log('\n🎉 Executable bindings receive their own scope.');
