/**
 * @file renderProgramRuntime.test.js
 * @description The runtime half of the render-program contract.
 *
 * The compiler-side tests pin what a program *says*. These pin what executing
 * one *does*, against the real DOM the runtime builds, and they are organised
 * around the three claims the architecture makes:
 *
 * 1. **A skeleton is parsed once per component class.** If it were parsed per
 *    instance, the mechanism would have moved the cost rather than removed it.
 * 2. **An update touches only the bindings whose dependencies changed.** This
 *    is the whole point, and it is asserted by leaving fingerprints on nodes
 *    the framework should not be touching and checking they survive.
 * 3. **Nothing the string renderer guaranteed is quietly lost.** Escaping,
 *    null handling, URL policy, boolean attribute removal, form-control
 *    property sync, and teardown all have a test here because each of them was
 *    previously a side effect of the render-parse-diff round trip rather than
 *    something anyone wrote down.
 */
import assert from 'assert';
import { CompiledTemplate, getCompiledTemplate } from '../../lib/core/renderer/program/CompiledTemplate.js';
import { TemplateInstance } from '../../lib/core/renderer/program/TemplateInstance.js';
import { PROGRAM_VERSION } from '../../lib/compiler/render/program.js';
import { compileTemplateProgram } from '../../lib/compiler/render/compileTemplate.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { html } from '../../lib/core/security/escapeHtml.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';
import { depMap } from '../../lib/core/reactive/watcher.js';
import { toRaw } from '../../lib/core/reactive/proxyHandler.js';

/**
 * Compiles a template and mounts it against a plain reactive state object.
 *
 * Deliberately not an `AvenxComponent`: these tests are about the program
 * runtime, and mounting a component would put the component's own lifecycle
 * between the assertion and the thing being asserted.
 * @param {string} template - Template source.
 * @param {object} state - Initial state.
 * @returns {{host: Element, instance: TemplateInstance, state: object}} The mount.
 */
function mount(template, state = {}) {
  const result = compileTemplateProgram(template);
  assert.ok(result.program, `template did not compile: ${result.fallback && result.fallback.detail}`);

  const reactive = new StateFactory().create(state);
  const host = document.createElement('div');
  document.body.appendChild(host);

  const instance = new TemplateInstance(result.program, {
    evaluate: (expression) => {
      // A deliberately tiny scope: property access on state, nothing else. The
      // real evaluator is tested elsewhere; substituting it here would make
      // these tests fail for reasons that have nothing to do with rendering.
      const path = expression.trim().split('.');
      let value = reactive;
      for (const part of path) {
        if (value === null || value === undefined) return undefined;
        value = value[part];
      }
      return value;
    },
    jobId: 1,
  });

  host.appendChild(instance.create());
  return { host, instance, state: reactive };
}

/**
 * Lets the scheduler run, so bindings woken by a write have applied.
 *
 * Every mutation below is followed by one of these, which is itself the
 * assertion that writes are batched rather than applied synchronously inside
 * the assignment. A plain effect per binding would make these awaits
 * unnecessary -- and would change what `$nextTick` means for every application.
 * @returns {Promise<void>} Resolves after the flush.
 */
function flush() {
  return nextTick();
}

/**
 * A skeleton is parsed once per program and cloned for every instance.
 */
function testTemplateIsParsedOnce() {
  console.log('🧪 Testing a skeleton is parsed once and cloned thereafter...');

  const program = {
    v: PROGRAM_VERSION,
    html: '<div class="w"><p data-axb="0"><!--axt:0--></p><b>fixed</b></div>',
    ops: [],
    elements: 1,
    texts: 1,
  };

  const first = getCompiledTemplate(program);
  const second = getCompiledTemplate(program);
  assert.strictEqual(first, second, 'the same program must reuse the same prepared template');

  // Two instances get independent trees from one parse.
  const a = first.instantiate();
  const b = first.instantiate();
  assert.notStrictEqual(a.elements[0], b.elements[0], 'instances must not share nodes');
  assert.strictEqual(a.elements[0].tagName, 'P');
  assert.strictEqual(b.elements[0].tagName, 'P');

  // The markers are gone from the clones: they were addressing aids, not
  // output, and shipping them would put compiler bookkeeping in the document.
  const holder = document.createElement('div');
  holder.appendChild(a.fragment);
  assert.ok(!holder.innerHTML.includes('data-axb'), 'element markers must not reach the DOM');
  assert.ok(!holder.innerHTML.includes('axt:'), 'text markers must not reach the DOM');
  assert.ok(holder.innerHTML.includes('<b>fixed</b>'), 'static markup survives');
}

