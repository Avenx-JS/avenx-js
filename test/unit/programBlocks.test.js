/**
 * @file programBlocks.test.js
 * @description The runtime half of compiled control flow.
 *
 * These drive `TemplateInstance` directly, with a hand-written program and a
 * stub host, so a failure points at the block runtime rather than at the
 * compiler that produced the program. The compiler's own output is covered by
 * irLowering.test.js, and the two meeting is covered by the render-path parity
 * and E2E suites.
 */
import assert from 'assert';
import { TemplateInstance } from '../../lib/core/renderer/program/TemplateInstance.js';
import { OpKind, PROGRAM_VERSION } from '../../lib/compiler/render/program.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';

/**
 * Mounts a program into a detached host element.
 *
 * The host evaluates an expression index by calling the closure at that index
 * with a scope built from the component state plus the block's locals, which is
 * what `AvenxComponent` does with the real compiled table.
 * @param {object} program - The program to mount.
 * @param {object} state - Reactive state the expressions read.
 * @param {Array<function(object): any>} expressions - Compiled expressions, by index.
 * @param {Array<function(object): any>} [statements] - Compiled statements, by index.
 * @returns {{element: Element, instance: TemplateInstance}} The mount.
 */
function mount(program, state, expressions, statements = []) {
  const host = {
    program,
    /**
     * @param {number} index - The expression index.
     * @param {object|null} locals - The block's local bindings.
     * @returns {any} The value.
     */
    evaluate(index, locals) {
      return expressions[index]({ ...state, ...(locals || {}) , state });
    },
    /**
     * @param {number} index - The statement index.
     * @param {Event} event - The DOM event.
     * @param {object|null} locals - The block's local bindings.
     * @returns {any} Whatever the statement returned.
     */
    runStatement(index, event, locals) {
      return statements[index]({ ...state, ...(locals || {}), event, state });
    },
  };

  const instance = new TemplateInstance(program, host);
  assert.ok(instance.usable, 'the skeleton could not be prepared');
  const element = document.createElement('div');
  element.appendChild(instance.create());
  return { element, instance };
}

/**
 * Builds a reactive state object.
 * @param {object} initial - The initial values.
 * @returns {object} The reactive state.
 */
function reactive(initial) {
  return new StateFactory().create(initial);
}

async function testConditionalSwitching() {
  console.log('🧪 <@if> renders one arm and swaps on change');
  const state = reactive({ mode: 'a' });
  const program = {
    v: PROGRAM_VERSION,
    html: '<div><!--axt:0--></div>',
    ops: [
      {
        k: OpKind.IF,
        t: 0,
        arms: [
          { x: 0, b: 0 },
          { x: 1, b: 1 },
          { x: null, b: 2 },
        ],
      },
    ],
    elements: 0,
    texts: 1,
    blocks: [
      { html: '<b>A</b>', ops: [], elements: 0, texts: 0 },
      { html: '<i>B</i>', ops: [], elements: 0, texts: 0 },
      { html: '<u>other</u>', ops: [], elements: 0, texts: 0 },
    ],
  };

  const { element } = mount(program, state, [
    (s) => s.mode === 'a',
    (s) => s.mode === 'b',
  ]);

  assert.strictEqual(element.querySelector('b').textContent, 'A');
  assert.strictEqual(element.querySelector('i'), null, 'only the matching arm renders');

  state.mode = 'b';
  await nextTick();
  assert.strictEqual(element.querySelector('b'), null, 'the previous arm is removed');
  assert.strictEqual(element.querySelector('i').textContent, 'B');

  state.mode = 'z';
  await nextTick();
  assert.strictEqual(element.querySelector('u').textContent, 'other', '<@else> catches the rest');
  console.log('  ✅ arms swap, and only one is in the document at a time');
}

async function testConditionalKeepsLiveDom() {
  console.log('🧪 <@if> does not rebuild the arm that is already showing');
  const state = reactive({ on: true, n: 1 });
  const program = {
    v: PROGRAM_VERSION,
    html: '<div><!--axt:0--></div>',
    ops: [{ k: OpKind.IF, t: 0, arms: [{ x: 0, b: 0 }] }],
    elements: 0,
    texts: 1,
    blocks: [{ html: '<input><!--axt:0-->', ops: [{ k: OpKind.TEXT, t: 0, x: 1 }], elements: 0, texts: 1 }],
  };

  const { element } = mount(program, state, [(s) => s.on, (s) => s.n]);
  const input = element.querySelector('input');
  input.value = 'typed';

  state.n = 2;
  await nextTick();
  assert.strictEqual(element.querySelector('input'), input, 'the same node survives an unrelated change');
  assert.strictEqual(input.value, 'typed', 'so does what the user typed into it');
  console.log('  ✅ a condition that did not change tears nothing down');
}

