/**
 * @file templateIr.test.js
 * @description The template IR builder: what it represents, and what it refuses.
 *
 * These tests exist to pin the property the IR was introduced for -- that a
 * construct's meaning is recorded once, at the front of the compiler, rather
 * than encoded into markup and rediscovered later. A test that asserts
 * `<@for>` produces a ForNode with a list expression and a binding name is
 * asserting exactly that.
 */
import assert from 'assert';
import { buildTemplateIR, parseForHeader } from '../../lib/compiler/ir/build.js';
import { IRKind, RefusalReason, walkIR } from '../../lib/compiler/ir/nodes.js';

/**
 * Builds IR and fails the test with the refusal if there was one.
 * @param {string} template - The template source.
 * @returns {object} The root fragment.
 */
function ir(template) {
  const built = buildTemplateIR(template, {});
  assert.strictEqual(built.refusal, null, `unexpected refusal: ${JSON.stringify(built.refusal)}`);
  return built.ir;
}

/**
 * Builds IR expecting a refusal.
 * @param {string} template - The template source.
 * @returns {{reason: string, detail: string}} The refusal.
 */
function refusal(template) {
  const built = buildTemplateIR(template, {});
  assert.ok(built.refusal, 'expected a refusal');
  assert.strictEqual(built.ir, null, 'a refused template must not also produce IR');
  return built.refusal;
}

/**
 * Finds the first node of a kind anywhere in a tree.
 * @param {object} root - The root node.
 * @param {string} kind - An {@link IRKind}.
 * @returns {object|null} The node.
 */
function find(root, kind) {
  let found = null;
  walkIR(root, (node) => {
    if (!found && node.kind === kind) found = node;
  });
  return found;
}

function testTextAndInterpolation() {
  console.log('🧪 text and interpolation');
  const root = ir('<p>Hello {{ name }}, you have {{{ badge }}}!</p>');
  const p = root.children[0];
  assert.strictEqual(p.kind, IRKind.ELEMENT);
  assert.deepStrictEqual(
    p.children.map((c) => c.kind),
    [IRKind.TEXT, IRKind.INTERPOLATION, IRKind.TEXT, IRKind.INTERPOLATION, IRKind.TEXT],
  );
  assert.strictEqual(p.children[1].expr, 'name');
  assert.strictEqual(p.children[1].raw, false);
  assert.strictEqual(p.children[3].raw, true, 'triple braces are raw');
  console.log('  ✅ interpolations become nodes, not markers in a string');
}

function testAttributeBindings() {
  console.log('🧪 attribute bindings');
  const root = ir('<a href="/u/{{ id }}" title="{{ label }}" disabled="{{ off }}" class="s">x</a>');
  const a = root.children[0];
  assert.deepStrictEqual(a.attrs, { class: 's' }, 'static attributes stay static');

  const byName = Object.fromEntries(a.bindings.map((b) => [b.name, b]));
  assert.strictEqual(byName.title.type, 'attr', 'a whole-value expression keeps its type');
  assert.strictEqual(byName.disabled.type, 'bool', 'a boolean attribute is recognised');
  assert.strictEqual(byName.href.type, 'attrParts', 'a mixed value becomes parts');
  assert.deepStrictEqual(byName.href.parts, ['/u/', { expr: 'id' }]);
  console.log('  ✅ attribute forms are distinguished at build time');
}

function testEvents() {
  console.log('🧪 events and modifiers');
  const root = ir('<button @click.prevent.stop="save()" @keydown="k()">go</button>');
  const button = root.children[0];
  assert.strictEqual(button.events.length, 2);
  const click = button.events.find((e) => e.event === 'click');
  assert.deepStrictEqual(click.modifiers, ['prevent', 'stop']);
  assert.strictEqual(click.expr, 'save()');
  console.log('  ✅ handler and modifiers are parsed, not re-encoded as JSON in an attribute');
}

