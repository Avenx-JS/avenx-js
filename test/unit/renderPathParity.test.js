/**
 * @file renderPathParity.test.js
 * @description The same component, rendered both ways, compared.
 *
 * Avenx now has two renderers. The compiled one drives templates it can compile
 * exhaustively; the string one drives everything else, and will keep doing so
 * for as long as `<@for>` and `<slot>` exist. Two renderers is a maintenance
 * hazard exactly to the extent that they can disagree, so this file is the
 * seam between them.
 *
 * Each case compiles one component with the real compiler, mounts it twice --
 * once with its render program, once with the program removed so the same class
 * takes the string path -- drives both through the same interactions, and
 * requires the two to produce the same DOM and the same lifecycle.
 *
 * Removing the program is done by deleting the class static the compiler emits.
 * The generated constructor reads `X.__axProgram` at construction time, so
 * without it `options.program` is undefined and the component falls back
 * exactly as an uncompilable template would. That is a real fallback, not a
 * simulated one.
 *
 * Where the two *should* differ, the difference is asserted rather than
 * papered over. There is one, and it is documented: a compiled component only
 * ever writes to its own bindings, so DOM edited from outside the framework
 * survives an update, where the string renderer's diff removes it.
 */
import assert from 'assert';
import { compileComponent } from '../../benches/support/compileFixture.js';

let seq = 0;

/**
 * Mounts a compiled class, optionally with its render program removed.
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
  assert.strictEqual(
    component.$compiled,
    compiled,
    `expected $compiled === ${compiled}; the parity test would otherwise compare a path against itself`,
  );
  return { host, component };
}

/**
 * Normalises rendered markup so the two paths are compared on what they mean.
 *
 * Whitespace between elements is not a rendering decision either path makes on
 * purpose, and the string renderer's parse-and-serialise round trip collapses
 * some of it. Attribute order likewise reflects insertion order, not intent.
 * @param {string} markup - The rendered HTML.
 * @returns {string} A comparable form.
 */
function normalise(markup) {
  return (
    markup
      // Framework bookkeeping the compiled path consumes and the string path
      // leaves in the document. `data-ax-show`, `data-ax-class`,
      // `data-ax-html` and `data-props-*` hold expression source that a
      // program has already turned into ops, and `data-ax-static` is an
      // instruction to a diff engine that is not running. Their absence is the
      // intended difference, asserted on its own in testBookkeepingIsConsumed;
      // comparing them here would drown the differences that matter.
      .replace(/\s+data-ax-(show|class|html|static)="[^"]*"/g, '')
      .replace(/\s+data-props-[\w-]+="[^"]*"/g, '')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .replace(/\s*=\s*/g, '=')
      .replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)+)\s*(\/?)>/g, (whole, tag, attrs, close) => {
        // Attribute order is insertion order, and the two paths insert in
        // different orders: the string renderer parses a finished tag, while a
        // program parses a skeleton and then writes the bound attributes. That
        // is not a rendering difference, so it is sorted away rather than
        // asserted on.
        const sorted = (attrs.match(/[^\s=]+(?:="[^"]*")?/g) || []).sort();
        return `<${tag}${sorted.length ? ` ${sorted.join(' ')}` : ''}${close}>`;
      })
      .trim()
  );
}

/**
 * Runs one scenario against both renderers and requires them to agree.
 * @param {string} label - Scenario name.
 * @param {string} source - Component source.
 * @param {function(object, Element): Promise<void>} drive - Interactions to run.
 */
async function parity(label, source, drive) {
  console.log(`🧪 Testing parity: ${label}...`);

  const ComponentClass = compileComponent(source, `Parity${seq++}`);
  assert.ok(ComponentClass.__axProgram, `${label} must compile, or this compares nothing`);

  const compiled = mount(ComponentClass, true);
  const legacy = mount(ComponentClass, false);

  assert.strictEqual(
    normalise(compiled.host.innerHTML),
    normalise(legacy.host.innerHTML),
    `${label}: first render differs between the two renderers`,
  );

  await drive(compiled.component, compiled.host);
  await drive(legacy.component, legacy.host);

  assert.strictEqual(
    normalise(compiled.host.innerHTML),
    normalise(legacy.host.innerHTML),
    `${label}: the two renderers diverged after the same interactions`,
  );

  compiled.component.unmount();
  legacy.component.unmount();
  compiled.host.remove();
  legacy.host.remove();
}

