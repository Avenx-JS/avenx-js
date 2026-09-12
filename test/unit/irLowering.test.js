/**
 * @file irLowering.test.js
 * @description Lowering the template IR to a render program.
 *
 * The properties these tests pin are the ones the refactor exists to establish:
 * control flow becomes an op and a block rather than markup the runtime has to
 * re-read, and an op addresses its expression by index rather than by the
 * expression's own source text.
 */
import assert from 'assert';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import { OpKind, PROGRAM_VERSION, isProgram, programBlocks } from '../../lib/compiler/render/program.js';

/**
 * Builds and lowers a template, failing the test on any refusal.
 * @param {string} template - The template source.
 * @returns {{program: object, expressions: string[], statements: string[]}} The lowered form.
 */
function lower(template) {
  const built = buildTemplateIR(template, {});
  assert.strictEqual(built.refusal, null, `IR refused: ${JSON.stringify(built.refusal)}`);
  const out = lowerToProgram(built.ir, {});
  assert.strictEqual(out.refusal, null, `lowering refused: ${JSON.stringify(out.refusal)}`);
  return out;
}

/**
 * Finds the first op of a kind in a program's root ops.
 * @param {object} program - The program.
 * @param {string} kind - An {@link OpKind}.
 * @returns {object|undefined} The op.
 */
function op(program, kind) {
  return program.ops.find((candidate) => candidate.k === kind);
}

function testFlatTemplate() {
  console.log('🧪 a template with no control flow');
  const { program, expressions } = lower('<p class="a">{{ title }}</p>');
  assert.ok(isProgram(program));
  assert.strictEqual(program.v, PROGRAM_VERSION);
  assert.strictEqual(program.html, '<p class="a"><!--axt:0--></p>', 'the skeleton keeps static markup');
  assert.deepStrictEqual(program.ops, [{ k: OpKind.TEXT, t: 0, x: 0 }]);
  assert.deepStrictEqual(expressions, ['title']);
  assert.deepStrictEqual(programBlocks(program), [], 'no control flow means no blocks');
  console.log('  ✅ one op, one expression, no blocks');
}

function testExpressionsAreIndices() {
  console.log('🧪 ops address expressions by index');
  const { program, expressions } = lower('<p title="{{ a }}">{{ a }} {{ b }}</p>');
  for (const candidate of program.ops) {
    assert.strictEqual(typeof candidate.x, 'number', `op ${candidate.k} still carries source text`);
  }
  // Two reads of `a` share one entry: a template that reads a value in ten
  // places costs one compiled closure.
  assert.deepStrictEqual(expressions, ['a', 'b']);
  const reads = program.ops.filter((candidate) => candidate.x === 0);
  assert.strictEqual(reads.length, 2, 'both reads of `a` point at the same entry');
  console.log('  ✅ no op carries an expression source string');
}

function testConditionalLowering() {
  console.log('🧪 <@if> lowers to one op and one block per arm');
  const { program, expressions } = lower('<div><@if a><b>A</b><@elseif c><i>C</i><@else><u>E</u></@if></div>');
  const branch = op(program, OpKind.IF);
  assert.ok(branch, 'a conditional is one op');
  assert.strictEqual(typeof branch.t, 'number', 'it anchors at a text marker');
  assert.strictEqual(branch.arms.length, 3);
  assert.strictEqual(branch.arms[2].x, null, '<@else> has no test');
  assert.deepStrictEqual(expressions, ['a', 'c']);

  const blocks = programBlocks(program);
  assert.strictEqual(blocks.length, 3, 'one block per arm');
  assert.strictEqual(blocks[branch.arms[0].b].html, '<b>A</b>');
  assert.strictEqual(blocks[branch.arms[2].b].html, '<u>E</u>');
  // The skeleton holds an anchor where the arm renders, and nothing else.
  assert.strictEqual(program.html, '<div><!--axt:0--></div>');
  console.log('  ✅ arms are blocks, not markup with attributes on it');
}

function testIterationLowering() {
  console.log('🧪 <@for> lowers to one op and a body block');
  const { program, expressions } = lower(
    '<ul><@for row in rows key="row.id"><li>{{ index }}:{{ row.n }}</li><@empty><li>none</li></@for></ul>',
  );
  const loop = op(program, OpKind.FOR);
  assert.ok(loop, 'a loop is one op');
  assert.strictEqual(loop.as, 'row', 'the item binding travels on the op');
  assert.strictEqual(typeof loop.x, 'number', 'the list is an expression index');
  assert.strictEqual(typeof loop.key, 'number', 'so is the key');
  assert.strictEqual(typeof loop.b, 'number', 'the body is a block index');
  assert.strictEqual(typeof loop.emp, 'number', 'so is the empty block');

  const blocks = programBlocks(program);
  assert.strictEqual(blocks[loop.b].ops.length, 2, 'the body has its own ops');
  assert.strictEqual(blocks[loop.emp].html, '<li>none</li>');
  assert.ok(expressions.includes('rows'));
  assert.ok(expressions.includes('row.id'));
  console.log('  ✅ a list is a block cloned per item, not a re-parsed <template>');
}

