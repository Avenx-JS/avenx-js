/**
 * @file renderProgramCompile.test.js
 * @description The compiler half of the render-program contract.
 *
 * These tests pin two things, and the second matters more than the first.
 *
 * 1. That a template the program runtime can execute compiles to the ops the
 *    runtime expects — the right kind, the right expression, the right target.
 * 2. That a template it *cannot* execute refuses to compile, with a reason.
 *
 * The second is the safety property the whole design rests on. A program is
 * all-or-nothing per template: if the compiler ever emitted a program for a
 * template containing something the runtime silently ignores, that construct
 * would stop working with no diagnostic anywhere. So every construct that
 * belongs to the string renderer has a test asserting the compiler declines it.
 */
import assert from 'assert';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import { OpKind, PROGRAM_VERSION, isProgram } from '../../lib/compiler/render/program.js';

/**
 * Compiles a template through the IR and the lowering pass.
 *
 * These tests predate the IR, when a single `compileTemplateProgram` read
 * already-rewritten markup. They are kept rather than replaced because what
 * they assert -- which op each construct produces, what the skeleton keeps,
 * what the compiler refuses -- is still exactly the contract. Only the route
 * to the program changed.
 * @param {string} template - The template source.
 * @returns {{program: object|null, expressions: string[], fallback: object|null}}
 *   The program and its interned sources, or the reason it was refused.
 */
function compileProgram(template) {
  const built = buildTemplateIR(template, {});
  if (built.refusal) return { program: null, fallback: built.refusal };
  const lowered = lowerToProgram(built.ir, {});
  if (lowered.refusal) return { program: null, fallback: lowered.refusal };
  return { program: lowered.program, expressions: lowered.expressions, fallback: null };
}

/**
 * Compiles a template and asserts it produced a program.
 * @param {string} template - The template source.
 * @returns {object} The program.
 */
function compiled(template) {
  const result = compileProgram(template);
  assert.ok(
    result.program,
    `expected a program, got fallback: ${result.fallback && result.fallback.reason} (${result.fallback && result.fallback.detail})`,
  );
  programSources.set(result.program, result.expressions);
  return result.program;
}

/**
 * The interned expression sources for each compiled program.
 * @type {WeakMap<object, string[]>}
 */
const programSources = new WeakMap();

/**
 * A program's ops with their expression indices resolved back to source.
 *
 * Ops address expressions by index, which is the point of the format and is
 * asserted directly in irLowering.test.js. These tests are about *which op*
 * each construct produces, and reading `x: 'count'` says that far better than
 * `x: 0` -- so the index is resolved here rather than spelled out in every
 * assertion.
 * @param {object} program - A compiled program.
 * @returns {object[]} The ops, in source terms.
 */
function ops(program) {
  const sources = programSources.get(program) || [];
  /**
   * @param {any} part - An attribute part.
   * @returns {any} The part in source terms.
   */
  const readablePart = (part) => (typeof part === 'string' ? part : { x: sources[part.x] });

  return program.ops.map((op) => {
    const out = { ...op };
    if (typeof out.x === 'number') out.x = sources[out.x];
    if (Array.isArray(out.p)) out.p = out.p.map(readablePart);
    return out;
  });
}

/**
 * Compiles a template and asserts it refused, returning the reason.
 * @param {string} template - The template source.
 * @returns {{reason: string, detail: string}} The fallback.
 */
function refused(template) {
  const result = compileProgram(template);
  assert.strictEqual(result.program, null, `expected a fallback, got a program for: ${template}`);
  assert.ok(result.fallback, 'a refusal must carry a reason');
  return result.fallback;
}

/**
 * Text interpolation becomes one text op per expression, and the skeleton keeps
 * the literal text around it.
 */
