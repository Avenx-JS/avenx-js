/**
 * @file jsParserDifferential.test.js
 * @description The compiler's JavaScript parser must read the language the way
 * the rest of the ecosystem does.
 *
 * The compiler used to parse JavaScript with acorn, which made a parser the
 * published package's only runtime dependency. It now parses with
 * `lib/compiler/parser/js`, code the project owns, and acorn stays as a
 * development dependency for exactly one job: being the independent opinion
 * this test checks against.
 *
 * Two deterministic corpora gate pull requests. Generated and damaged sources
 * run separately in test/fuzz/jsParser.test.js on the nightly/on-demand tier.
 *
 * 1. **The repository itself.** Every `.js` file under `lib/`, `bin/`,
 *    `scripts/`, `test/` and `templates/` — including the built bundles
 *    checked in under `test/e2e`, which is the closest thing to the output the
 *    `csp.strict` check has to parse in a real build.
 * 2. **A hand-written corpus** of syntax that does not appear in this
 *    repository: `with`, labels, legacy octals, `new.target`, import
 *    attributes, nested templates, private-name `in`, getters in patterns.
 *
 * Node ranges are compared as strictly as node types, because the action
 * compiler rewrites source by offset: a range that is off by one does not fail
 * a parse, it silently corrupts generated code.
 */
// @avenx-no-dev-runtime
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { differential, listJsFiles } from '../helpers/parserOracle.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

console.log('\n🔬 JavaScript parser differential tests (oracle: acorn)\n');

// ---------------------------------------------------------------------------
// 1. The repository's own JavaScript.
// ---------------------------------------------------------------------------

const corpusDirs = ['lib', 'bin', 'scripts', 'test', 'templates', 'plugins', 'benches'];
const files = corpusDirs.flatMap((dir) => listJsFiles(path.join(rootDir, dir), { skip: new Set(['node_modules', '.git', 'coverage']) }));
assert.ok(files.length > 200, `the corpus should cover the repository, found ${files.length} files`);

let bytes = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  bytes += source.length;
  const difference = differential(source, { sourceType: 'module', locations: true });
  assert.strictEqual(difference, null, `${path.relative(rootDir, file)}: ${difference}`);
}
console.log(`  ✅ ${files.length} repository files (${(bytes / 1e6).toFixed(1)} MB) parse identically.`);

// ---------------------------------------------------------------------------
// 2. Syntax the repository does not happen to contain.
// ---------------------------------------------------------------------------

/**
 * Sources that must parse, and parse to the same tree.
 * @type {Array<[string, string]>}
 */