/**
 * Text interpolation, including values that look like markup.
 */
async function testTextParity() {
  await parity(
    'text interpolation',
    `<state name="Ada" count="0" />
<div><h1>Hello {{ name }}</h1><p>Count: {{ count }} / {{ count }}</p></div>`,
    async (component) => {
      component.state.count = 7;
      await component.$nextTick();
      component.state.name = '<b>bold</b>';
      await component.$nextTick();
      component.state.name = null;
      await component.$nextTick();
    },
  );
}

/**
 * Attributes: whole-value, mixed with literals, boolean, and removal.
 */
async function testAttributeParity() {
  await parity(
    'attributes',
    `<state title="one" kind="primary" busy="true" />
<div><a title="{{ title }}" class="base {{ kind }}">x</a><button disabled="{{ busy }}">y</button></div>`,
    async (component) => {
      component.state.kind = 'danger';
      await component.$nextTick();
      component.state.busy = false;
      await component.$nextTick();
      component.state.title = null;
      await component.$nextTick();
      component.state.busy = true;
      await component.$nextTick();
    },
  );
}

/**
 * Computed values, and an action driven by an event.
 */
async function testComputedAndEventParity() {
  await parity(
    'computed values and events',
    `<state count="0" step="2" />
<computed name="doubled" value="count * 2" />
<action name="inc"> count = count + step; </action>
<div><span data-testid="c">{{ count }}</span><span data-testid="d">{{ doubled }}</span>
<button id="go" @click="inc()">+</button></div>`,
    async (component, host) => {
      const button = host.querySelector('#go');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await component.$nextTick();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await component.$nextTick();
    },
  );
}

/**
 * The directive bindings the program implements.
 */
async function testDirectiveParity() {
  await parity(
    'show and class directives',
    `<state open="true" mods="active" />
<div><section data-ax-show="open"><p>body</p></section><i data-ax-class="mods">m</i></div>`,
    async (component) => {
      component.state.open = false;
      await component.$nextTick();
      component.state.mods = 'large highlighted';
      await component.$nextTick();
      component.state.open = true;
      await component.$nextTick();
    },
  );
}

/**
 * A large static subtree beside a live binding.
 */
async function testStaticSubtreeParity() {
  const rows = Array.from({ length: 12 }, (_, i) => `<li><b>row ${i}</b></li>`).join('');
  await parity(
    'static subtree beside a live binding',
    `<state n="0" />\n<div><p>{{ n }}</p><ul>${rows}</ul></div>`,
    async (component) => {
      component.state.n = 3;
      await component.$nextTick();
    },
  );
}

/**
 * Form controls, where the value attribute and the value property diverge.
 */
async function testFormControlParity() {
  await parity(
    'form control value',
    `<state name="Ada" />
<div><input type="text" value="{{ name }}" data-testid="i" /><span>{{ name }}</span></div>`,
    async (component, host) => {
      const input = host.querySelector('[data-testid="i"]');
      // Simulate a user having typed, which is what makes the attribute stop
      // driving the property.
      input.value = 'typed by hand';
      component.state.name = 'Grace';
      await component.$nextTick();
      assert.strictEqual(input.value, 'Grace', 'a state change must reach a control the user touched');
    },
  );
}

/**
 * The lifecycle hooks fire in the same order, the same number of times.
 */
async function testLifecycleParity() {
  console.log('🧪 Testing parity: lifecycle hooks...');

  const ComponentClass = compileComponent(
    `<state n="0" />\n<div><span>{{ n }}</span></div>`,
    `ParityLifecycle${seq++}`,
  );

  /**
   * Mounts and records hook order for one path.
   * @param {boolean} compiled - Whether to keep the program.
   * @returns {Promise<string[]>} The hooks that fired after two updates.
   */
  async function record(compiled) {
    const calls = [];
    /** Records lifecycle callbacks. */
    class Probe extends ComponentClass {
      /** Records onBeforeUpdate. */
      onBeforeUpdate() {
        calls.push('beforeUpdate');
      }

      /** Records onUpdate. */
      onUpdate() {
        calls.push('update');
      }
    }

    const program = ComponentClass.__axProgram;
    if (!compiled) delete ComponentClass.__axProgram;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const component = new Probe({}, {});
    component.mount(host);
    ComponentClass.__axProgram = program;

    assert.strictEqual(component.$compiled, compiled);
    await component.$nextTick();
    calls.length = 0;

    component.state.n = 1;
    await component.$nextTick();
    component.state.n = 2;
    await component.$nextTick();

    component.unmount();
    host.remove();
    return calls;
  }

  const compiled = await record(true);
  const legacy = await record(false);

  assert.deepStrictEqual(
    compiled,
    legacy,
    `lifecycle hooks diverged.\n  compiled: ${JSON.stringify(compiled)}\n  string:   ${JSON.stringify(legacy)}`,
  );
  assert.deepStrictEqual(
    compiled,
    ['beforeUpdate', 'update', 'beforeUpdate', 'update'],
    'both paths must fire each hook once per update, in order',
  );
}

