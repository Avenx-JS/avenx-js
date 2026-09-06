/**
 * Adversarial coverage for the expression evaluator.
 *
 * The previous sandbox was defeated by one line:
 *
 *   ({})['const'+'ructor']['const'+'ructor']('return 1')()
 *
 * It wrapped values that reached an expression *through the scope*, so an
 * object literal created inside the expression was never wrapped; and it
 * blocked `constructor` with a regular expression over the source text, which
 * string concatenation walks straight past. Both are consequences of handing
 * the expression to `new Function` and inspecting from outside.
 *
 * The AST evaluator resolves the property key before checking it, so every
 * spelling of a forbidden name arrives at the same gate. These tests assert
 * that, and that ordinary expressions still work -- a boundary that also blocks
 * `new Date().getTime()` is not a boundary, it is a broken framework.
 */
import assert from 'assert';
import { DynamicEvaluator } from '../../lib/core/security/evaluator.js';
import { parseExpression, ExpressionParseError } from '../../lib/core/expression/parser.js';
import { evaluate } from '../../lib/core/expression/evaluator.js';
import { compileExpression, isCompilable, getFallbackReport, clearExpressionCache } from '../../lib/core/expression/compile.js';

console.log('🧪 Testing expression sandbox...');

const evaluator = new DynamicEvaluator();

/**
 * Evaluates an expression, reporting whether it was refused.
 * @param {string} source - The expression.
 * @param {object} [scope] - The scope.
 * @returns {{blocked: boolean, value: any, message: string}} The outcome.
 */
function run(source, scope = {}) {
  try {
    return { blocked: false, value: evaluator.evaluateExpression(source, scope, scope), message: '' };
  } catch (error) {
    return { blocked: true, value: undefined, message: error.message || String(error) };
  }
}

/**
 * Asserts an expression is refused.
 * @param {string} source - The expression.
 * @param {string} [why] - What the test is pinning.
 */
function blocked(source, why = '') {
  const result = run(source);
  assert.ok(result.blocked, `"${source}" must be refused${why ? ` (${why})` : ''}, got: ${String(result.value)}`);
}

/* -------------------------------------------------------------------------
 * The escapes from the architecture review
 * ---------------------------------------------------------------------- */

{
  // Arbitrary code execution through an object literal's constructor chain.
  blocked("({})['const'+'ructor']['const'+'ructor']('return 1')()", 'the original RCE');
  blocked("({}).constructor.constructor('return 1')()", 'the same, spelled plainly');

  // Prototype pollution through the same route.
  blocked("({})['const'+'ructor']['proto'+'type'].__pwned = 42", 'prototype pollution');
  assert.strictEqual({}.__pwned, undefined, 'Object.prototype was not polluted');

  blocked("[]['const'+'ructor']", 'an array literal is no different');
  blocked("''['const'+'ructor']", 'nor a string literal');
  blocked("(function(){})['const'+'ructor']", 'nor a function expression');
}

console.log('  ✅ The reported escapes are refused.');

/* -------------------------------------------------------------------------
 * Forbidden keys, however they are spelled
 * ---------------------------------------------------------------------- */

{
  const scope = { obj: { a: 1 }, key: 'constructor', proto: '__proto__' };

  for (const source of [
    'obj.constructor',
    "obj['constructor']",
    "obj['const'+'ructor']",
    'obj[key]',
    'obj.__proto__',
    "obj['__pro'+'to__']",
    'obj[proto]',
    'obj.prototype',
    "obj['proto'+'type']",
    "obj['' + 'constructor']",
    "obj[['con','structor'].join('')]",
  ]) {
    const result = run(source, scope);
    assert.ok(result.blocked, `"${source}" must be refused however the key is spelled`);
  }

  // Writes too, not only reads.
  blocked("obj['__pro'+'to__'] = {}", 'writing a forbidden key');
  blocked('obj[key] = 1', 'writing through a computed forbidden key');
  blocked("({ ['__pro'+'to__']: {x:1} })", 'defining a forbidden key in a literal');
}

console.log('  ✅ Forbidden keys are refused whatever the spelling.');

/* -------------------------------------------------------------------------
 * Globals
 * ---------------------------------------------------------------------- */