const VALID = [
  ['numbers', '0; 1.5; .5; 1e3; 1E-3; 0x1f; 0o17; 0b1010; 1_000_000; 0xdead_beef; 123n; 0x10n;'],
  ['legacy octal', '0755; 09; 08.5;'],
  ['string escapes', '"\\u0041\\x42\\n\\t\\0\\\\"; \'a\\\'b\'; "\\u{1F600}"; "a\\\nb";'],
  ['regex versus division', 'var re = /ab+c/gi; var d = a / b / c; /[/]/.test("/"); /a[^]]b/; if (x) /re/.test(y);'],
  ['templates', '`a${b}c`; `${`${x}`}`; tag`a${b}`; String.raw`\\n`; `${ { a: `${1}` } }`;'],
  ['object members', 'var o = { a, b: 1, [c]: 2, "d": 3, 4: 5, get x() { return 1 }, set x(v) {}, m() {}, *g() {}, async a2() {}, async *ag() {}, ...rest };'],
  ['contextual keywords as keys', 'var o = { get: 1, set: 2, async: 3, static: 4, of: 5, let: 6 }; o.let; o.static;'],
  ['destructuring', 'var { a, b: c, d = 1, "e": f, [g]: h, ...rest } = obj; var [i, , j = 2, ...k] = arr;'],
  ['destructuring assignment', '({ a } = obj); [a, b] = [b, a]; ({ a: o.p } = x); [o.p] = y; var { a: { b: [c] } = {} } = x;'],
  ['parameters', 'function f(a, b = 1, { c }, [d], ...e) {} (function () {})(); (a, b,) => a; f(1, 2,);'],
  ['arrows', 'var f = a => a; var g = (a) => a; var h = () => ({}); var i = async a => await a; var j = (a = (1, 2)) => a;'],
  ['new', 'new C; new C(); new new C()(); new a.b.c(); new (a())(); new a[b](...args);'],
  ['generators', 'function* g() { yield; yield 1; yield* other(); var x = yield 2; }'],
  ['async', 'async function a() { await 1; for await (const x of y) {} } async function* ag() { yield await 1; }'],
  ['classes', 'class A { constructor() {} m() {} static s() {} get g() { return 1 } set g(v) {} #p = 1; static #sp; #m() {} static { this.x = 1 } [k]() {} "str"() {} 1() {} static async *m2() {} }'],
  ['class accessor pair', 'class A { get #x() { return 1 } set #x(v) {} }'],
  ['private in', 'class C { #x; has(o) { return #x in o; } }'],
  ['class expressions', 'var D = class {}; var E = class Named extends (f()) { constructor() { super(); super.m(); } };'],
  ['labels', 'label: for (;;) { break label; continue label; } outer: { break outer; } l2: ;'],
  ['sloppy function positions', 'if (a) function f() {} l: function g() {} if (b) var c = 1;'],
  ['loops', 'for (var i = 0, j = 1; i < j; i++, j--) ; for (;;) break; for (var k in o) delete o[k]; do x++; while (x < 10)\nx;'],
  ['switch', 'switch (x) { case 1: case 2: y(); break; default: z(); }'],
  ['try', 'try { a() } catch { b() } finally { c() } try { a() } catch (e) { b(e) } try { a() } catch ({ message }) { b(message) }'],
  ['catch shadowing', 'try { a() } catch (e) { var e = 1; }'],
  ['with', 'with (o) { x = 1; }'],
  ['optional chaining', 'a?.b; a?.[b]; a?.(); a?.b.c?.(d); (a?.b).c; a?.b ?? c;'],
  ['nullish and logical', '(a ?? b) || c; a || (b ?? c); a && b || c;'],
  ['exponentiation', 'a ** b ** c; (-a) ** b; (() => 1) ** 2;'],
  ['logical assignment', 'a &&= b; a ||= c; a ??= d; a >>>= 1; a **= 2;'],
  ['member on number', '1 .toString(); 1..toString(); (1).toString();'],
  ['asi', 'x\n++y; var a = 1\nvar b = 2\na\n.b\n.c;'],
  ['contextual let', 'let.a; let(0); var let = 1; let x1 = 1; let [x2] = y;'],
  ['contextual async', 'async; async(); async.a; var async2 = async;'],
  ['unicode identifiers', 'var é = 1; var \\u0061bc = 2; var $_ = 4;'],
  ['directives', '"use strict"; a;'],
  ['non-directive', '("use strict"); a; \'x\'; 1; \'y\';'],
  ['function directive', 'function f() { "use strict"; return 1 }'],
  ['dynamic import', 'import("x"); import("x", { with: { type: "json" } });'],
  ['comments', '/* c1 */ a /* c2 */ ; // c3\nb;'],
  ['empty', ''],
  ['hashbang', '#!/usr/bin/env node\nvar a = 1;'],
];

for (const [label, source] of VALID) {
  const difference = differential(source, { sourceType: 'script', locations: true });
  assert.strictEqual(difference, null, `${label}: ${difference}`);
}
console.log(`  ✅ ${VALID.length} hand-written script cases parse identically.`);

/**
 * Module-only sources.
 * @type {Array<[string, string]>}
 */
const VALID_MODULES = [
  ['imports', 'import a from "m"; import { b } from "m"; import { c as d } from "m"; import * as e from "m"; import "m"; import f, { g } from "m"; import h, * as i from "m";'],
  ['string import names', 'import { "str" as j } from "m";'],
  ['import attributes', 'import a from "m" with { type: "json" };'],
  ['exported declarations', 'export var a = 1; export let b = 2; export const c = 3; export function f() {} export async function g() {} export function* h() {} export class C {}'],
  ['default exports', 'export default 1;'],
  ['default anonymous function', 'export default function () {}'],
  ['default async function', 'export default async function () {}'],
  ['default named function', 'export default function named() {}'],
  ['default class', 'export default class {}'],
  ['named exports', 'export {}; var a; export { a }; export { a as b }; export { a as "str" };'],
  ['re-exports', 'export { a } from "m"; export { a as b } from "m"; export * from "m"; export * as ns from "m"; export { default as x } from "m"; export { a as default } from "m";'],
  ['re-export attributes', 'export * as ns from "m" with { type: "json" };'],
  ['top-level await', 'await 1; for await (const x of y) {}'],
  ['import meta', 'import.meta.url; import.meta;'],
  ['new target', 'function f() { return new.target; } class C { m() { return new.target } }'],
];