/**
 * The one difference between the two paths, asserted rather than hidden.
 *
 * The string renderer rebuilds the whole template and diffs it, so an attribute
 * added to the live DOM from outside the framework is not in the new tree and
 * is removed. A compiled component only ever writes to its own bindings, so it
 * survives.
 *
 * Neither behaviour is a contract an application should rely on. It is here
 * because it is a real observable difference, and an undocumented difference
 * between two renderers is how a bug report becomes unreproducible.
 */
async function testKnownDifference() {
  console.log('🧪 Testing the one documented difference between the paths...');

  // `#other` carries a binding of its own, so it is not a static subtree and
  // the string renderer's diff really does visit it. Fingerprinting a static
  // subtree would prove nothing: the diff skips those on both paths.
  const source = `<state n="0" other="fixed" />\n<div><p id="live">{{ n }}</p><p id="other">{{ other }}</p></div>`;
  const ComponentClass = compileComponent(source, `ParityDiff${seq++}`);

  /**
   * Fingerprints a node from outside the framework and provokes an update.
   * @param {boolean} compiled - Whether to keep the program.
   * @returns {Promise<string|null>} The fingerprint after the update.
   */
  async function fingerprintSurvives(compiled) {
    const { host, component } = mount(ComponentClass, compiled);
    host.querySelector('#other').setAttribute('data-outside', 'set');
    component.state.n = 1;
    await component.$nextTick();
    const value = host.querySelector('#other').getAttribute('data-outside');
    component.unmount();
    host.remove();
    return value;
  }

  assert.strictEqual(
    await fingerprintSurvives(true),
    'set',
    'a compiled component writes only to its own bindings, so an outside edit survives',
  );
  assert.strictEqual(
    await fingerprintSurvives(false),
    null,
    'the string renderer diffs a rebuilt tree, so an outside edit is removed',
  );
}

/**
 * The compiled path leaves no framework bookkeeping in the document.
 *
 * The string renderer has to keep the directive attributes, because it rereads
 * them from the DOM on every patch. A program read them at build time, so
 * shipping them would be shipping instructions to an engine that is not
 * running -- and `data-ax-static` in particular is an instruction to a diff
 * that never happens.
 */
async function testBookkeepingIsConsumed() {
  console.log('🧪 Testing the compiled path leaves no bookkeeping in the DOM...');

  const source = `<state open="true" mods="active" n="0" />
<div><section data-ax-show="open"><p>body</p></section><i data-ax-class="mods">{{ n }}</i>
<ul><li>a</li><li>b</li></ul></div>`;
  const ComponentClass = compileComponent(source, `ParityBookkeeping${seq++}`);

  const compiled = mount(ComponentClass, true);
  const legacy = mount(ComponentClass, false);

  for (const attribute of ['data-ax-show', 'data-ax-class', 'data-ax-static']) {
    assert.ok(
      !compiled.host.innerHTML.includes(attribute),
      `a compiled component must not ship ${attribute}`,
    );
    assert.ok(
      legacy.host.innerHTML.includes(attribute),
      `the string renderer still needs ${attribute}, so this test is comparing something`,
    );
  }

  // The observable result is the same either way, which is the point.
  assert.strictEqual(
    compiled.host.querySelector('i').className,
    legacy.host.querySelector('i').className,
  );
  assert.strictEqual(
    compiled.host.querySelector('section').style.display,
    legacy.host.querySelector('section').style.display,
  );

  compiled.component.unmount();
  legacy.component.unmount();
  compiled.host.remove();
  legacy.host.remove();
}

await testTextParity();
await testAttributeParity();
await testComputedAndEventParity();
await testDirectiveParity();
await testStaticSubtreeParity();
await testFormControlParity();
await testLifecycleParity();
await testKnownDifference();
await testBookkeepingIsConsumed();

console.log('✅ Render path parity tests passed.');