function testIterationWithComparisonInList() {
  console.log('🧪 <@for> over an expression containing ">"');
  const { expressions } = lower('<@for r in rows.filter(x => x.n > 2)><li>{{ r.n }}</li></@for>');
  assert.ok(
    expressions.includes('rows.filter(x => x.n > 2)'),
    'the whole list expression reaches the expression table',
  );
  console.log('  ✅ the expression survives the whole pipeline intact');
}

function testNestedBlocks() {
  console.log('🧪 nested control flow');
  const { program } = lower('<@for r in rows><@if r.on><b>{{ r.n }}</b><@else><i>off</i></@if></@for>');
  const loop = op(program, OpKind.FOR);
  const blocks = programBlocks(program);
  const body = blocks[loop.b];
  const inner = body.ops.find((candidate) => candidate.k === OpKind.IF);
  assert.ok(inner, 'a conditional inside a loop body is an op of that block');
  assert.ok(blocks[inner.arms[0].b], 'its arms are blocks of the same program');
  assert.notStrictEqual(inner.arms[0].b, loop.b, 'a nested block gets its own index');
  console.log('  ✅ blocks nest without colliding');
}

function testEventsAreOps() {
  console.log('🧪 events lower to ops with a statement index');
  const { program, statements } = lower('<button @click.prevent="save()">go</button>');
  const event = op(program, OpKind.EVENT);
  assert.strictEqual(event.n, 'click');
  assert.deepStrictEqual(event.m, ['prevent']);
  assert.strictEqual(event.x, 0);
  assert.deepStrictEqual(statements, ['save()']);
  assert.ok(
    !program.html.includes('data-ax-event'),
    'the handler source is not JSON-encoded into the skeleton',
  );
  console.log('  ✅ handler bodies leave the markup entirely');
}

function testBindingsAndBooleans() {
  console.log('🧪 binding kinds survive lowering');
  const { program } = lower(
    '<input disabled="{{ off }}" value="{{ v }}" data-ax-show="vis" data-ax-class="cls" placeholder="p-{{ n }}" />',
  );
  const kinds = program.ops.map((candidate) => candidate.k);
  assert.ok(kinds.includes(OpKind.BOOL), 'disabled is a boolean op');
  assert.ok(kinds.includes(OpKind.ATTR), 'value is a whole-value attribute op');
  assert.ok(kinds.includes(OpKind.SHOW));
  assert.ok(kinds.includes(OpKind.CLASS));
  assert.ok(kinds.includes(OpKind.ATTR_PARTS), 'a mixed value becomes parts');
  const parts = op(program, OpKind.ATTR_PARTS);
  assert.strictEqual(parts.p[0], 'p-');
  assert.strictEqual(typeof parts.p[1].x, 'number');
  console.log('  ✅ every binding form lowers to its own op kind');
}

function testComponentsAndSlots() {
  console.log('🧪 components and slots lower into the program');
  const { program, expressions } = lower('<Card :title="h" flat="1" kind="wide"><slot /></Card>');
  assert.ok(program.html.includes('data-avenx-comp="Card"'), 'the mount point keeps the shape the mounter expects');
  assert.ok(
    !program.html.includes('data-props-'),
    'no prop travels as an attribute holding its own expression source',
  );

  const props = program.ops.filter((candidate) => candidate.k === OpKind.PROP);
  const byName = Object.fromEntries(props.map((candidate) => [candidate.n, expressions[candidate.x]]));
  assert.strictEqual(byName.title, 'h', 'a bound prop is an op');
  // A literal prop is an op too, and reaches the table as the expression that
  // produces it: a number stays a number, and anything else is quoted so it
  // does not resolve as an identifier.
  assert.strictEqual(byName.flat, '1');
  assert.strictEqual(byName.kind, "'wide'");

  // A slot stays a real element: transclusion is the component mounter's, and
  // giving the outlet a second owner in the program would hide the content the
  // parent passed down from the thing rendering it.
  assert.ok(program.html.includes('<slot>'), 'the outlet survives as an element');
  console.log('  ✅ composition no longer forces the whole template off the compiled path');
}

function testSlotFallbackIsInline() {
  console.log('🧪 slot fallback content binds in the enclosing block');
  const { program } = lower('<slot name="body"><p>{{ fallbackText }}</p></slot>');
  assert.ok(program.html.includes('name="body"'));
  assert.strictEqual(program.ops.length, 1, 'the fallback binding is an op of this block');
  assert.strictEqual(program.ops[0].k, OpKind.TEXT);
  assert.deepStrictEqual(programBlocks(program), [], 'a slot needs no block of its own');
  console.log('  ✅ a binding inside fallback content updates without re-rendering the slot');
}

function testStaticSubtree() {
  console.log('🧪 a static subtree costs no ops and no markers');
  const { program } = lower('<div data-ax-static="true"><b>x</b><i>y</i></div>');
  assert.deepStrictEqual(program.ops, []);
  assert.strictEqual(program.html, '<div><b>x</b><i>y</i></div>');
  assert.strictEqual(program.elements, 0);
  console.log('  ✅ proven-static markup is emitted whole');
}

testFlatTemplate();
testExpressionsAreIndices();
testConditionalLowering();
testIterationLowering();
testIterationWithComparisonInList();
testNestedBlocks();
testEventsAreOps();
testBindingsAndBooleans();
testComponentsAndSlots();
testSlotFallbackIsInline();
testStaticSubtree();

console.log('\n✅ IR lowering tests passed');