async function testListRendering() {
  console.log('🧪 <@for> renders a row per element');
  const state = reactive({ rows: [{ id: 1, n: 'one' }, { id: 2, n: 'two' }] });
  const program = {
    v: PROGRAM_VERSION,
    html: '<ul><!--axt:0--></ul>',
    ops: [{ k: OpKind.FOR, t: 0, x: 0, as: 'row', key: 1, b: 0, emp: 1 }],
    elements: 0,
    texts: 1,
    blocks: [
      { html: '<li><!--axt:0--></li>', ops: [{ k: OpKind.TEXT, t: 0, x: 2 }], elements: 0, texts: 1 },
      { html: '<li class="none">none</li>', ops: [], elements: 0, texts: 0 },
    ],
  };

  const { element } = mount(program, state, [
    (s) => s.rows,
    (s) => s.row.id,
    (s) => s.row.n,
  ]);

  assert.deepStrictEqual(
    [...element.querySelectorAll('li')].map((li) => li.textContent),
    ['one', 'two'],
  );

  state.rows.push({ id: 3, n: 'three' });
  await nextTick();
  assert.deepStrictEqual(
    [...element.querySelectorAll('li')].map((li) => li.textContent),
    ['one', 'two', 'three'],
    'an appended row is appended',
  );
  console.log('  ✅ rows render and grow with the list');
}

async function testListReorderReusesNodes() {
  console.log('🧪 <@for> reuses keyed rows across a reorder');
  const state = reactive({ rows: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 3, n: 'c' }] });
  const program = {
    v: PROGRAM_VERSION,
    html: '<ul><!--axt:0--></ul>',
    ops: [{ k: OpKind.FOR, t: 0, x: 0, as: 'row', key: 1, b: 0 }],
    elements: 0,
    texts: 1,
    blocks: [{ html: '<li><!--axt:0--></li>', ops: [{ k: OpKind.TEXT, t: 0, x: 2 }], elements: 0, texts: 1 }],
  };

  const { element } = mount(program, state, [(s) => s.rows, (s) => s.row.id, (s) => s.row.n]);
  const before = [...element.querySelectorAll('li')];
  before[0].setAttribute('data-mark', 'first');

  state.rows = [state.rows[2], state.rows[0], state.rows[1]];
  await nextTick();

  const after = [...element.querySelectorAll('li')];
  assert.deepStrictEqual(after.map((li) => li.textContent), ['c', 'a', 'b'], 'the order follows the list');
  assert.strictEqual(after[1].getAttribute('data-mark'), 'first', 'the node for key 1 moved rather than being rebuilt');
  console.log('  ✅ a reorder moves nodes instead of recreating them');
}

async function testListRemovalAndEmpty() {
  console.log('🧪 <@for> removes rows and shows <@empty>');
  const state = reactive({ rows: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }] });
  const program = {
    v: PROGRAM_VERSION,
    html: '<ul><!--axt:0--></ul>',
    ops: [{ k: OpKind.FOR, t: 0, x: 0, as: 'row', key: 1, b: 0, emp: 1 }],
    elements: 0,
    texts: 1,
    blocks: [
      { html: '<li><!--axt:0--></li>', ops: [{ k: OpKind.TEXT, t: 0, x: 2 }], elements: 0, texts: 1 },
      { html: '<li class="none">none</li>', ops: [], elements: 0, texts: 0 },
    ],
  };

  const { element } = mount(program, state, [(s) => s.rows, (s) => s.row.id, (s) => s.row.n]);

  state.rows = [state.rows[1]];
  await nextTick();
  assert.deepStrictEqual([...element.querySelectorAll('li')].map((li) => li.textContent), ['b']);

  state.rows = [];
  await nextTick();
  assert.strictEqual(element.querySelectorAll('li').length, 1, 'the empty block is the only row left');
  assert.strictEqual(element.querySelector('li').className, 'none');

  state.rows = [{ id: 9, n: 'z' }];
  await nextTick();
  assert.strictEqual(element.querySelector('.none'), null, 'the empty block goes when the list refills');
  assert.strictEqual(element.querySelector('li').textContent, 'z');
  console.log('  ✅ removal, the empty block, and refilling all behave');
}

