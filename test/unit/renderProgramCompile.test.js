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
import { compileTemplateProgram } from '../../lib/compiler/render/compileTemplate.js';
import { OpKind, PROGRAM_VERSION, isProgram } from '../../lib/compiler/render/program.js';

/**
 * Compiles a template and asserts it produced a program.
 * @param {string} template - The template source.
 * @returns {object} The program.
 */
function compiled(template) {
  const result = compileTemplateProgram(template);
  assert.ok(
    result.program,
    `expected a program, got fallback: ${result.fallback && result.fallback.reason} (${result.fallback && result.fallback.detail})`,
  );
  return result.program;
}

/**
 * Compiles a template and asserts it refused, returning the reason.
 * @param {string} template - The template source.
 * @returns {{reason: string, detail: string}} The fallback.
 */
function refused(template) {
  const result = compileTemplateProgram(template);
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

  assert.deepStrictEqual(program.ops[0], { k: OpKind.TEXT, t: 0, x: 'count' });
  assert.deepStrictEqual(program.ops[1], { k: OpKind.TEXT, t: 1, x: 'total' });

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
  assert.deepStrictEqual(program.ops[0], { k: OpKind.RAW, t: 0, x: 'body' });
}

/**
 * An attribute that is entirely one expression keeps the value's type, so the
 * runtime can still remove the attribute for null and toggle it for a boolean.
 */
function testWholeAttributeOps() {
  console.log('🧪 Testing whole-value attribute bindings...');

  const program = compiled('<a href="{{ url }}" title="{{ label }}">x</a>');

  assert.deepStrictEqual(program.ops[0], { k: OpKind.ATTR, e: 0, a: 'href', x: 'url' });
  assert.deepStrictEqual(program.ops[1], { k: OpKind.ATTR, e: 0, a: 'title', x: 'label' });

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
  assert.deepStrictEqual(program.ops[0], { k: OpKind.BOOL, e: 0, a: 'disabled', x: 'isBusy' });
  assert.deepStrictEqual(program.ops[1], { k: OpKind.BOOL, e: 0, a: 'checked', x: 'on' });
}

/**
 * An attribute mixing literals and expressions compiles to an ordered parts
 * list. This is the common case for `class`, because the CSS scoper has already
 * put a hashed class in the literal half.
 */
function testAttributePartsOps() {
  console.log('🧪 Testing mixed literal/expression attributes...');

  const program = compiled('<div class="avenx-ab12 card {{ kind }} {{ size }}-wide">x</div>');
  const op = program.ops[0];

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

  assert.deepStrictEqual(program.ops[0], { k: OpKind.SHOW, e: 0, x: 'open' });
  assert.deepStrictEqual(program.ops[1], { k: OpKind.CLASS, e: 1, x: 'cls' });
  assert.deepStrictEqual(program.ops[2], { k: OpKind.HTML, e: 2, x: 'body' });
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

  const cases = [
    ['a list', '<ul><template data-ax-for="items" data-ax-as="i"><li>x</li></template></ul>'],
    ['a child component', '<div data-avenx-comp="Child"></div>'],
    ['a dynamic component', '<div data-avenx-comp-dynamic="which"></div>'],
    ['a slot', '<div><slot></slot></div>'],
    ['a suspense boundary', '<div data-ax-suspense="true"></div>'],
    ['an error boundary', '<div data-ax-error-boundary="true"></div>'],
    ['a deadlock boundary', '<div data-ax-deadlock="true"></div>'],
    ['a defer block', '<div data-ax-defer="true"></div>'],
    ['a transition', '<div data-ax-transition="fade"></div>'],
    ['a template ref', '<div data-ax-ref="box"></div>'],
    ['form validation', '<input data-ax-validate="required" />'],
    ['a router view', '<div data-ax-router-view="true"></div>'],
    ['a dynamic attribute name', '<div :[name]="value"></div>'],
    ['an unresolved component tag', '<div><MyThing /></div>'],
    ['an interpolation in a comment', '<div><!-- {{ secret }} --></div>'],
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
 * A refusal must be reported before any partial program escapes.
 *
 * The walk stops at the first construct it cannot handle, which means ops
 * collected before that point describe only part of the template. Returning
 * them would be worse than returning nothing.
 */
function testRefusalDiscardsPartialWork() {
  console.log('🧪 Testing a refusal discards partial work...');

  const result = compileTemplateProgram('<div><p>{{ a }}</p><ul><template data-ax-for="x" data-ax-as="i"><li>y</li></template></ul></div>');
  assert.strictEqual(result.program, null, 'no program may escape a refusal');
  assert.ok(result.fallback.reason.includes('@for'), `expected the list reason, got: ${result.fallback.reason}`);
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
testRefusalDiscardsPartialWork();
testMarkerNumbering();
testEmptyTemplate();

console.log('✅ Render program compilation tests passed.');