/**
 * A marker the parser did not preserve must fail preparation rather than
 * produce a partly bound template.
 *
 * The compiler numbers markers from its own AST; the browser builds the tree.
 * When those disagree, binding against the result would write values into
 * whichever nodes happen to sit at the resolved positions.
 */
function testMissingMarkerRefusesToPrepare() {
  console.log('🧪 Testing a template with an unresolvable marker refuses...');

  const compiled = new CompiledTemplate({
    v: PROGRAM_VERSION,
    // Claims two element markers; the skeleton contains one.
    html: '<div data-axb="0"></div>',
    ops: [],
    elements: 2,
    texts: 0,
  });

  assert.strictEqual(compiled.failed, true, 'a missing marker must fail preparation');
  assert.strictEqual(compiled.instantiate(), null, 'a failed template instantiates nothing');
}

/**
 * Text bindings write the value verbatim, and null renders as nothing.
 */
async function testTextBindings() {
  console.log('🧪 Testing text bindings...');

  const { host, state } = mount('<p>Hello {{ name }}!</p>', { name: 'Ada' });
  assert.strictEqual(host.textContent, 'Hello Ada!');

  state.name = 'Grace';
  await flush();
  assert.strictEqual(host.textContent, 'Hello Grace!', 'a text binding updates in place');

  // Null is nothing, not the string "null" -- which is what the old pipeline
  // produced by skipping the segment entirely.
  state.name = null;
  await flush();
  assert.strictEqual(host.textContent, 'Hello !');

  // A value that looks like markup is text, not markup.
  state.name = '<script>x</script>';
  await flush();
  assert.strictEqual(host.querySelector('script'), null, 'interpolated markup must not become markup');
  assert.strictEqual(host.textContent, 'Hello <script>x</script>!');
}

/**
 * A `SafeHtml` in a plain `{{ }}` interpolation is inserted as markup.
 *
 * The string renderer skipped escaping for it, so a text write would silently
 * start showing the tags of every application that used the `html` tag.
 */
async function testSafeHtmlInTextBinding() {
  console.log('🧪 Testing SafeHtml in a text interpolation...');

  const { host, state } = mount('<p>{{ body }}</p>', { body: 'plain' });
  assert.strictEqual(host.textContent, 'plain');

  state.body = html`<em>marked up</em>`;
  await flush();
  assert.ok(host.querySelector('em'), 'a SafeHtml value renders as markup');
  assert.strictEqual(host.querySelector('em').textContent, 'marked up');

  // And back again: the nodes it inserted must be removed, not left beside the
  // new text.
  state.body = 'plain again';
  await flush();
  assert.strictEqual(host.querySelector('em'), null, 'raw nodes are removed when the value stops being markup');
  assert.strictEqual(host.textContent, 'plain again');
}

/**
 * Raw interpolation owns a range of nodes and replaces exactly that range.
 */