async function testNestedBlocks() {
  console.log('🧪 a conditional inside a loop body');
  const state = reactive({ rows: [{ id: 1, on: true }, { id: 2, on: false }] });
  const program = {
    v: PROGRAM_VERSION,
    html: '<ul><!--axt:0--></ul>',
    ops: [{ k: OpKind.FOR, t: 0, x: 0, as: 'row', key: 1, b: 0 }],
    elements: 0,
    texts: 1,
    blocks: [
      {
        html: '<li><!--axt:0--></li>',
        ops: [{ k: OpKind.IF, t: 0, arms: [{ x: 2, b: 1 }, { x: null, b: 2 }] }],
        elements: 0,
        texts: 1,
      },
      { html: '<b>on</b>', ops: [], elements: 0, texts: 0 },
      { html: '<i>off</i>', ops: [], elements: 0, texts: 0 },
    ],
  };

  const { element } = mount(program, state, [(s) => s.rows, (s) => s.row.id, (s) => s.row.on]);
  assert.deepStrictEqual(
    [...element.querySelectorAll('li')].map((li) => li.textContent),
    ['on', 'off'],
    'each row evaluates the condition against its own item',
  );

  state.rows[1].on = true;
  await nextTick();
  assert.deepStrictEqual([...element.querySelectorAll('li')].map((li) => li.textContent), ['on', 'on']);
  console.log('  ✅ nested blocks see the enclosing loop binding');
}

async function testEventOps() {
  console.log('🧪 event ops attach once and carry loop scope');
  const state = reactive({ rows: [{ id: 7 }], clicked: null });
  const program = {
    v: PROGRAM_VERSION,
    html: '<ul><!--axt:0--></ul>',
    ops: [{ k: OpKind.FOR, t: 0, x: 0, as: 'row', key: 1, b: 0 }],
    elements: 0,
    texts: 1,
    blocks: [
      {
        html: '<li><button data-axb="0">go</button></li>',
        ops: [{ k: OpKind.EVENT, e: 0, n: 'click', x: 0 }],
        elements: 1,
        texts: 0,
      },
    ],
  };

  const { element } = mount(
    program,
    state,
    [(s) => s.rows, (s) => s.row.id],
    [(s) => { state.clicked = s.row.id; }],
  );

  element.querySelector('button').dispatchEvent(new window.Event('click'));
  assert.strictEqual(state.clicked, 7, 'the handler saw its row');
  console.log('  ✅ a handler in a loop body resolves the loop binding');
}

async function testDisposeReleasesRows() {
  console.log('🧪 disposing an instance releases its blocks');
  const state = reactive({ rows: [{ id: 1, n: 'a' }] });
  const program = {
    v: PROGRAM_VERSION,
    html: '<ul><!--axt:0--></ul>',
    ops: [{ k: OpKind.FOR, t: 0, x: 0, as: 'row', key: 1, b: 0 }],
    elements: 0,
    texts: 1,
    blocks: [{ html: '<li><!--axt:0--></li>', ops: [{ k: OpKind.TEXT, t: 0, x: 2 }], elements: 0, texts: 1 }],
  };

  const { element, instance } = mount(program, state, [(s) => s.rows, (s) => s.row.id, (s) => s.row.n]);
  assert.strictEqual(element.querySelectorAll('li').length, 1);

  instance.dispose();
  assert.strictEqual(element.querySelectorAll('li').length, 0, 'the row nodes are gone');

  // A write after disposal must not resurrect anything or throw.
  state.rows.push({ id: 2, n: 'b' });
  await nextTick();
  assert.strictEqual(element.querySelectorAll('li').length, 0, 'a disposed list stays disposed');
  console.log('  ✅ teardown reaches nested block instances');
}

async function run() {
  await testConditionalSwitching();
  await testConditionalKeepsLiveDom();
  await testListRendering();
  await testListReorderReusesNodes();
  await testListRemovalAndEmpty();
  await testNestedBlocks();
  await testEventOps();
  await testDisposeReleasesRows();
  console.log('\n✅ program block runtime tests passed');
}

await run();
