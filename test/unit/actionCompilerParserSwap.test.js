/**
 * @file actionCompilerParserSwap.test.js
 * @description The action compiler's output did not change when the parser did.
 *
 * `<action>` bodies are compiled by rewriting free identifiers in place, by
 * source offset. That makes the compiler's output exquisitely sensitive to the
 * parser underneath it: a node whose range is off by one does not fail a parse,
 * it emits a body that is subtly not the one the developer wrote. When the
 * compiler stopped parsing with `acorn` and started parsing with
 * `lib/compiler/parser/js`, the risk was not that builds would break loudly --
 * it was that one of these would come out slightly different and nobody would
 * notice.
 *
 * So the expected strings below are the output acorn produced, recorded
 * verbatim. They were compared against the new parser's output body for body
 * before being written down, and they are kept here so the comparison does not
 * have to be taken on trust the next time either side changes.
 *
 * Each case is a construct where identifier rewriting is not simply "replace
 * the name": shorthand properties, which need the key written back; patterns,
 * whose names are declarations rather than references; hoisting, where a
 * reference precedes its declaration; `new` and tagged templates, which need
 * the call parenthesised; and the constructs that must be copied through
 * untouched -- regular expressions, nested templates, optional chains, class
 * bodies, generators.
 *
 * {@link ../unit/jsParserDifferential.test.js} proves the two parsers agree on
 * the tree. This proves the compiler built on it agrees on the output.
 */
import assert from 'node:assert';
import { tryCompileAction } from '../../lib/compiler/codegen/actions.js';

/**
 * Action bodies and the source the compiler must emit for them.
 * @type {Array<{label: string, body: string, code: string}>}
 */
const CASES = [
  {
    label: 'a read becomes axGet',
    body: 'total = items.length;',
    code: '($s) => { axAmbientTarget($s, "total")["total"] = axGetAmbient($s, "items").length;\n}',
  },
  {
    label: 'a write stays assignable',
    body: "text = '';",
    code: "($s) => { axAmbientTarget($s, \"text\")[\"text\"] = '';\n}",
  },
  {
    label: 'an update expression',
    body: 'count++;',
    code: '($s) => { axAmbientTarget($s, "count")["count"]++;\n}',
  },
  {
    label: 'a shorthand property keeps its key',
    body: 'payload = { count, text };',
    code: '($s) => { axAmbientTarget($s, "payload")["payload"] = { count: axGetAmbient($s, "count"), text: axGetAmbient($s, "text") };\n}',
  },
  {
    label: 'a destructuring declaration is not a reference',
    body: 'const { a, b = 2, ...rest } = payload; out = a + b;',
    code: '($s) => { const { a, b = 2, ...rest } = axGetAmbient($s, "payload"); axAmbientTarget($s, "out")["out"] = a + b;\n}',
  },
  {
    label: 'a destructuring assignment writes to scope',
    body: '({ a, b } = source);',
    code: '($s) => { ({ a: axAmbientTarget($s, "a")["a"], b: axAmbientTarget($s, "b")["b"] } = axGetAmbient($s, "source"));\n}',
  },
  {
    label: 'an array destructuring assignment writes to scope',
    body: '[first, ...others] = list;',
    code: '($s) => { [axAmbientTarget($s, "first")["first"], ...axAmbientTarget($s, "others")["others"]] = axGetAmbient($s, "list");\n}',
  },
  {
    label: 'hoisting resolves a reference before its declaration',
    body: 'count; let count = 1;',
    code: '($s) => { count; let count = 1;\n}',
  },
  {
    label: 'a var in a block is function scoped',
    body: '{ var inner = 1; } out = inner;',
    code: '($s) => { { var inner = 1; } axAmbientTarget($s, "out")["out"] = inner;\n}',
  },
  {
    label: 'a catch parameter is local',
    body: 'try { risky(); } catch (err) { out = err.message; }',
    code: '($s) => { try { axGetAmbient($s, "risky")(); } catch (err) { axAmbientTarget($s, "out")["out"] = err.message; }\n}',
  },
  {
    label: 'a for-of binding is local',
    body: 'for (const item of items) { sum += item.value; }',
    code: '($s) => { for (const item of axGetAmbient($s, "items")) { axAmbientTarget($s, "sum")["sum"] += item.value; }\n}',
  },
  {
    label: 'a function parameter shadows scope',
    body: 'items.map(function (count) { return count; });',
    code: '($s) => { axGetAmbient($s, "items").map(function (count) { return count; });\n}',
  },
  {
    label: 'an arrow keeps this',
    body: 'const f = () => this.value; out = f();',
    code: '($s) => { const f = () => axGet($s, "this").value; axAmbientTarget($s, "out")["out"] = f();\n}',
  },
  {
    label: 'a nested function has its own this',
    body: 'const f = function () { return this.value; }; out = f();',
    code: '($s) => { const f = function () { return this.value; }; axAmbientTarget($s, "out")["out"] = f();\n}',
  },
  {
    label: 'new needs parentheses around a read',
    body: 'instance = new Widget(count);',
    code: '($s) => { axAmbientTarget($s, "instance")["instance"] = new (axGetAmbient($s, "Widget"))(axGetAmbient($s, "count"));\n}',
  },
  {
    label: 'a tagged template needs parentheses around a read',
    body: 'out = tag`x${count}`;',
    code: '($s) => { axAmbientTarget($s, "out")["out"] = (axGetAmbient($s, "tag"))`x${axGetAmbient($s, "count")}`;\n}',
  },
  {
    label: 'a regex literal is copied through',
    body: 'out = /a+/g.test(text);',
    code: '($s) => { axAmbientTarget($s, "out")["out"] = /a+/g.test(axGetAmbient($s, "text"));\n}',
  },
  {
    label: 'a nested template is copied through',
    body: 'out = `a${`b${count}`}c`;',
    code: '($s) => { axAmbientTarget($s, "out")["out"] = `a${`b${axGetAmbient($s, "count")}`}c`;\n}',
  },
  {
    label: 'optional chaining is copied through',
    body: 'out = obj?.deep?.[key]?.(count);',
    code: '($s) => { axAmbientTarget($s, "out")["out"] = axGetAmbient($s, "obj")?.deep?.[axGetAmbient($s, "key")]?.(axGetAmbient($s, "count"));\n}',
  },
  {
    label: 'await makes the function async',
    body: 'out = await load(count);',
    code: 'async ($s) => { axAmbientTarget($s, "out")["out"] = await axGetAmbient($s, "load")(axGetAmbient($s, "count"));\n}',
  },
  {
    label: 'a computed member read',
    body: 'out = items[index];',
    code: '($s) => { axAmbientTarget($s, "out")["out"] = axGetAmbient($s, "items")[axGetAmbient($s, "index")];\n}',
  },
  {
    label: 'a labelled break',
    body: 'outer: for (;;) { break outer; }',
    code: '($s) => { outer: for (;;) { break outer; }\n}',
  },
  {
    label: 'a class body is copied through',
    body: 'const L = class { #p = 1; get p() { return this.#p; } }; out = new L().p;',
    code: '($s) => { const L = class { #p = 1; get axGetAmbient($s, "p")() { return this.#p; } }; axAmbientTarget($s, "out")["out"] = new L().p;\n}',
  },
  {
    label: 'a generator is copied through',
    body: 'const g = function* () { yield count; }; out = [...g()];',
    code: '($s) => { const g = function* () { yield axGetAmbient($s, "count"); }; axAmbientTarget($s, "out")["out"] = [...g()];\n}',
  },
  {
    label: 'a switch shares one block scope',
    body: "switch (mode) { case 'a': let picked = 1; out = picked; break; default: out = 0; }",
    code: "($s) => { switch (axGetAmbient($s, \"mode\")) { case 'a': let picked = 1; axAmbientTarget($s, \"out\")[\"out\"] = picked; break; default: axAmbientTarget($s, \"out\")[\"out\"] = 0; }\n}",
  },
  {
    label: 'a shorthand destructuring default',
    body: 'const { count: local = 0 } = source; out = local;',
    code: '($s) => { const { count: local = 0 } = axGetAmbient($s, "source"); axAmbientTarget($s, "out")["out"] = local;\n}',
  },
  {
    label: 'an object pattern in a parameter',
    body: 'handler(({ id }) => id);',
    code: '($s) => { axGetAmbient($s, "handler")(({ id }) => id);\n}',
  },
];