for (const [label, source] of VALID_MODULES) {
  const difference = differential(source, { sourceType: 'module', locations: true });
  assert.strictEqual(difference, null, `${label}: ${difference}`);
}
console.log(`  ✅ ${VALID_MODULES.length} hand-written module cases parse identically.`);

/**
 * Sources both parsers must refuse. Agreement on refusal is the property that
 * keeps a miscompile from shipping.
 * @type {string[]}
 */
const INVALID = [
  'var;', 'function () {}', 'a +;', 'if (a;', 'class {}', 'for (;) {}',
  'a ?? b || c;', 'a || b ?? c;', 'a => ;', '({ a: 1 }) = x;', '[a] = ;',
  'new.foo;', 'import.foo;', 'a?.b = 1;', 'let let = 1;', 'break;', 'continue;',
  'return 1;', '`unterminated', '"unterminated', '/unterminated', 'a /* unterminated',
  '0x;', '1_;', '1__0;', 'a++ ++;', '({ get a() {}, get a(v) {} });',
  'var a = { , };', 'f(,);', '() => {} => {};', 'super();', 'yield 1;',
  'const a;', 'var { a };', 'label: label: ;', 'break nope;',
  'export default 1;', 'import a from "m";',
  '#x;', 'a. ;', 'a[1;', 'typeof;', 'delete;',
  'async function f() { await; }',
  '({ a = 1 });', 'for (a of b) let x = 1;', 'for (let.a of x) {}',
  '1 = 2;', '(a, b) = c;', 'a ** -b;', '-a ** b;',
  'let x = 1; let x = 2;', 'const a = 1; var a = 2;', 'var a = 1; class a {}',
  'function f(a, a) { "use strict"; }'.replace('"use strict"; ', 'var [b] = 1; '),
  'class A { m() { return this.#gone } }',
  'class A { #x; #x; }',
  'for (;;) function f() {}',
  'while (a) label: function f() {}',
  'if (a) class C {}',
  'if (a) function* g() {}',
  'o = { set x() {} };',
  'o = { get x(v) {} };',
  'class A { get x(v) {} }',
  'try {}',
  'do x; while',
  'switch (x) { default: ; default: ; }',
  'new a?.b();',
  'a\n=> 1;',
  'throw\n1;',
  '/a/gg;', '/a/x;',
  'f(...);',
  '({ ...a } = b, { ...c.d } = e, { ...[f] } = g);',
];

for (const source of INVALID) {
  const difference = differential(source, { sourceType: 'script', locations: true });
  assert.strictEqual(difference, null, `${JSON.stringify(source)}: ${difference}`);
}
for (const source of INVALID) {
  const difference = differential(source, { sourceType: 'module', locations: true });
  assert.strictEqual(difference, null, `module ${JSON.stringify(source)}: ${difference}`);
}
console.log(`  ✅ ${INVALID.length} invalid cases are refused by both, as scripts and as modules.`);

/**
 * The one deliberate divergence, asserted rather than left implicit.
 *
 * `(a) => {} ** 2` is a syntax error: `**` takes an UpdateExpression on its
 * left, and an arrow function is not one. V8 refuses it and so does this
 * parser; acorn accepts it. Being stricter than the oracle is safe under the
 * compile-or-refuse rule — the build fails with a position instead of emitting
 * something no browser will run — but it has to be a decision on the record
 * rather than a surprise the next person has to re-derive.
 */
{
  const { parse: ownParse } = await import('../../lib/compiler/parser/js/parser.js');
  const { parse: acornParse } = await import('acorn');
  const source = 'x = (a) => { return 1; } ** 2;';
  // The arrow is complete before `**` is read, so the refusal reads as an
  // unexpected token there rather than naming the operator.
  assert.throws(() => ownParse(source), SyntaxError, 'an arrow may not be the left side of **');
  assert.doesNotThrow(() => acornParse(source, { ecmaVersion: 'latest' }), 'acorn is the lenient one here');
  assert.throws(() => new Function(source), SyntaxError, 'V8 agrees with the compiler, not with acorn');
  assert.doesNotThrow(() => ownParse('x = (() => 1) ** 2;'), 'parenthesised, it is legal');
  console.log('  ✅ the single divergence from acorn is the one V8 agrees with.');
}

console.log('\n✅ Deterministic JavaScript parser differential tests passed');
