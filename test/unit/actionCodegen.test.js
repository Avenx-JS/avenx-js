/**
 * @file actionCodegen.test.js
 * @description The action compiler rewrites how free identifiers resolve, and
 * nothing else.
 *
 * An action body is arbitrary JavaScript. It used to reach the browser as text
 * and run through `new Function("with(this) { … }")`, which is what made
 * `'unsafe-eval'` a requirement for most non-trivial applications. It is now
 * parsed at build time; only free identifiers are rewritten, and everything
 * else is copied through, so what these tests have to establish is exactly
 * that: locals stay local, state reaches state, and the constructs a developer
 * actually writes survive intact.
 *
 * As in the expression-codegen test, `new Function` is used here to turn
 * generated *source* into something callable. In a build the bundler writes
 * that source into a module and the engine compiles it; what is under test is
 * the source, not how this file executed it.
 */

import assert from 'assert';
import { compileActionToSource } from '../../lib/compiler/codegen/actions.js';
import { ExpressionCodegenError } from '../../lib/compiler/codegen/expression.js';
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
const NAMES = Object.keys(RUNTIME);
const VALUES = NAMES.map((name) => RUNTIME[name]);

/**
 * Compiles a body and returns it as a callable.
 * @param {string} source - The action body.
 * @returns {function(object): any} The compiled action.
 */
function build(source) {
  const code = compileActionToSource(source);
  return new Function(...NAMES, `return ${code};`)(...VALUES);
}

/**
 * Runs a body against a scope and returns the scope.
 * @param {string} source - The action body.
 * @param {object} scope - The starting scope.
 * @returns {Promise<object>} The scope after the body ran.
 */
async function run(source, scope) {
  await build(source)(scope);
  return scope;
}

let failures = 0;

/**
 * Runs one named check.
 * @param {string} label - What is being checked.
 * @param {function(): Promise<void>} body - The check.
 * @returns {Promise<void>} Resolves when it has run.
 */
async function check(label, body) {
  try {
    await body();
    console.log(`  ✅ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${label}\n     ${error.message}`);
  }
}

console.log('🧪 Testing action bodies compile to real functions...');

await check('statement syntax that the expression language cannot express', async () => {
  const scope = { text: 'milk', items: [], added: 0 };
  await run(
    `
    if (!text) { return; }
    for (let i = 0; i < 2; i += 1) {
      items.push({ label: text, n: i });
    }
    added = items.length;
    text = '';
    `,
    scope,
  );
  assert.strictEqual(scope.added, 2, 'the loop ran');
  assert.strictEqual(scope.text, '', 'the write reached the scope');
  assert.deepStrictEqual(scope.items.map((entry) => entry.n), [0, 1]);
});

await check('an early return stops the body', async () => {
  const scope = { text: '', items: [] };
  await run('if (!text) { return; }\nitems.push(text);', scope);
  assert.deepStrictEqual(scope.items, [], 'the guard clause returned');
});

await check('a local declaration shadows a state key of the same name', async () => {
  const scope = { count: 5, result: 0 };
  await run('const count = 1; result = count;', scope);
  assert.strictEqual(scope.result, 1, 'the local was read, not the state key');
  assert.strictEqual(scope.count, 5, 'the state key was not overwritten by the local');
});

await check('a reference before its declaration stays local', async () => {
  // `count` here is a local in its temporal dead zone, not a free name that
  // should be routed to component state. Hoisting the declaration on entry to
  // the scope is what gets this right.
  const compiled = compileActionToSource('let count = 1; count += 1; done = count;');
  assert.ok(
    !/axGet\(\$s,\s*"count"\)/.test(compiled),
    'a locally declared name was compiled as a scope read',
  );
  const scope = { done: 0, count: 99 };
  await run('let count = 1; count += 1; done = count;', scope);
  assert.strictEqual(scope.done, 2);
  assert.strictEqual(scope.count, 99, 'the state key of the same name was untouched');
});

await check('destructuring declares its names as locals', async () => {
  const scope = { source: { a: 1, b: 2, c: 3 }, sum: 0, a: 100 };
  await run('const { a, ...rest } = source; const [first] = [10]; sum = a + rest.b + first;', scope);
  assert.strictEqual(scope.sum, 13, 'the destructured locals were used');
  assert.strictEqual(scope.a, 100, 'the state key shadowed by the local is unchanged');
});

await check('function parameters are locals', async () => {
  const scope = { items: [{ n: 1 }, { n: 2 }], total: 0, n: 999 };
  await run('total = items.reduce((sum, n) => sum + n.n, 0);', scope);
  assert.strictEqual(scope.total, 3, 'the lambda parameters resolved lexically');
  assert.strictEqual(scope.n, 999, 'the state key shadowed by a parameter is unchanged');
});

