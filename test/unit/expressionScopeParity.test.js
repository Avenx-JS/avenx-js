/**
 * @file expressionScopeParity.test.js
 * @description Precompiled and interpreted evaluation, over the same component
 * scope, compared.
 *
 * ## What this adds over the tests that already exist
 *
 * `expressionCodegen.test.js` is already a differential test of the generator
 * against the interpreter, and it covers the expression *language* thoroughly.
 * It evaluates both sides against a plain object, which is the right scope for
 * asking "does `a?.b ?? c` mean the same thing twice".
 *
 * It is the wrong scope for the question this file asks. A template expression
 * does not resolve names against an object literal: it resolves them against a
 * layered surface built from a component's state, its computed values, its
 * actions, the props its parent passed, the data a child exposed on a slot, and
 * the loop variables of every enclosing `<@for>`. Those layers shadow each
 * other, and the compiled path and the interpreted path arrive at that surface
 * by different routes -- one through real JavaScript parameters and `axGet`,
 * the other through a tree walk and a frame chain.
 *
 * So the comparison here is made through the whole machinery: one component,
 * compiled by the real compiler, mounted twice. Once as built, where every
 * expression is a closure the engine compiled. Once with the compiled tables
 * deleted from the class, so the same expressions reach the interpreter as
 * source text -- which is what a development build does for an expression the
 * generator could not compile, and the state the framework has to keep honest
 * for as long as the interpreter exists at all.
 *
 * Shadowing is the case worth having a test for, and the reason it is not
 * obvious: a loop variable named `count` beside a state key named `count` is
 * the one place where getting the layer order wrong changes what a template
 * means without changing whether it renders.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { compileComponent } from '../../benches/support/compileFixture.js';
import { loadComponent } from '../../lib/core/tooling/loadComponent.js';
import { hasExpressionInterpreter } from '../../lib/core/expression/fallback.js';

// The premise of the file. Without an interpreter installed there is no
// interpreted side to compare against, and every assertion below would be
// comparing the compiled path with itself.
assert.ok(
  hasExpressionInterpreter(),
  'this file needs the expression interpreter installed; the test runner does that for test/unit',
);

let seq = 0;

/**
 * The class statics that hold compiled code.
 *
 * `__axProgram` is the render program, whose ops address expressions by index.
 * `__axProgramExprs` and `__axProgramStmts` are those indexed closures.
 * `__axExprs` and `__axStmts` are the source-keyed tables the string renderer
 * consults. Removing all five is what puts a component back on the interpreted
 * path: the program goes, so the string renderer runs, and the tables go, so
 * every expression it evaluates is parsed from the source in the DOM.
 * @type {string[]}
 */
const COMPILED_STATICS = ['__axProgram', '__axProgramExprs', '__axProgramStmts', '__axExprs', '__axStmts'];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-scope-parity-'));

/**
 * Compiles a page, which `compileFixture` does not do.
 *
 * `compileComponent` covers the component case and is used everywhere else in
 * this file. A page is needed for exactly one scenario -- a scoped slot, whose
 * data only exists once a parent has instantiated the child -- and only
 * `AvenxPage` instantiates the components in its own template.
 * @param {'component'|'page'} kind - Which unit to compile.
 * @param {string} source - The unit's source.
 * @returns {Function} The compiled class.
 */
function compileUnit(kind, source) {
  const name = `Scope${kind === 'page' ? 'Page' : 'Child'}${seq++}`;
  const file = path.join(scratch, `${name}.${kind}.js`);
  fs.writeFileSync(file, source);
  return loadComponent(file, { config: { logging: { silent: true } } });
}

/**
 * Mounts a class, with or without the compiled code the compiler emitted.
 * @param {Function} ComponentClass - The compiled class.
 * @param {boolean} precompiled - Whether to keep the compiled tables.
 * @param {object} [props] - Props to pass, as a parent would.
 * @returns {{host: Element, component: object}} The mount.
 */