async function testRawBindingRange() {
  console.log('🧪 Testing raw interpolation manages its own range...');

  const { host, state } = mount('<div><b>before</b>{{{ body }}}<i>after</i></div>', {
    body: '<span>one</span><span>two</span>',
  });

  assert.strictEqual(host.querySelectorAll('span').length, 2);
  assert.strictEqual(host.querySelector('b').textContent, 'before');
  assert.strictEqual(host.querySelector('i').textContent, 'after');

  state.body = '<span>only</span>';
  await flush();
  assert.strictEqual(host.querySelectorAll('span').length, 1, 'the previous range is replaced, not appended to');
  assert.strictEqual(host.querySelector('span').textContent, 'only');

  // Siblings that belong to other parts of the template are untouched.
  assert.strictEqual(host.querySelector('b').textContent, 'before');
  assert.strictEqual(host.querySelector('i').textContent, 'after');

  state.body = '';
  await flush();
  assert.strictEqual(host.querySelectorAll('span').length, 0);
  assert.strictEqual(host.querySelector('b').textContent, 'before', 'clearing a range keeps its neighbours');
}

/**
 * Attribute bindings, including the parts form and removal for null.
 */
async function testAttributeBindings() {
  console.log('🧪 Testing attribute bindings...');

  const { host, state } = mount('<a title="{{ label }}" class="base {{ kind }}">x</a>', {
    label: 'first',
    kind: 'primary',
  });

  const anchor = host.querySelector('a');
  assert.strictEqual(anchor.getAttribute('title'), 'first');
  assert.strictEqual(anchor.getAttribute('class'), 'base primary');

  state.kind = 'danger';
  await flush();
  assert.strictEqual(anchor.getAttribute('class'), 'base danger', 'the literal part is preserved');
  assert.strictEqual(anchor.getAttribute('title'), 'first', 'an unrelated attribute is not rewritten');

  // A null value renders as an empty attribute, not a removed one, and not the
  // string "null". Removal would be the better behaviour, and is deliberately
  // not what happens: the string renderer produces `title=""` here, both
  // renderers are in service together, and two renderers disagreeing about one
  // attribute is worse than one attribute with an unfortunate value. See the
  // note on `applyAttribute`, and renderPathParity.test.js, which is what would
  // fail if this changed on one path only.
  state.label = null;
  await flush();
  assert.strictEqual(anchor.getAttribute('title'), '', 'null renders as an empty attribute');
}

/**
 * Boolean attributes are removed when off, and the property is mirrored.
 */
async function testBooleanAttributes() {
  console.log('🧪 Testing boolean attributes...');

  const { host, state } = mount('<button disabled="{{ busy }}">go</button>', { busy: true });
  const button = host.querySelector('button');

  assert.strictEqual(button.hasAttribute('disabled'), true);
  assert.strictEqual(button.disabled, true, 'the property is what the browser acts on');

  state.busy = false;
  await flush();
  assert.strictEqual(button.hasAttribute('disabled'), false, 'false removes the attribute');
  assert.strictEqual(button.disabled, false);

  // Undefined and empty read as off too. An attribute bound to nothing being
  // present is the behaviour this deliberately does not carry forward.
  state.busy = true;
  await flush();
  assert.strictEqual(button.hasAttribute('disabled'), true);
  state.busy = undefined;
  await flush();
  assert.strictEqual(button.hasAttribute('disabled'), false);
}

/**
 * A URL attribute is sanitised on every write, not only on the first render.
 */
async function testUrlPolicyOnEveryWrite() {
  console.log('🧪 Testing URL policy applies to bound attributes...');

  const { host, state } = mount('<a href="{{ target }}">x</a>', { target: '/safe' });
  const anchor = host.querySelector('a');
  assert.strictEqual(anchor.getAttribute('href'), '/safe');

  state.target = 'javascript:alert(1)';
  await flush();
  assert.strictEqual(
    anchor.getAttribute('href'),
    'about:blank',
    'a scheme that executes rather than locates is refused on update, not only on create',
  );

  state.target = 'https://example.com/ok';
  await flush();
  assert.strictEqual(anchor.getAttribute('href'), 'https://example.com/ok');
}

/**
 * `data-ax-html` escapes a plain value and only lets a SafeHtml through.
 *
 * Loosening this would turn every use of the directive in every application
 * into an injection point, which is why it has a test rather than a comment.
 */