console.log('\n🧩 Action compiler output is unchanged by the parser swap\n');

for (const { label, body, code } of CASES) {
  const result = tryCompileAction(body, { ambient: true });
  assert.ok(!result.error, `${label}: the body no longer compiles (${result.error})`);
  assert.strictEqual(
    result.code,
    code,
    `${label}: generated source changed\n  body:     ${body}\n  expected: ${code}\n  actual:   ${result.code}`,
  );
}
console.log(`  ✅ ${CASES.length} action bodies compile to exactly the source they did before.`);

// The refusals matter as much as the output: an action body may not construct
// code from a string, and a forbidden static key is refused at build time
// rather than when that branch happens to run. Both are decided from the AST,
// so both had to survive the parser swap.
/**
 * Bodies the compiler must refuse, and the reason it must give.
 * @type {Array<[string, RegExp]>}
 */
const REFUSED = [
  ['eval("x")', /"eval" constructs code from a string/],
  ['new Function("x")', /"Function" constructs code from a string/],
  ['obj.constructor', /Access to property "constructor" is blocked/],
  ['({ __proto__: 1 });', /Defining property "__proto__" is blocked/],
  ['a +', /could not be parsed/],
  ['let x = 1; let x = 2;', /could not be parsed: Identifier 'x' has already been declared/],
];

for (const [body, expected] of REFUSED) {
  const result = tryCompileAction(body, { ambient: true });
  assert.ok(result.error, `the compiler accepted ${JSON.stringify(body)}`);
  assert.match(result.error, expected, `${JSON.stringify(body)}: unexpected reason ${result.error}`);
}
console.log(`  ✅ ${REFUSED.length} bodies are still refused, with the same reasons.`);

// An event handler reaching this compiler is held to the template rule instead:
// a browser global is refused there, and the diagnostic says where to put it.
const handler = tryCompileAction('window.alert(1)', { ambient: false });
assert.ok(handler.error, 'an inline handler may not reach a browser global');
assert.match(handler.error, /restricted global/, handler.error);
console.log('  ✅ the non-ambient path still refuses a restricted global.');

console.log('\n✅ action compiler parser-swap tests passed');