function testConditional() {
  console.log('🧪 <@if> / <@elseif> / <@else>');
  const root = ir(
    '<div><@if a><b>A</b><@elseif b><i>B</i><@else><u>C</u></@if><p>after</p></div>',
  );
  const div = root.children[0];
  const branchNode = div.children.find((c) => c.kind === IRKind.IF);
  assert.ok(branchNode, 'the chain is one node');
  assert.deepStrictEqual(
    branchNode.branches.map((b) => b.test),
    ['a', 'b', null],
    'branches are ordered and <@else> has no test',
  );
  assert.strictEqual(branchNode.branches[0].body.kind, IRKind.FRAGMENT);

  const after = div.children[div.children.length - 1];
  assert.strictEqual(after.tag, 'p', '</@if> ends the chain, so siblings stay siblings');
  console.log('  ✅ a chain is one ordered node, not a three-deep nest');
}

function testConditionalNesting() {
  console.log('🧪 nested control flow');
  const root = ir('<@if a><@for x in xs><@if (x > 1)><b>{{ x }}</b></@if></@for></@if>');
  const outer = root.children[0];
  assert.strictEqual(outer.kind, IRKind.IF);
  const loop = find(outer, IRKind.FOR);
  assert.ok(loop, 'a loop inside a branch is represented');
  const inner = find(loop.body, IRKind.IF);
  assert.ok(inner, 'a branch inside a loop body is represented');
  assert.strictEqual(inner.branches[0].test, '(x > 1)');
  console.log('  ✅ control flow nests arbitrarily');
}

function testIteration() {
  console.log('🧪 <@for>');
  const root = ir('<ul><@for row in rows key="row.id"><li>{{ row.n }}</li><@empty><li>none</li></@for></ul>');
  const loop = find(root, IRKind.FOR);
  assert.strictEqual(loop.list, 'rows');
  assert.strictEqual(loop.item, 'row');
  assert.strictEqual(loop.destructure, null);
  assert.strictEqual(loop.key, 'row.id');
  assert.strictEqual(loop.body.kind, IRKind.FRAGMENT);
  assert.ok(loop.empty, 'the <@empty> block is its own fragment');
  console.log('  ✅ a loop records its list, binding and key');
}

function testIterationDestructuring() {
  console.log('🧪 <@for> destructuring an element');
  // `[a, b] in pairs` destructures each *element*, which is an array. It does
  // not mean `(item, index)`, and preserving that is why the IR keeps the two
  // forms apart instead of normalising them.
  const loop = find(ir('<@for [name, count] in pairs><p>{{ name }}</p></@for>'), IRKind.FOR);
  assert.strictEqual(loop.item, null);
  assert.deepStrictEqual(loop.destructure, ['name', 'count']);

  const plain = find(ir('<@for row in rows><p>{{ row }}</p></@for>'), IRKind.FOR);
  assert.strictEqual(plain.item, 'row');
  assert.strictEqual(plain.destructure, null);
  console.log('  ✅ the two binding forms stay distinct');
}

function testIterationHeaderWithComparison() {
  console.log('🧪 <@for> over an expression containing ">"');
  // The defect this whole layer was introduced to remove: the old rewrite
  // truncated the list expression at the first `>` and reported the remainder
  // as a malformed template expression.
  const loop = find(
    ir('<@for r in rows.filter(x => x.score > 90) key="r.id"><li>{{ r.n }}</li></@for>'),
    IRKind.FOR,
  );
  assert.strictEqual(loop.list, 'rows.filter(x => x.score > 90)', 'the whole expression survives');
  assert.strictEqual(loop.key, 'r.id');
  console.log('  ✅ a comparison inside the list expression no longer ends the tag');
}

function testForHeaderParsing() {
  console.log('🧪 <@for> header parsing in isolation');
  assert.deepStrictEqual(parseForHeader('a in b'), { item: 'a', destructure: null, list: 'b', key: null });
  assert.deepStrictEqual(parseForHeader('[a, i] in b key="a.id"'), {
    item: null,
    destructure: ['a', 'i'],
    list: 'b',
    key: 'a.id',
  });
  // `in` inside a call is not the loop's `in`.
  assert.strictEqual(parseForHeader('k in Object.keys(m)').list, 'Object.keys(m)');
  assert.throws(() => parseForHeader('rows'), /no "in" clause/);
  assert.throws(() => parseForHeader('a.b in rows'), /does not bind a name/);
  console.log('  ✅ headers parse structurally rather than by shape matching');
}

