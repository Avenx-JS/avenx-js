/**
 * Regression coverage for the scanning declaration parser that replaced the
 * regex extraction in ExpressionParser.
 *
 * The bug this suite exists for: declarations were read with one pattern and
 * stripped from the template with a different one, and the two disagreed
 * about multi-line tags. A `<state>` tag written across several lines — the
 * form the TypeScript documentation recommends — parsed correctly and was then
 * left in the template, where it rendered as a literal `<state>` element
 * wrapping the whole component. Every test below pins one half of that class.
 */
import assert from 'assert';
import ExpressionParser from '../../lib/compiler/expressionParser.js';
import { parseDeclarations } from '../../lib/compiler/parser/declarations.js';
import { scanTags, findTagEnd, stripRanges, createLineIndex } from '../../lib/compiler/parser/tokenizer.js';

console.log('🧪 Testing the declaration parser...');

const parser = new ExpressionParser();

/* -------------------------------------------------------------------------
 * Multi-line declarations — the original defect
 * ---------------------------------------------------------------------- */

{
  const source = `<state
  count="0"
  label="hits"
/>

<div>{{ count }}</div>`;

  const state = parser.parseState(source);
  assert.deepStrictEqual(state, { count: 0, label: 'hits' }, 'a multi-line <state> tag is read');

  const { template } = parseDeclarations(source);
  assert.ok(!template.includes('<state'), 'and is removed from the template');
  assert.ok(template.includes('{{ count }}'), 'while the template survives');
}

{
  // The exact form documented on docs/getting-started/typescript.md.
  const source = `<state
  /** @type {number} */
  count="0"
  /** @type {string} */
  name="Alice"
/>

<p>{{ name }}</p>`;

  const state = parser.parseState(source);
  assert.deepStrictEqual(
    state,
    { count: 0, name: 'Alice' },
    'JSDoc annotations between attributes are documentation, not state keys',
  );

  const { template } = parseDeclarations(source);
  assert.ok(!template.includes('<state'), 'the annotated tag is removed too');
  assert.ok(!template.includes('@type'), 'and its annotations go with it');
}

{
  const source = `<computed
    name="doubled"
    value="count * 2"
  />`;
  assert.deepStrictEqual(parser.parseComputed(source), { doubled: 'count * 2' }, 'multi-line <computed>');
  assert.ok(!parseDeclarations(source).template.includes('<computed'), 'and it is stripped');
}

{
  const source = `<resource
    name="stats"
    handler="fetchStats()"
    pollInterval="5000"
  />`;
  assert.deepStrictEqual(parser.parseResources(source), { stats: { handler: 'fetchStats()', pollInterval: 5000 } });
  assert.ok(!parseDeclarations(source).template.includes('<resource'), 'and it is stripped');
}

{
  const source = `<contract
    static
    pure
  />`;
  assert.deepStrictEqual([...parser.parseContracts(source)].sort(), ['pure', 'static'], 'multi-line <contract>');
}

console.log('  ✅ Multi-line declarations parse and strip consistently.');

/* -------------------------------------------------------------------------
 * Tag boundaries a regular expression cannot find
 * ---------------------------------------------------------------------- */

{
  // A `>` inside a quoted attribute value does not end the tag.
  const source = `<state title="a > b" count="1" />
<p>{{ count }}</p>`;
  assert.deepStrictEqual(parser.parseState(source), { title: 'a > b', count: 1 }, 'quoted > is not a tag end');
  const { template } = parseDeclarations(source);
  assert.ok(!template.includes('<state'), 'and the whole tag is still removed');
  assert.ok(template.includes('{{ count }}'));
}

{
  // A `<` inside an action body is a comparison operator, not a tag.
  const source = `<action name="guard">
  if (count < 100 && count > 0) { count++; }
</action>`;
  const methods = parser.parseMethods(source);
  assert.strictEqual(
    methods.guard,
    'if (count < 100 && count > 0) { count++; }',
    'an action body is raw text, comparison operators included',
  );
  assert.strictEqual(parseDeclarations(source).template.trim(), '', 'and the body is fully removed');
}

{
  // Markup inside a string literal in an action body must not be interpreted.
  const source = `<action name="render">
  el.innerHTML = "<state count='9' />";
</action>
<div>ok</div>`;
  const methods = parser.parseMethods(source);
  assert.ok(methods.render.includes('<state'), 'markup in a string literal survives verbatim');
  assert.deepStrictEqual(parser.parseState(source), {}, 'and does not become component state');
  assert.ok(parseDeclarations(source).template.includes('<div>ok</div>'));
}

