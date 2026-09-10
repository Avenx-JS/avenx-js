/**
 * @file expressionCodegen.test.js
 * @description Differential test: the compiled closure and the interpreter must
 * agree, on values and on refusals.
 *
 * The generator exists to delete the interpreter from production. That is only
 * safe if the two produce the same answer for every expression an application
 * can contain, so this compiles each case both ways and compares — the value
 * when it succeeds, the fact of the refusal when it does not.
 *
 * The compiled functions are built here with `new Function`, which is the one
 * place in the repository that is allowed to. A test has to turn generated
 * source into something callable, and in a real build the bundler does that by
 * writing the source into a module the engine parses. What is being checked is
 * the source the generator produced, not how this file executed it.
 */

import assert from 'assert';
import {
  compileExpressionToSource,
  compileStatementsToSource,
  ExpressionCodegenError,
} from '../../lib/compiler/codegen/expression.js';
import { compileExpression, compileStatements } from '../../lib/core/expression/compile.js';
import { evaluate as evaluateAst } from '../../lib/core/expression/evaluator.js';
import * as ops from '../../lib/core/expression/ops.js';

const RUNTIME = {
  axRead: ops.readMember,
  axWrite: ops.writeMember,
  axCall: ops.callFunction,
  axNew: ops.construct,
  axGet: ops.readIdentifier,
  axSet: ops.writeIdentifier,
  axTypeof: ops.typeofIdentifier,
  axKey: ops.guardKey,
  axIn: ops.hasIn,
};
const RUNTIME_NAMES = Object.keys(RUNTIME);
const RUNTIME_VALUES = RUNTIME_NAMES.map((name) => RUNTIME[name]);

/**
 * Turns generated source into a callable closure.
 * @param {string} code - The generated arrow-function source.
 * @returns {function(object): any} The closure.
 */
function instantiate(code) {
  const factory = new Function(...RUNTIME_NAMES, `return ${code};`);
  return factory(...RUNTIME_VALUES);
}

/**
 * A fresh scope for each side of a comparison.
 * @returns {object} The scope.
 */
function makeScope() {
  return {
    count: 3,
    flag: true,
    nothing: null,
    nested: { a: { b: 7 } },
    key: 'kk',
    rest: { r: 1 },
    more: [3, 4],
    items: [
      { done: false, n: 1, label: 'a' },
      { done: true, n: 2, label: 'b' },
    ],
    obj: { n: 5, add: (x, y) => x + y },
    total: 0,
  };
}

/**
 * A comparable projection of a scope.
 *
 * Two scopes built by separate `makeScope()` calls hold separate closures for
 * `obj.add`, and `deepStrictEqual` compares functions by identity — so the
 * comparison has to be over the data the statement could have changed, not over
 * the function identities it could not.
 * @param {object} scope - The scope to project.
 * @returns {string} A stable serialisation.
 */
function comparable(scope) {
  return JSON.stringify(scope, (key, value) => (typeof value === 'function' ? '[fn]' : value));
}

/**
 * Runs one source both ways and returns comparable outcomes.
 * @param {string} source - The expression source.
 * @returns {{interpreted: any, compiled: any}} The two outcomes.
 */
function bothWays(source) {
  let interpreted;
  try {
    interpreted = { value: evaluateAst(compileExpression(source), makeScope()) };
  } catch {
    interpreted = { threw: true };
  }

  let compiled;
  try {
    compiled = { value: instantiate(compileExpressionToSource(source))(makeScope()) };
  } catch {
    compiled = { threw: true };
  }

  return { interpreted, compiled };
}

console.log('🧪 Testing expression codegen agrees with the interpreter...');

const VALUE_CASES = [
  'count',
  'count * 2',
  'count + 1 > 3',
  'count % 2 === 1',
  'nested.a.b',
  'nested["a"]["b"]',
  'nothing?.a?.b',
  'items.filter(i => !i.done).length',
  'items.map(x => x.n).join(",")',
  'items.reduce((sum, item) => sum + item.n, 0)',
  '`v=${count}!`',
  '[1, 2, ...more]',
  '({ a: 1, b: count, [key]: 2, ...rest })',
  'flag ? "yes" : "no"',
  'nothing ?? "fallback"',
  'flag && count || 0',
  'typeof missingName',
  'typeof count',
  '-count',
  '!flag',
  'Math.max(1, count)',
  'JSON.stringify({ a: 1 })',
  'new Date(0).getTime()',
  '"n" in obj',
  '"absent" in obj',
  'obj.add(1, 2)',
  'obj.missing?.()',
  'items.length',
  'items[0].label',
  'count > 2 ? items[0].label : items[1].label',
  'String(count) + "x"',
  'items.some(i => i.done)',
  'items.every(i => i.n > 0)',
  '(count)',
  'count === 3 === true',
];

for (const source of VALUE_CASES) {
  const { interpreted, compiled } = bothWays(source);
  assert.deepStrictEqual(
    compiled,
    interpreted,
    `compiled and interpreted disagree for ${JSON.stringify(source)}: ` +
      `${JSON.stringify(compiled)} vs ${JSON.stringify(interpreted)}`,
  );
}
console.log(`  ✅ ${VALUE_CASES.length} value expressions agree`);

const STATEMENT_CASES = [
  'count = 0',
  'count++',
  '++count',
  'count--',
  'count += 5',
  'obj.n++',
  'obj.n = count',
  'obj["n"] += 2',
  'total = 1; count = total + 1',
  'flag ||= true',
  'nothing ??= 9',
  'obj.n ??= 4',
  'items[0].label = "z"',
];