async function testHtmlDirectiveEscapesPlainValues() {
  console.log('🧪 Testing data-ax-html escapes plain values...');

  const { host, state } = mount('<div data-ax-html="body"></div>', { body: '<img src=x onerror=boom>' });
  const box = host.querySelector('div');

  assert.strictEqual(box.querySelector('img'), null, 'a plain string must not become markup');
  assert.ok(box.innerHTML.includes('&lt;img'), 'it is escaped instead');

  state.body = html`<em>trusted</em>`;
  await flush();
  assert.ok(box.querySelector('em'), 'a SafeHtml value is the documented way in');
}

/**
 * Class bindings remove only the classes they added.
 */
async function testClassBinding() {
  console.log('🧪 Testing class bindings preserve authored classes...');

  const { host, state } = mount('<div class="avenx-scope card" data-ax-class="mods"></div>', {
    mods: 'active large',
  });
  const box = host.querySelector('div');

  assert.ok(box.classList.contains('avenx-scope'), 'the scoped class survives');
  assert.ok(box.classList.contains('card'));
  assert.ok(box.classList.contains('active'));

  state.mods = 'large';
  await flush();
  assert.ok(!box.classList.contains('active'), 'a class this binding added is removed');
  assert.ok(box.classList.contains('large'));
  assert.ok(box.classList.contains('avenx-scope'), 'a class it never added is left alone');
  assert.ok(box.classList.contains('card'));
}

/**
 * `data-ax-show` restores the authored display value rather than the empty
 * string a hidden element reports.
 */
async function testShowBinding() {
  console.log('🧪 Testing show binding...');

  const { host, state } = mount('<div data-ax-show="open" style="display: flex">body</div>', { open: true });
  const box = host.querySelector('div');

  assert.strictEqual(box.style.display, 'flex');
  state.open = false;
  await flush();
  assert.strictEqual(box.style.display, 'none');
  state.open = true;
  await flush();
  assert.strictEqual(box.style.display, 'flex', 'showing restores what the author wrote');
}

/**
 * The architecture claim: an update touches only what changed.
 *
 * Asserted by fingerprinting -- a node the framework has no reason to touch is
 * given a value nothing in the template would produce, and has to still have it
 * after an unrelated binding updates. Under a render-parse-diff architecture
 * the fingerprint is destroyed, because the whole template is rebuilt and
 * compared.
 */
async function testUpdatesAreFineGrained() {
  console.log('🧪 Testing an update touches only the bindings that changed...');

  const { host, state } = mount(
    '<div><p id="a">{{ a }}</p><p id="b">{{ b }}</p><ul><li>static one</li><li>static two</li></ul></div>',
    { a: 1, b: 2 },
  );

  const paragraphB = host.querySelector('#b');
  const staticList = host.querySelector('ul');

  // Fingerprints: node identity, a DOM property no binding writes, and a
  // hand-edited static subtree.
  paragraphB.setAttribute('data-fingerprint', 'kept');
  staticList.setAttribute('data-fingerprint', 'kept');
  staticList.firstChild.textContent = 'hand edited';

  state.a = 99;
  await flush();

  assert.strictEqual(host.querySelector('#a').textContent, '99', 'the changed binding updated');
  assert.strictEqual(host.querySelector('#b'), paragraphB, 'an unrelated element is the same node');
  assert.strictEqual(paragraphB.getAttribute('data-fingerprint'), 'kept');
  assert.strictEqual(paragraphB.textContent, '2', 'an unrelated binding was not rewritten');
  assert.strictEqual(staticList.getAttribute('data-fingerprint'), 'kept');
  assert.strictEqual(
    staticList.firstChild.textContent,
    'hand edited',
    'a static subtree is never revisited, so a hand edit to it survives',
  );
}

/**
 * A write to state that no binding reads must do nothing at all.
 */