function testTextOps() {
  console.log('🧪 Testing text interpolation compiles to text ops...');

  const program = compiled('<p>Count: {{ count }} of {{ total }}</p>');

  assert.strictEqual(program.v, PROGRAM_VERSION);
  assert.ok(isProgram(program), 'the emitted program must satisfy isProgram');
  assert.strictEqual(program.ops.length, 2);
  assert.strictEqual(program.texts, 2);

  assert.deepStrictEqual(ops(program)[0], { k: OpKind.TEXT, t: 0, x: 'count' });
  assert.deepStrictEqual(ops(program)[1], { k: OpKind.TEXT, t: 1, x: 'total' });

  // The literal text survives verbatim, and each expression leaves a marker in
  // its place so the runtime can address exactly that position.
  assert.strictEqual(program.html, '<p>Count: <!--axt:0--> of <!--axt:1--></p>');
  assert.ok(!program.html.includes('{{'), 'the skeleton must carry no interpolations');
}

/**
 * Triple-brace interpolation compiles to a raw op, which is a different opcode
 * rather than a flag: escaping and not escaping are different operations and
 * conflating them is how an escaping bug becomes an XSS.
 */
function testRawOps() {
  console.log('🧪 Testing raw interpolation compiles to a distinct op...');

  const program = compiled('<div>{{{ body }}}</div>');
  assert.deepStrictEqual(ops(program)[0], { k: OpKind.RAW, t: 0, x: 'body' });
}

/**
 * An attribute that is entirely one expression keeps the value's type, so the
 * runtime can still remove the attribute for null and toggle it for a boolean.
 */
function testWholeAttributeOps() {
  console.log('🧪 Testing whole-value attribute bindings...');

  const program = compiled('<a href="{{ url }}" title="{{ label }}">x</a>');

  assert.deepStrictEqual(ops(program)[0], { k: OpKind.ATTR, e: 0, a: 'href', x: 'url' });
  assert.deepStrictEqual(ops(program)[1], { k: OpKind.ATTR, e: 0, a: 'title', x: 'label' });

  // Both ops address the same element, so the element is marked exactly once.
  assert.strictEqual(program.elements, 1);
  assert.strictEqual(program.html, '<a data-axb="0">x</a>');
  assert.ok(!program.html.includes('href'), 'a bound attribute leaves the skeleton');
}

/**
 * A boolean attribute gets its own opcode. `disabled="false"` has to remove the
 * attribute rather than set it to the string "false", which a generic attribute
 * write cannot do.
 */
function testBooleanAttributeOps() {
  console.log('🧪 Testing boolean attributes compile to bool ops...');

  const program = compiled('<button disabled="{{ isBusy }}" checked="{{ on }}">x</button>');
  assert.deepStrictEqual(ops(program)[0], { k: OpKind.BOOL, e: 0, a: 'disabled', x: 'isBusy' });
  assert.deepStrictEqual(ops(program)[1], { k: OpKind.BOOL, e: 0, a: 'checked', x: 'on' });
}

/**
 * An attribute mixing literals and expressions compiles to an ordered parts
 * list. This is the common case for `class`, because the CSS scoper has already
 * put a hashed class in the literal half.
 */
function testAttributePartsOps() {
  console.log('🧪 Testing mixed literal/expression attributes...');

  const program = compiled('<div class="avenx-ab12 card {{ kind }} {{ size }}-wide">x</div>');
  const op = ops(program)[0];

  assert.strictEqual(op.k, OpKind.ATTR_PARTS);
  assert.strictEqual(op.a, 'class');
  assert.deepStrictEqual(op.p, ['avenx-ab12 card ', { x: 'kind' }, ' ', { x: 'size' }, '-wide']);
}

/**
 * The three directive attributes the program runtime implements each become one
 * op and leave the skeleton, because nothing at runtime needs to read them back.
 */
function testDirectiveOps() {
  console.log('🧪 Testing show/class/html directives...');

  const program = compiled(
    '<div><span data-ax-show="open">a</span><i data-ax-class="cls"></i><em data-ax-html="body"></em></div>',
  );

  assert.deepStrictEqual(ops(program)[0], { k: OpKind.SHOW, e: 0, x: 'open' });
  assert.deepStrictEqual(ops(program)[1], { k: OpKind.CLASS, e: 1, x: 'cls' });
  assert.deepStrictEqual(ops(program)[2], { k: OpKind.HTML, e: 2, x: 'body' });
  assert.ok(!program.html.includes('data-ax-show'), 'a consumed directive leaves the skeleton');
}