function mount(ComponentClass, precompiled, props = {}) {
  const saved = new Map();
  if (!precompiled) {
    for (const key of COMPILED_STATICS) {
      if (Object.prototype.hasOwnProperty.call(ComponentClass, key)) {
        saved.set(key, ComponentClass[key]);
        delete ComponentClass[key];
      }
    }
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  let component;
  try {
    component = new ComponentClass({}, props);
    component.mount(host);
  } finally {
    for (const [key, value] of saved) {
      ComponentClass[key] = value;
    }
  }

  assert.strictEqual(
    component.$compiled,
    precompiled,
    `expected $compiled === ${precompiled}; this test would otherwise compare one path against itself`,
  );
  return { host, component };
}

/**
 * Reads the values the scenario is about, by test id.
 *
 * Comparing rendered values rather than markup is deliberate. The two render
 * paths leave different bookkeeping in the document -- `data-ax-event` and the
 * `<template data-ax-for>` holding an unrendered body among it -- and
 * `renderPathParity.test.js` already owns that comparison. What is under test
 * here is what each expression evaluated to.
 * @param {Element} host - The mounted host.
 * @returns {Object<string, string>} Text content by test id, in document order.
 */
function values(host) {
  const found = {};
  for (const element of host.querySelectorAll('[data-testid]')) {
    const id = element.getAttribute('data-testid');
    const text = element.textContent.replace(/\s+/g, ' ').trim();
    found[id] = Object.prototype.hasOwnProperty.call(found, id) ? `${found[id]}|${text}` : text;
  }
  return found;
}

/**
 * Compiles one component and requires both evaluation paths to agree.
 * @param {string} label - Scenario name.
 * @param {string} source - Component source.
 * @param {object} [options] - Scenario options.
 * @param {object} [options.props] - Props to mount with.
 * @param {function(object, Element): Promise<void>} [options.drive] - Interactions to run.
 * @returns {Promise<Object<string, string>>} The agreed values, for assertions.
 */
async function parity(label, source, options = {}) {
  console.log(`🧪 Testing ${label}...`);

  const ComponentClass = compileComponent(source, `ScopeParity${seq++}`);
  assert.ok(
    ComponentClass.__axProgram,
    `${label}: the template must compile, or the precompiled side is not the precompiled side`,
  );

  const precompiled = mount(ComponentClass, true, options.props);
  const interpreted = mount(ComponentClass, false, options.props);

  assert.deepStrictEqual(
    values(interpreted.host),
    values(precompiled.host),
    `${label}: the two evaluation paths disagree on first render`,
  );

  if (options.drive) {
    await options.drive(precompiled.component, precompiled.host);
    await options.drive(interpreted.component, interpreted.host);

    assert.deepStrictEqual(
      values(interpreted.host),
      values(precompiled.host),
      `${label}: the two evaluation paths diverged after the same interactions`,
    );
  }

  const agreed = values(precompiled.host);
  precompiled.component.unmount();
  interpreted.component.unmount();
  precompiled.host.remove();
  interpreted.host.remove();
  return agreed;
}

/**
 * State, computed values and an action, which is the common case.
 */
async function testStateComputedAndActions() {
  const agreed = await parity(
    'state, computed values and actions',
    `<state count="2" label="'board'" flag="true" />
<computed name="doubled" value="count * 2" />
<computed name="caption" value="flag ? label.toUpperCase() : 'off'" />

<action name="bump">
  count = count + 3;
</action>

<div>
  <p data-testid="state">{{ count }}</p>
  <p data-testid="computed">{{ doubled }}</p>
  <p data-testid="chained">{{ caption }}</p>
  <p data-testid="method">{{ typeof bump }}</p>
  <p data-testid="mixed">{{ count > 1 && doubled === count * 2 ? label : 'no' }}</p>
  <button id="go" @click="bump()">+</button>
</div>`,
    {
      /**
       * @param {object} component - The mounted component.
       * @param {Element} host - Its host element.
       */
      async drive(component, host) {
        // Through a real click, because an inline handler is one of the
        // expression kinds under comparison: the compiled side runs a closure
        // the engine parsed, the interpreted side parses `bump()` from the
        // `data-ax-event` attribute in the document.
        host.querySelector('#go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await component.$nextTick();
      },
    },
  );

  // The values themselves, so a scenario where both paths are equally broken
  // cannot pass. Taken after the interaction, so they also pin what the action
  // did.
  assert.strictEqual(agreed.state, '5', 'the action should have raised count to 5');
  assert.strictEqual(agreed.computed, '10', 'the computed value should have followed');
  assert.strictEqual(agreed.chained, 'BOARD', 'a computed value reading another binding');
  assert.strictEqual(agreed.method, 'function', 'an action should be visible to the template as a function');
}

/**
 * Props a parent passed, beside state of the same component.
 */
async function testProps() {
  const agreed = await parity(
    'props',
    `<state local="'own'" />

<div>
  <p data-testid="prop">{{ props.title }}</p>
  <p data-testid="prop-member">{{ props.owner.name }}</p>
  <p data-testid="prop-and-state">{{ props.title + '/' + local }}</p>
  <p data-testid="missing-prop">{{ typeof props.absent }}</p>
</div>`,
    { props: { title: 'Passed', owner: { name: 'Ada' } } },
  );

  assert.strictEqual(agreed.prop, 'Passed', 'a prop should resolve');
  assert.strictEqual(agreed['prop-member'], 'Ada', 'a member read on a prop should resolve');
  assert.strictEqual(agreed['prop-and-state'], 'Passed/own', 'props and state should share one surface');
  assert.strictEqual(agreed['missing-prop'], 'undefined', 'an absent name should be undefined, not an error');
}

/**
 * `<@for>` item and index variables.
 */
async function testLoopVariables() {
  const agreed = await parity(
    'loop variables',
    `<state
  items="[{ id: 1, name: 'one' }, { id: 2, name: 'two' }, { id: 3, name: 'three' }]"
  suffix="'!'"
/>

<ul>
  <@for item in items key="item.id">
    <li data-testid="row">{{ index }}:{{ item.name }}{{ suffix }}</li>
  </@for>
</ul>`,
  );

  assert.strictEqual(
    agreed.row,
    '0:one!|1:two!|2:three!',
    'the loop should read its item, its index and an outer state key',
  );
}

/**
 * A loop variable that shadows a state key of the same name.
 *
 * The case the issue singles out, and the one where a wrong layer order is
 * invisible: both paths render *something* either way, and only the value says
 * which name won.
 */
async function testShadowing() {
  const agreed = await parity(
    'loop variables shadowing state',
    `<state
  count="100"
  label="'outer'"
  rows="[{ count: 1, label: 'a' }, { count: 2, label: 'b' }]"
/>
<computed name="total" value="count * 2" />

<ul>
  <@for label in rows key="label.count">
    <li data-testid="shadowed">{{ label.count }}/{{ label.label }}</li>
  </@for>
  <p data-testid="after">{{ label }}</p>
  <p data-testid="outer-count">{{ count }}</p>
  <p data-testid="outer-computed">{{ total }}</p>
</ul>`,
  );

  // Inside the loop, `label` is the row. Outside it, `label` is state again,
  // and the computed value that reads `count` never saw the row's `count`.
  assert.strictEqual(agreed.shadowed, '1/a|2/b', 'the loop variable should shadow the state key inside the loop');
  assert.strictEqual(agreed.after, 'outer', 'the state key should be visible again after the loop');
  assert.strictEqual(agreed['outer-count'], '100', 'an unshadowed state key should be unaffected');
  assert.strictEqual(agreed['outer-computed'], '200', 'a computed value should read state, not a loop variable');
}

/**
 * Nested loops, where the inner variable shadows the outer one.
 */
async function testNestedShadowing() {
  const agreed = await parity(
    'nested loops shadowing each other',
    `<state
  groups="[{ id: 1, rows: [{ id: 11 }, { id: 12 }] }, { id: 2, rows: [{ id: 21 }] }]"
/>

<ul>
  <@for row in groups key="row.id">
    <li>
      <@for row in row.rows key="row.id">
        <span data-testid="cell">{{ row.id }}</span>
      </@for>
    </li>
  </@for>
</ul>`,
  );

  assert.strictEqual(agreed.cell, '11|12|21', 'the inner loop variable should shadow the outer one');
}

/**
 * Data a child exposes on a slot, read from the parent's template.
 *
 * The parent is a page rather than a component, because only `AvenxPage`
 * instantiates the child components in its own template -- which is what a
 * scoped slot needs in order to have anything to expose. Its registry is
 * passed to the constructor, as a build's generated entry does.
 */
async function testSlotScope() {
  console.log('🧪 Testing slot scope...');

  const Child = compileUnit(
    'component',
    `<state current="{ id: 7, name: 'exposed' }" visible="true" />

<div class="child">
  <slot :item="state.current" :visible="state.visible"></slot>
</div>`,
  );

  const Parent = compileUnit(
    'page',
    `<state heading="'parent'" />

<div>
  <${Child.name}>
    <template data-slot-props="slotProps">
      <p data-testid="slot-member">{{ slotProps.item.name }}</p>
      <p data-testid="slot-and-state">{{ heading + ':' + slotProps.item.id }}</p>
      <p data-testid="slot-flag">{{ slotProps.visible ? 'on' : 'off' }}</p>
    </template>
  </${Child.name}>
</div>`,
  );

  // Not `__axProgram`. A scoped slot is one of the constructs the IR refuses,
  // so both mounts below render through the string renderer -- which makes this
  // the one scenario where the only difference between the two sides is how the
  // expressions themselves are evaluated. That is what is under comparison, so
  // the expression table is what has to be there.
  assert.ok(Parent.__axExprs, 'the parent must have a compiled expression table, or this compares nothing');

  /**
   * Mounts the pair, with or without the compiled tables.
   * @param {boolean} precompiled - Whether to keep the compiled tables.
   * @returns {Promise<{host: Element, component: object}>} The mount.
   */
  const mountPair = async (precompiled) => {
    const saved = [];
    if (!precompiled) {
      for (const Class of [Parent, Child]) {
        for (const key of COMPILED_STATICS) {
          if (Object.prototype.hasOwnProperty.call(Class, key)) {
            saved.push([Class, key, Class[key]]);
            delete Class[key];
          }
        }
      }
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    let component;
    try {
      component = new Parent({}, new Map([[Child.name, Child]]), {});
      component.mount(host);
      await component.$nextTick();
    } finally {
      for (const [Class, key, value] of saved) {
        Class[key] = value;
      }
    }
    return { host, component };
  };

  const precompiled = await mountPair(true);
  const interpreted = await mountPair(false);

  const expected = values(precompiled.host);
  assert.deepStrictEqual(
    values(interpreted.host),
    expected,
    'slot scope: the two evaluation paths disagree',
  );

  // The slot rendered at all, which is what makes the comparison above mean
  // something: two empty hosts are also equal.
  assert.strictEqual(expected['slot-member'], 'exposed', "the parent should read the child's exposed item");
  assert.strictEqual(expected['slot-and-state'], 'parent:7', 'slot props and parent state should share one surface');
  assert.strictEqual(expected['slot-flag'], 'on', 'a boolean slot prop should be readable');

  precompiled.component.unmount();
  interpreted.component.unmount();
  precompiled.host.remove();
  interpreted.host.remove();
}

/**
 * Directive expressions and bound attributes, which are evaluated the same way.
 */
async function testDirectivesAndBindings() {
  const agreed = await parity(
    'directives and bound attributes',
    `<state count="3" items="['x', 'y']" title="'t'" />

<div>
  <p data-testid="shown" data-ax-show="count > 2">{{ count }}</p>
  <p data-testid="hidden" data-ax-show="count > 9">never</p>
  <span data-testid="attr" :title="title + count">bound</span>
  <span data-testid="len">{{ items.length }}</span>
</div>`,
  );

  assert.strictEqual(agreed.shown, '3', 'a shown element renders its interpolation');
  assert.strictEqual(agreed.len, '2', 'a member read on state resolves');
}

await testStateComputedAndActions();
await testProps();
await testLoopVariables();
await testShadowing();
await testNestedShadowing();
await testSlotScope();
await testDirectivesAndBindings();

fs.rmSync(scratch, { recursive: true, force: true });

console.log('\n✅ Precompiled and interpreted evaluation agree across the component scope matrix');