{
  // A declaration written inside an HTML comment is a comment.
  const source = `<!-- <state count="99" /> -->
<state count="1" />`;
  assert.deepStrictEqual(parser.parseState(source), { count: 1 }, 'commented-out declarations are ignored');
}

console.log('  ✅ Tag boundaries respect quoting, raw text and comments.');

/* -------------------------------------------------------------------------
 * Declaration semantics preserved from the regex implementation
 * ---------------------------------------------------------------------- */

{
  const source = `<action name="save" atomic onConflict="abort"> a = 1; </action>
<action name="plain"> b = 2; </action>`;
  assert.deepStrictEqual(parser.parseActionModifiers(source), { save: { atomic: true, onConflict: 'abort' } });
  assert.deepStrictEqual(parser.parseMethods(source), { save: 'a = 1;', plain: 'b = 2;' });
}

{
  const source = `<action name="save" atomic onConflict="nonsense"> a = 1; </action>`;
  assert.throws(
    () => parser.parseActionModifiers(source),
    /onConflict/,
    'an unknown conflict policy is still rejected with a located error',
  );
}

{
  // `<contract static="false" />` must not enable the contract, while
  // `<contract static />` must. The distinction is only visible if the parser
  // keeps valueless attributes separate from the literal string "true".
  assert.deepStrictEqual([...parser.parseContracts('<contract static="false" />')], []);
  assert.deepStrictEqual([...parser.parseContracts('<contract static />')], ['static']);
  assert.deepStrictEqual([...parser.parseContracts('<contract static="true" />')], ['static']);
}

{
  const source = `<state a="1" />
<state b="2" />
<div>x</div>`;
  assert.deepStrictEqual(parser.parseState(source), { a: 1 }, 'only the first <state> tag contributes keys');
  const { template } = parseDeclarations(source);
  assert.ok(!template.includes('<state'), 'but every <state> tag leaves the template');
}

{
  // Value coercion is part of the declaration contract.
  const state = parser.parseState(
    `<state num="42" float="1.5" yes="true" no="false" nothing="null" list="[1,2]" obj='{"a":1}' text="hello" />`,
  );
  assert.strictEqual(state.num, 42);
  assert.strictEqual(state.float, 1.5);
  assert.strictEqual(state.yes, true);
  assert.strictEqual(state.no, false);
  assert.strictEqual(state.nothing, null);
  assert.deepStrictEqual(state.list, [1, 2]);
  assert.deepStrictEqual(state.obj, { a: 1 });
  assert.strictEqual(state.text, 'hello');
}

console.log('  ✅ Declaration semantics preserved.');

/* -------------------------------------------------------------------------
 * Source locations
 * ---------------------------------------------------------------------- */

{
  const source = `<state count="0" />\n\n<computed name="d" value="count * 2" />\n<action name="a"> x(); </action>`;
  const decls = parseDeclarations(source);
  assert.strictEqual(decls.computed[0].line, 3, 'computed location points at its own line');
  assert.strictEqual(decls.actions[0].line, 4, 'action location points at its own line');
  assert.strictEqual(decls.state[0].line, 1, 'state key location points at the key');
}

{
  const index = createLineIndex('a\nbb\nccc');
  assert.deepStrictEqual(index.at(0), { line: 1, column: 1 });
  assert.deepStrictEqual(index.at(2), { line: 2, column: 1 });
  assert.deepStrictEqual(index.at(5), { line: 3, column: 1 });
}

console.log('  ✅ Source locations survive.');

/* -------------------------------------------------------------------------
 * Tokenizer primitives
 * ---------------------------------------------------------------------- */

{
  assert.strictEqual(findTagEnd('<a b="x>y">', 0), 10, 'findTagEnd skips quoted >');
  assert.strictEqual(findTagEnd('<a unterminated', 0), -1, 'an unterminated tag reports -1');

  assert.strictEqual(stripRanges('abcdef', [{ start: 1, end: 3 }]), 'adef');
  assert.strictEqual(
    stripRanges('abcdef', [
      { start: 4, end: 5 },
      { start: 0, end: 1 },
    ]),
    'bcdf',
    'ranges are removed in source order regardless of the order given',
  );

  const tags = scanTags('<state a="1" /><div><state b="2" /></div>', new Set(['state']));
  assert.strictEqual(tags.length, 2, 'nested declarations are still found');
  assert.strictEqual(tags[0].selfClosing, true);
}

console.log('  ✅ Tokenizer primitives behave.');
console.log('✅ Declaration parser tests passed!');