await check('try / catch / finally, with the catch parameter local', async () => {
  const scope = { error: null, ran: false, err: 'state-err' };
  await run(
    `
    try {
      throw new Error('boom');
    } catch (err) {
      error = err.message;
    } finally {
      ran = true;
    }
    `,
    scope,
  );
  assert.strictEqual(scope.error, 'boom', 'the catch parameter was read as a local');
  assert.strictEqual(scope.ran, true, 'finally ran');
  assert.strictEqual(scope.err, 'state-err', 'the state key of the same name is unchanged');
});

await check('await makes the compiled action async', async () => {
  const code = compileActionToSource('const value = await load(); result = value;');
  assert.ok(code.startsWith('async '), 'a body using await compiled to a sync function');

  const scope = { load: () => Promise.resolve(7), result: 0 };
  await run('const value = await load(); result = value;', scope);
  assert.strictEqual(scope.result, 7);
});

await check('a body without await stays synchronous', async () => {
  assert.ok(!compileActionToSource('count = 1;').startsWith('async '), 'a plain body became async');
});

await check('switch, labels, template literals and regular expressions survive', async () => {
  const scope = { kind: 'b', label: '', matched: false, name: 'ada' };
  await run(
    `
    switch (kind) {
      case 'a': label = 'first'; break;
      case 'b': label = \`second-\${name}\`; break;
      default: label = 'none';
    }
    outer: for (const x of [1, 2, 3]) { if (x === 2) break outer; }
    matched = /^a[dz]a$/.test(name);
    `,
    scope,
  );
  assert.strictEqual(scope.label, 'second-ada', 'the template literal interpolated state');
  assert.strictEqual(scope.matched, true, 'the regular expression literal survived');
});

await check('for-of over state, writing back to state', async () => {
  const scope = { rows: [{ n: 1 }, { n: 2 }], total: 0 };
  await run('for (const row of rows) { total += row.n; }', scope);
  assert.strictEqual(scope.total, 3);
});

await check('`this` resolves through the scope', async () => {
  const state = { count: 1 };
  const scope = { this: state, count: 1 };
  await run('this.count = this.count + 4;', scope);
  assert.strictEqual(state.count, 5, '`this` did not reach the component state');
});

await check('`this` inside a nested function is left alone', async () => {
  // `with(this)` never changed what `this` meant inside a nested `function`,
  // and neither does this. Rewriting it would silently change the receiver.
  const code = compileActionToSource('run(function () { return this.value; });');
  assert.ok(/return this\.value/.test(code), 'the nested function\'s `this` was rewritten');
});

await check('an arrow keeps the action\'s `this`', async () => {
  const code = compileActionToSource('run(() => this.value);');
  assert.ok(/axGet\(\$s, "this"\)\.value/.test(code), 'an arrow\'s `this` was not rewritten');
});

await check('a property named like a state key is not rewritten', async () => {
  const scope = { count: 3, out: null };
  await run('out = { count: 1, nested: { count: 2 } };', scope);
  assert.deepStrictEqual(scope.out, { count: 1, nested: { count: 2 } });
  assert.strictEqual(scope.count, 3);
});

await check('a computed member key is still evaluated', async () => {
  const scope = { key: 'a', source: { a: 9 }, out: 0 };
  await run('out = source[key];', scope);
  assert.strictEqual(scope.out, 9);
});

console.log('🧪 Testing the build-time refusals...');

await check('naming a restricted global fails the build', async () => {
  for (const source of [
    'window.location = "/x";',
    'const data = await fetch("/api");',
    'localStorage.setItem("k", "v");',
  ]) {
    assert.throws(
      () => compileActionToSource(source),
      ExpressionCodegenError,
      `${JSON.stringify(source)} should be refused`,
    );
  }
});

await check('a forbidden static key fails the build', async () => {
  for (const source of ['out = target.constructor;', 'target.__proto__ = {};', 'out = { __proto__: 1 };']) {
    assert.throws(
      () => compileActionToSource(source),
      ExpressionCodegenError,
      `${JSON.stringify(source)} should be refused`,
    );
  }
});

await check('a local named like a restricted global is still refused', async () => {
  // Deliberate: allowing `const window = …` would make the refusal depend on
  // reading the whole body, and the diagnostic is more useful than the
  // shadowing is.
  assert.throws(() => compileActionToSource('window.x = 1;'), ExpressionCodegenError);
});

console.log('🧪 Testing that no dynamic evaluation is emitted...');

await check('generated action source contains no eval, new Function or with', async () => {
  const sources = [
    'if (a) { b = 1; } else { b = 2; }',
    'try { await go(); } catch (e) { err = e; }',
    'for (const x of list) { total += x; }',
    'const { a = 1 } = opts; out = a;',
  ];
  for (const source of sources) {
    const code = compileActionToSource(source);
    assert.ok(!/\bnew\s+Function\b/.test(code), `${source} emitted new Function`);
    assert.ok(!/\beval\s*\(/.test(code), `${source} emitted eval`);
    assert.ok(!/\bwith\s*\(/.test(code), `${source} emitted with`);
  }
});

if (failures > 0) {
  console.error(`\n❌ ${failures} action-codegen check(s) failed.`);
  process.exit(1);
}

console.log('\n🎉 Action bodies compile to real functions.');