{
  for (const name of [
    'window', 'document', 'globalThis', 'global', 'process', 'fetch', 'eval',
    'Function', 'Reflect', 'Symbol', 'Proxy', 'localStorage', 'sessionStorage',
    'location', 'navigator', 'history', 'XMLHttpRequest', 'require',
    'setTimeout', 'setInterval', 'structuredClone',
  ]) {
    const result = run(name);
    assert.ok(result.blocked, `the global "${name}" must be refused`);
    assert.ok(
      /AVX_R15|Sandbox/.test(result.message),
      `refusing "${name}" should say why (got: ${result.message})`,
    );
  }

  blocked("import('fs')", 'dynamic import');

  // Reaching a global by assigning to it is refused on the same terms.
  blocked('window = 1', 'assigning to a restricted global');
  blocked('Math = 1', 'assigning to an allowed global');
}

console.log('  ✅ Restricted globals are refused with a diagnostic.');

/* -------------------------------------------------------------------------
 * Prototype objects
 * ---------------------------------------------------------------------- */

{
  blocked('Object.getPrototypeOf({})', 'reaching Object.prototype');
  blocked('Object.getPrototypeOf(function(){})', 'reaching Function.prototype');
  blocked('Object.assign(Object.getPrototypeOf({}), { pwn: 1 })', 'mutating a shared prototype');
  assert.strictEqual({}.pwn, undefined, 'Object.prototype survived');
  blocked('Object.getPrototypeOf(Object.getPrototypeOf(async function(){}))', 'walking to AsyncFunction.prototype');
}

console.log('  ✅ Shared prototypes stay out of reach.');

/* -------------------------------------------------------------------------
 * Ordinary expressions must still work
 * ---------------------------------------------------------------------- */

{
  const scope = {
    count: 5,
    user: { name: 'Alice', tags: ['a', 'b'] },
    items: [{ id: 1, done: true }, { id: 2, done: false }],
    fmt: (n) => `#${n}`,
    nothing: null,
  };

  const cases = [
    ['count * 2', 10],
    ['count > 3 ? "big" : "small"', 'big'],
    ['user.name', 'Alice'],
    ['user.tags[1]', 'b'],
    ['user.missing?.deep', undefined],
    ['nothing?.anything', undefined],
    ['items.filter(i => i.done).length', 1],
    ['items.map(i => i.id).join(",")', '1,2'],
    ['fmt(count)', '#5'],
    ['`n=${count}`', 'n=5'],
    ['[1,2,3].reduce((a,b) => a + b, 0)', 6],
    ['Math.max(1, count)', 5],
    ['JSON.stringify({ a: 1 })', '{"a":1}'],
    ['new Date(2020, 0, 1).getFullYear()', 2020],
    ['new Map([["k", 1]]).get("k")', 1],
    ['typeof undeclaredThing', 'undefined'],
    ['[...user.tags, "c"].length', 3],
    ['({ ...user, name: "Bob" }).name', 'Bob'],
    ['String(count).padStart(3, "0")', '005'],
    ['count ?? 99', 5],
    ['null ?? 99', 99],
    ['!!count', true],
    ['-count', -5],
    ['items[0].id + items[1].id', 3],
    ['"a" in { a: 1 }', true],
  ];

  for (const [source, expected] of cases) {
    const result = run(source, scope);
    assert.ok(!result.blocked, `"${source}" must evaluate (got: ${result.message})`);
    assert.deepStrictEqual(result.value, expected, `"${source}" should be ${JSON.stringify(expected)}`);
  }
}

console.log('  ✅ Ordinary expressions still evaluate.');

/* -------------------------------------------------------------------------
 * Statements and mutation
 * ---------------------------------------------------------------------- */

{
  const state = { count: 0, text: '' };
  evaluator.executeStatement('count++', state, state);
  assert.strictEqual(state.count, 1, 'a postfix update writes through');

  evaluator.executeStatement('count += 4', state, state);
  assert.strictEqual(state.count, 5, 'a compound assignment writes through');

  evaluator.executeStatement('text = "hi"; count = count * 2', state, state);
  assert.strictEqual(state.text, 'hi', 'the first statement in a program runs');
  assert.strictEqual(state.count, 10, 'and so does the second');

  assert.strictEqual(
    evaluator.executeStatement('count', state, state),
    undefined,
    'a statement program has no value unless it used return',
  );
}

console.log('  ✅ Expression statements execute and write through.');

/* -------------------------------------------------------------------------
 * The parser's boundary, reported rather than hidden
 * ---------------------------------------------------------------------- */