/**
 * Event handlers deliberately produce no ops.
 *
 * Events are delegated from the component root and read `data-ax-event` off the
 * DOM when one fires, so the attribute has to survive into the skeleton and
 * there is nothing for a per-binding effect to do. Compiling them into ops
 * would mean two mechanisms binding the same handler.
 */
function testEventsAreNotOps() {
  console.log('🧪 Testing event attributes survive into the skeleton...');

  const program = compiled('<button data-ax-event="{&quot;click&quot;:&quot;inc()&quot;}">+</button>');
  assert.strictEqual(program.ops.length, 0, 'events produce no ops');
  assert.ok(program.html.includes('data-ax-event'), 'the delegation attribute must survive');
}

/**
 * A subtree the compiler proved static is emitted whole and never descended
 * into, and its marker attribute is dropped.
 *
 * `data-ax-static` exists to tell the tree diff which subtrees to skip. A
 * program never diffs, so shipping the hint would be shipping an instruction to
 * an engine that is not running.
 */
function testStaticSubtrees() {
  console.log('🧪 Testing static subtrees cost nothing...');

  const program = compiled('<div><p>{{ live }}</p><ul data-ax-static="true"><li>a</li><li>b</li></ul></div>');

  assert.strictEqual(program.ops.length, 1, 'only the live binding produces an op');
  assert.strictEqual(program.elements, 0, 'a static subtree needs no element marker');
  assert.ok(!program.html.includes('data-ax-static'), 'the hint is dropped from the skeleton');
  assert.ok(program.html.includes('<li>a</li><li>b</li>'), 'the static markup is preserved verbatim');
}

/**
 * Every construct that belongs to the string renderer must refuse to compile.
 *
 * This is the test that keeps the all-or-nothing rule honest. If a construct is
 * ever added to the program runtime, its row moves out of this list and into a
 * positive test — which is a visible change in a diff, unlike a construct that
 * quietly starts being ignored.
 */
function testRefusals() {
  console.log('🧪 Testing constructs that must fall back...');

  // Written in the syntax an author writes, not in the rewritten markup the
  // previous compiler read. Lists, slots, components and `<@defer>` have left
  // this table because they lower now; what remains is what the IR still does
  // not model, and each entry is a construct with a named reason rather than a
  // catch-all.
  const cases = [
    ['a dynamic component', '<div data-avenx-comp-dynamic="which"></div>'],
    ['a suspense boundary', '<@suspense><p>x</p></@suspense>'],
    ['an error boundary', '<@errorBoundary><p>x</p></@errorBoundary>'],
    ['a deadlock boundary', '<@deadlock name="d"><p>x</p></@deadlock>'],
    ['a transition', '<transition name="fade"><p>x</p></transition>'],
    ['a template ref', '<div data-ax-ref="box"></div>'],
    ['form validation', '<input data-ax-validate="required" />'],
    ['a router view', '<div data-ax-router-view="true"></div>'],
    ['a dynamic attribute name', '<div :[name]="value"></div>'],
    ['an interpolation in a comment', '<div><!-- {{ secret }} --></div>'],
    ['an unrecognised directive', '<@nonsense><p>x</p></@nonsense>'],
  ];

  for (const [label, template] of cases) {
    const fallback = refused(template);
    assert.ok(
      typeof fallback.reason === 'string' && fallback.reason.length > 0,
      `${label} must report a reason`,
    );
    assert.ok(
      typeof fallback.detail === 'string' && fallback.detail.length > 0,
      `${label} must report what caused it`,
    );
  }
}