function testAmbiguousConditionalHeader() {
  console.log('🧪 an ambiguous <@if> header is refused, not guessed');
  const r = refusal('<div><@if count > 3><b>many</b></@if></div>');
  assert.strictEqual(r.reason, RefusalReason.MALFORMED);
  assert.match(r.detail, /was cut at a ">"/);
  assert.match(r.detail, /\(count > 3\)/, 'the message shows the form that works');
  console.log('  ✅ the compiler refuses rather than testing the wrong condition');
}

function testComponentsAndSlots() {
  console.log('🧪 components and slots');
  const root = ir('<Card :title="h" flat="1"><slot name="body"><p>empty</p></slot></Card>');
  const card = root.children[0];
  assert.strictEqual(card.kind, IRKind.COMPONENT);
  assert.strictEqual(card.name, 'Card');
  const props = Object.fromEntries(card.props.map((p) => [p.name, p]));
  assert.strictEqual(props.title.kind, 'bound');
  assert.strictEqual(props.flat.kind, 'static');

  const outlet = find(card, IRKind.SLOT);
  assert.strictEqual(outlet.name, 'body');
  assert.ok(outlet.fallback, 'slot fallback content is its own fragment');
  console.log('  ✅ composition is modelled, not flattened into markup');
}

function testRefusals() {
  console.log('🧪 unmodelled constructs are refused by name');
  const cases = [
    ['<@suspense><p>x</p></@suspense>', RefusalReason.SUSPENSE],
    ['<@deadlock name="d"><p>x</p></@deadlock>', RefusalReason.DEADLOCK],
    ['<div data-ax-ref="box">x</div>', RefusalReason.REF],
    ['<div data-ax-validate="x">y</div>', RefusalReason.VALIDATION],
    ['<@else><p>x</p></@else>', RefusalReason.MALFORMED],
    ['<@empty><p>x</p></@empty>', RefusalReason.MALFORMED],
    ['<@placeholder><p>x</p></@placeholder>', RefusalReason.MALFORMED],
  ];
  for (const [template, reason] of cases) {
    assert.strictEqual(refusal(template).reason, reason, `for ${template}`);
  }
  console.log(`  ✅ ${cases.length} constructs refused with a specific reason`);
}

function testDeferredBlocks() {
  console.log('🧪 <@defer> with a placeholder');
  const node = find(
    ir('<@defer when="visible"><@placeholder><p>loading</p></@placeholder><b>{{ x }}</b></@defer>'),
    IRKind.DEFER,
  );
  assert.strictEqual(node.when, 'visible');
  assert.strictEqual(node.body.kind, IRKind.FRAGMENT);
  assert.ok(node.placeholder, 'the placeholder is its own fragment');
  assert.strictEqual(node.placeholder.children[0].tag, 'p');
  console.log('  ✅ the trigger, the content and the placeholder are all modelled');
}

function testStaticAndComments() {
  console.log('🧪 static marks and comments');
  const root = ir('<div data-ax-static="true"><b>x</b></div>');
  assert.strictEqual(root.children[0].isStatic, true);
  assert.strictEqual(root.children[0].attrs['data-ax-static'], undefined, 'the marker is not an attribute');

  const withComment = ir('<div><!-- note --><b>x</b></div>');
  assert.strictEqual(withComment.children[0].children[0].kind, IRKind.COMMENT);
  console.log('  ✅ static subtrees keep their mark as a property, not markup');
}

testTextAndInterpolation();
testAttributeBindings();
testEvents();
testConditional();
testConditionalNesting();
testIteration();
testIterationDestructuring();
testIterationHeaderWithComparison();
testForHeaderParsing();
testAmbiguousConditionalHeader();
testComponentsAndSlots();
testRefusals();
testDeferredBlocks();
testStaticAndComments();

console.log('\n✅ template IR tests passed');