{
  clearExpressionCache();

  assert.ok(isCompilable('a + b'), 'a plain expression compiles');
  assert.ok(isCompilable('items.filter(x => x.ok)'), 'an arrow compiles');
  assert.strictEqual(compileExpression('if (a) { b(); }'), null, 'a statement does not compile');
  assert.strictEqual(compileExpression('await thing()'), null, 'await does not compile');

  const report = getFallbackReport();
  assert.ok(report.length >= 2, 'every expression outside the language is reported');
  assert.ok(
    report.every((entry) => typeof entry.source === 'string' && typeof entry.reason === 'string'),
    'each entry carries its source and reason',
  );

  // A template expression outside the language is refused, not evaluated. This
  // is what makes "template expressions never need 'unsafe-eval'" a property of
  // the implementation: there is no path from a parse failure to the engine.
  const refused = run('await loadThing()', {});
  assert.ok(refused.blocked, 'an unsupported template expression is refused');
  assert.ok(/AVX_R32/.test(refused.message), `refused with AVX_R32 (got: ${refused.message})`);
  assert.ok(/<action>/.test(refused.message), 'and says where that logic belongs');

  const statementRefused = run('if (a) { b(); }', {});
  assert.ok(statementRefused.blocked, 'a statement in a template binding is refused');
  assert.ok(/AVX_R32/.test(statementRefused.message), 'with the same diagnostic');

  // Supported callback forms still evaluate, so the refusal above is a
  // statement about the language boundary rather than about callbacks.
  assert.strictEqual(run('(function(){ return 7; })()', {}).value, 7, 'a function expression evaluates');
  assert.strictEqual(run('(() => 7)()', {}).value, 7, 'and so does an arrow');

  // Function expressions are supported (templates use them as callbacks), so
  // this is refused by the property-key gate, not by failing to parse.
  blocked("(function(){})['const'+'ructor']", 'a function expression is no route either');

  // An empty binding is not an error.
  assert.strictEqual(run('', {}).value, undefined, 'an empty expression evaluates to undefined');
  assert.strictEqual(run('   ', {}).value, undefined, 'and so does whitespace');
}

console.log('  ✅ Unsupported template expressions are refused, not handed to eval.');

/* -------------------------------------------------------------------------
 * Action bodies keep the statement fallback, deliberately
 * ---------------------------------------------------------------------- */

{
  // Action bodies are developer-authored JavaScript statements and have always
  // been executed as such. They still fall back to `new Function` when they use
  // real statement syntax, and that is the honest remaining scope of eval.
  const state = { total: 0 };
  const result = evaluator.executeStatement(
    'if (total < 3) { total = total + 10; } else { total = 0; }',
    state,
    state,
  );
  assert.strictEqual(state.total, 10, 'a statement body still runs');
  assert.strictEqual(result, undefined, 'and has no value');

  const returning = evaluator.executeStatement('return 42;', state, state);
  assert.strictEqual(returning, 42, 'a returning body still returns');
}

console.log('  ✅ Action bodies keep the statement fallback.');

/* -------------------------------------------------------------------------
 * Parser diagnostics
 * ---------------------------------------------------------------------- */

{
  assert.throws(() => parseExpression('a +'), ExpressionParseError, 'an incomplete expression raises');
  assert.throws(() => parseExpression('"unterminated'), ExpressionParseError, 'an unterminated string raises');
  assert.throws(() => parseExpression('a b'), ExpressionParseError, 'trailing junk raises');

  try {
    parseExpression('a + ');
  } catch (error) {
    assert.strictEqual(typeof error.position, 'number', 'the error carries a position');
    assert.strictEqual(error.source, 'a + ', 'and the source it came from');
  }

  // Evaluating a parsed tree directly, with no DynamicEvaluator in the way.
  assert.strictEqual(evaluate(parseExpression('1 + 2 * 3'), {}), 7, 'precedence');
  assert.strictEqual(evaluate(parseExpression('(1 + 2) * 3'), {}), 9, 'grouping');
  assert.strictEqual(evaluate(parseExpression('2 ** 3 ** 2'), {}), 512, '** is right-associative');
  assert.strictEqual(evaluate(parseExpression('true && false || true'), {}), true, 'logical precedence');
}

console.log('  ✅ Parser diagnostics carry position and source.');
console.log('✅ Expression sandbox tests passed!');