/**
 * A static child component compiles, and each of its props becomes its own op.
 *
 * This is the case that matters most in practice: before it was supported,
 * essentially every page in a real application fell back, because a page whose
 * whole job is composing components contains at least one component tag.
 *
 * A *dynamic* component tag still refuses. Its class can change between
 * renders, which means unmounting one instance and mounting another -- a
 * lifecycle decision the program does not own.
 */
function testChildComponentProps() {
  console.log('🧪 Testing child component props compile to prop ops...');

  // Written as the author writes it. The previous compiler read the rewritten
  // `<div data-avenx-comp="StatCard" data-props-label="title">` form, because
  // component tags had already been turned into markup by the time it ran.
  const program = compiled(
    '<main><h1>{{ title }}</h1>' +
      '<StatCard :label="title" :value="revenue"><span>{{ note }}</span></StatCard></main>',
  );

  const props = ops(program).filter((op) => op.k === OpKind.PROP);
  assert.deepStrictEqual(props, [
    { k: OpKind.PROP, e: 0, n: 'label', x: 'title' },
    { k: OpKind.PROP, e: 0, n: 'value', x: 'revenue' },
  ]);

  // The mount marker survives: the page finds child mount points by querying
  // for it, and removing it would leave the child unmounted.
  assert.ok(program.html.includes('data-avenx-comp="StatCard"'), 'the mount marker must survive');

  // The prop attributes do not: two mechanisms driving one prop is how they
  // come to disagree.
  assert.ok(!program.html.includes('data-props-'), 'prop attributes leave the skeleton');

  // Transcluded content is compiled in the *parent's* scope, because that is
  // where its expressions are evaluated -- the child only moves the nodes.
  const texts = ops(program).filter((op) => op.k === OpKind.TEXT);
  assert.deepStrictEqual(
    texts.map((op) => op.x),
    ['title', 'note'],
  );
}

/**
 * A refusal must be reported before any partial program escapes.
 *
 * The walk stops at the first construct it cannot handle, which means ops
 * collected before that point describe only part of the template. Returning
 * them would be worse than returning nothing.
 */
function testRefusalDiscardsPartialWork() {
  console.log('🧪 Testing a refusal discards partial work...');

  const result = compileProgram('<div><p>{{ a }}</p><@suspense><p>{{ b }}</p></@suspense></div>');
  assert.strictEqual(result.program, null, 'no program may escape a refusal');
  assert.ok(
    result.fallback.reason.includes('suspense'),
    `expected the suspense reason, got: ${result.fallback.reason}`,
  );
}

/**
 * Marker ids are dense and start at zero, because the runtime indexes arrays
 * with them rather than looking them up in a map.
 */
function testMarkerNumbering() {
  console.log('🧪 Testing marker numbering is dense and zero-based...');

  const program = compiled(
    '<div title="{{ a }}"><span>{{ b }}</span><i class="x {{ c }}">{{ d }}</i></div>',
  );

  const textIds = program.ops.filter((op) => op.t !== undefined).map((op) => op.t);
  const elementIds = [...new Set(program.ops.filter((op) => op.e !== undefined).map((op) => op.e))];

  assert.deepStrictEqual(textIds, [0, 1], 'text markers number from zero in document order');
  assert.deepStrictEqual(elementIds, [0, 1], 'element markers number from zero in document order');
  assert.strictEqual(program.texts, 2);
  assert.strictEqual(program.elements, 2);
}

/**
 * An empty or whitespace-only template has no program, and says so rather than
 * emitting an empty one that would render nothing.
 */
function testEmptyTemplate() {
  console.log('🧪 Testing an empty template refuses...');
  refused('');
  refused('   \n  ');
}

testTextOps();
testRawOps();
testWholeAttributeOps();
testBooleanAttributeOps();
testAttributePartsOps();
testDirectiveOps();
testEventsAreNotOps();
testStaticSubtrees();
testRefusals();
testChildComponentProps();
testRefusalDiscardsPartialWork();
testMarkerNumbering();
testEmptyTemplate();

console.log('✅ Render program compilation tests passed.');