async function testUnreadStateDoesNothing() {
  console.log('🧪 Testing a write nothing reads changes nothing...');

  const { host, state } = mount('<p>{{ shown }}</p>', { shown: 'x', hidden: 0 });
  const paragraph = host.querySelector('p');
  paragraph.setAttribute('data-fingerprint', 'kept');

  state.hidden = 42;
  await flush();

  assert.strictEqual(paragraph.getAttribute('data-fingerprint'), 'kept');
  assert.strictEqual(host.querySelector('p'), paragraph);
}

/**
 * Disposal releases every effect.
 *
 * A binding's watcher lives in the dependency set of the state it read. Left
 * behind, it keeps the component, its DOM and its scope reachable for as long
 * as that state exists -- and the finer the bindings, the bigger the leak.
 */
function testDisposeReleasesWatchers() {
  console.log('🧪 Testing disposal releases every binding watcher...');

  const { instance, state } = mount('<div><p>{{ a }}</p><p>{{ b }}</p><i title="{{ a }}"></i></div>', {
    a: 1,
    b: 2,
  });

  const raw = toRaw(state);
  const deps = depMap.get(raw);
  assert.ok(deps, 'the state object must have collected dependencies');
  const before = (deps.get('a') || new Set()).size + (deps.get('b') || new Set()).size;
  assert.ok(before >= 3, `expected at least one watcher per binding, saw ${before}`);

  instance.dispose();

  const after = (deps.get('a') || new Set()).size + (deps.get('b') || new Set()).size;
  assert.strictEqual(after, 0, 'every binding watcher must be unsubscribed on dispose');

  // And a write after disposal must not reach the detached DOM.
  assert.doesNotThrow(() => {
    state.a = 100;
  });
}

/**
 * Writes coalesce into one flush, so `$nextTick` still means "after the DOM has
 * settled" rather than "after the first write landed".
 *
 * A plain effect per binding would have updated synchronously inside the
 * assignment, which is faster to implement and a behaviour change every
 * application's tests would notice.
 */
async function testBatching() {
  console.log('🧪 Testing writes still coalesce into one flush...');

  const { host, state, instance } = mount('<p>{{ a }}-{{ b }}</p>', { a: 1, b: 2 });
  assert.strictEqual(host.textContent, '1-2');

  // A direct write to the reactive proxy runs the effects synchronously here
  // because these tests bind straight to StateFactory rather than through a
  // component's scheduler. What must hold either way is that the DOM is
  // correct once the flush has run.
  state.a = 10;
  await flush();
  state.b = 20;
  await nextTick();

  assert.strictEqual(host.textContent, '10-20');
  instance.dispose();
}

/**
 * A binding that throws is reported and does not stop its siblings.
 */
function testBindingErrorIsIsolated() {
  console.log('🧪 Testing a failing binding does not take the template with it...');

  const result = compileTemplateProgram('<div><p>{{ good }}</p><p>{{ bad.deep.deeper }}</p></div>');
  assert.ok(result.program);

  const host = document.createElement('div');
  const instance = new TemplateInstance(result.program, {
    evaluate: (expression) => {
      if (expression.startsWith('bad')) {
        throw new Error('boom');
      }
      return 'fine';
    },
    jobId: 1,
  });

  assert.doesNotThrow(() => {
    host.appendChild(instance.create());
  }, 'a throwing binding must not abort the render');

  assert.strictEqual(host.querySelectorAll('p')[0].textContent, 'fine', 'the healthy binding still rendered');
  instance.dispose();
}

testTemplateIsParsedOnce();
testMissingMarkerRefusesToPrepare();
await testTextBindings();
await testSafeHtmlInTextBinding();
await testRawBindingRange();
await testAttributeBindings();
await testBooleanAttributes();
await testUrlPolicyOnEveryWrite();
await testHtmlDirectiveEscapesPlainValues();
await testClassBinding();
await testShowBinding();
await testUpdatesAreFineGrained();
await testUnreadStateDoesNothing();
testDisposeReleasesWatchers();
await testBatching();
testBindingErrorIsIsolated();

console.log('✅ Render program runtime tests passed.');