for (const source of STATEMENT_CASES) {
  const interpretedScope = makeScope();
  const compiledScope = makeScope();

  let interpretedThrew = false;
  try {
    evaluateAst(compileStatements(source), interpretedScope);
  } catch {
    interpretedThrew = true;
  }

  let compiledThrew = false;
  try {
    instantiate(compileStatementsToSource(source))(compiledScope);
  } catch {
    compiledThrew = true;
  }

  assert.strictEqual(compiledThrew, interpretedThrew, `throw mismatch for ${JSON.stringify(source)}`);
  assert.strictEqual(
    comparable(compiledScope),
    comparable(interpretedScope),
    `resulting scope differs for ${JSON.stringify(source)}`,
  );
}
console.log(`  ✅ ${STATEMENT_CASES.length} statement bodies agree`);

console.log('🧪 Testing side effects are evaluated exactly once...');
{
  // `a[i++] += 1` must advance `i` once. The generator binds the object and the
  // key to temporaries precisely so it does not evaluate either twice.
  const scope = { list: [10, 20, 30], i: 0 };
  instantiate(compileStatementsToSource('list[i++] += 1'))(scope);
  assert.strictEqual(scope.i, 1, 'the index expression ran more than once');
  assert.deepStrictEqual(scope.list, [11, 20, 30]);

  // A method call must evaluate its receiver once, and receive it as `this`.
  let reads = 0;
  const receiverScope = {
    get box() {
      reads += 1;
      return {
        n: 2,
        double() {
          return this.n * 2;
        },
      };
    },
  };
  const value = instantiate(compileExpressionToSource('box.double()'))(receiverScope);
  assert.strictEqual(value, 4, 'the receiver was not bound as `this`');
  assert.strictEqual(reads, 1, 'the receiver was evaluated more than once');
}
console.log('  ✅ receivers and index expressions evaluate once');

console.log('🧪 Testing the security boundary survives compilation...');

// Blocked whichever way the key is spelled, and blocked identically by both
// implementations. Some are refused at build time now, which is strictly
// better -- but "refused" is what both must agree on.
const ATTACKS = [
  "({})['const' + 'ructor']['const' + 'ructor']('return 1')()",
  '({}).constructor',
  'target.__proto__',
  "target['__pro' + 'to__']",
  'target.prototype',
  'window.location',
  'document.cookie',
  'globalThis',
  "eval('1')",
  "Function('return 1')",
  '[].constructor',
  '({ __proto__: 1 })',
  "({ ['__pro' + 'to__']: 1 })",
  "localStorage.getItem('x')",
  "fetch('/x')",
  'process.env',
];

for (const source of ATTACKS) {
  let interpretedBlocked = false;
  try {
    evaluateAst(compileExpression(source), { target: {} });
  } catch {
    interpretedBlocked = true;
  }

  let compiledBlocked = false;
  try {
    instantiate(compileExpressionToSource(source))({ target: {} });
  } catch {
    compiledBlocked = true;
  }

  assert.ok(interpretedBlocked, `the interpreter allowed ${JSON.stringify(source)}`);
  assert.ok(compiledBlocked, `the compiled form allowed ${JSON.stringify(source)}`);
}
console.log(`  ✅ ${ATTACKS.length} escapes blocked on both paths`);

console.log('🧪 Testing security refusals happen at build time where possible...');
{
  const buildTime = [
    'window.location',
    'document.cookie',
    'target.constructor',
    'target.__proto__',
    '({ __proto__: 1 })',
  ];
  for (const source of buildTime) {
    assert.throws(
      () => compileExpressionToSource(source),
      ExpressionCodegenError,
      `${JSON.stringify(source)} should be refused by the generator, not only at runtime`,
    );
  }
  console.log(`  ✅ ${buildTime.length} refusals surface as build errors`);
}

console.log('🧪 Testing generated code contains no dynamic evaluation...');
{
  // The point of the whole exercise: nothing the generator emits can require
  // 'unsafe-eval'. Checked on the text rather than trusted.
  const sources = [...VALUE_CASES, ...STATEMENT_CASES];
  for (const source of sources) {
    let code;
    try {
      code = source.includes('=') && !source.includes('==')
        ? compileStatementsToSource(source)
        : compileExpressionToSource(source);
    } catch {
      continue;
    }
    assert.ok(!/\bnew\s+Function\b/.test(code), `generated code for ${source} constructs a Function`);
    assert.ok(!/\beval\s*\(/.test(code), `generated code for ${source} calls eval`);
    assert.ok(!/\bwith\s*\(/.test(code), `generated code for ${source} uses with`);
  }
  console.log('  ✅ no eval, no new Function, no with');
}

console.log('🧪 Testing arrow parameters are lexical, not scope reads...');
{
  // A lambda parameter must never resolve against component state, and must
  // never write to it. The interpreter kept a frame chain for this; the
  // generator emits a real JavaScript parameter.
  const code = compileExpressionToSource('items.map(count => count.n)');
  assert.ok(
    !/axGet\(\$s,\s*"count"\)/.test(code),
    'the lambda parameter shadowing a state key was compiled as a scope read',
  );

  const scope = makeScope();
  const result = instantiate(code)(scope);
  assert.deepStrictEqual(result, [1, 2]);
  assert.strictEqual(scope.count, 3, 'the lambda parameter leaked into state');

  // Nested lambdas keep their own bindings.
  const nested = instantiate(
    compileExpressionToSource('items.map(a => more.map(b => a.n + b))'),
  )(makeScope());
  assert.deepStrictEqual(nested, [[4, 5], [5, 6]]);
}
console.log('  ✅ lambda parameters are lexically bound');

console.log('\n✅ All expression codegen tests passed.');
