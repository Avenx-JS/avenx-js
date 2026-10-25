/**
 * @file cspStrictBuild.test.js
 * @description What `csp.strict` is worth, measured on real build output.
 *
 * `test/system/productionBuild.test.js` already establishes the half of this
 * that was true before the option existed: a *production* bundle carries no
 * interpreter, so it needs no `'unsafe-eval'`. It also asserts the other half
 * deliberately — a development bundle *does* contain `new Function`, because
 * that is what keeps a template mid-edit rendering.
 *
 * `csp.strict` is for the project that cannot accept the second sentence. The
 * file below builds one application four ways and checks the three properties
 * the option promises:
 *
 * 1. a strict development bundle has no dynamic-code construct in it, where
 *    the ordinary development bundle of the same source does;
 * 2. the default build path is byte-identical to a build with the option
 *    absent, so the guarantee costs nothing to a project that did not ask for
 *    it;
 * 3. the bundle-size difference is reported rather than asserted, because the
 *    number is information for a developer choosing the option and not a
 *    property worth failing a build over.
 *
 * The scan that enforces the guarantee is tested on its own in
 * `test/unit/cspStrict.test.js`; here it is the pipeline that is under test.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Window } from 'happy-dom';
import { parse as acornParse } from 'acorn';
import AvenxCompiler from '../../lib/compiler.js';

/**
 * Writes a project whose template exercises every expression kind.
 *
 * Interpolations, a computed value, a bound attribute, a `data-ax-*`
 * directive, a `<@for>` list with a key, an inline handler and a
 * statement-bodied action — the set the issue names as having to be
 * precompiled before a strict mode can promise anything.
 * @returns {string} The project root.
 */
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-csp-'));
  const write = (relative, contents) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };

  write(
    'src/components/board/board.component.js',
    `<state
  count="0"
  label="Board"
  items="[{ id: 1, name: 'one' }, { id: 2, name: 'two' }]"
/>

<computed name="doubled" value="count * 2" />

<action name="bump">
  if (count < 10) { count = count + 1; }
</action>

<action name="total">
  let running = 0;
  for (const item of items) { running += item.id; }
  count = running;
</action>

<div>
  <h1 :title="label">{{ label }}: {{ count }} / {{ doubled }}</h1>
  <button class="bump" @click="bump()">+</button>
  <button class="total" @click="total()">sum</button>
  <p class="many" data-ax-show="count > 2">many</p>
  <ul>
    <@for item in items key="item.id">
      <li :data-id="item.id">{{ item.name }}</li>
    </@for>
  </ul>
</div>`,
  );
  write(
    'src/main.app.js',
    `import { AvenxApp } from 'avenx-core/runtime';
import Board from './components/board/board.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Board', Board);
app.mount('Board');`,
  );
  write('avenx.config.json', '{}');
  return root;
}

/**
 * Builds a project and returns the bundle.
 * @param {string} root - Project root.
 * @param {object} options - Extra compiler options, such as the mode.
 * @returns {string} The bundle source.
 */
function build(root, options) {
  const original = { log: console.log, info: console.info, warn: console.warn };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  try {
    new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', ...options }).build();
  } finally {
    Object.assign(console, original);
  }
  return fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf-8');
}

/**
 * Builds a project and returns the failure, or null when it succeeded.
 * @param {string} root - Project root.
 * @param {object} options - Extra compiler options.
 * @returns {Error|null} The thrown error.
 */
function buildExpectingFailure(root, options) {
  try {
    build(root, options);
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * Evidence that the interpreter module was linked and ran.
 *
 * The call, not the declaration. `installExpressionInterpreter` is declared in
 * `fallback.js`, which is on the evaluation path and therefore in every bundle;
 * only `interpreter.js` *calls* it, and only with an object literal. Same
 * technique the compiler uses for the string renderer, and for the same reason.
 *
 * Name markers are deliberately not used here. In a development bundle
 * comments survive, and both `AvenxSandbox` and `new Function` appear in
 * comments explaining what the engine used to do -- which is exactly why the
 * build's own check parses the bundle instead of searching it.
 * @type {RegExp}
 */
const INTERPRETER_INSTALLED = /installExpressionInterpreter\(\s*\{/;

/**
 * Finds the constructs a page under `script-src 'self'` may not contain.
 *
 * Parsed rather than searched, for the reason above, and walked here rather
 * than by calling the compiler's own checker: what is under test is the
 * emitted file, and a test that asked the implementation whether it was happy
 * with its own output would assert nothing.
 * @param {string} code - The emitted bundle.
 * @returns {string[]} A description of each construct found, in source order.
 */
function findDynamicCode(code) {
  const found = [];
  const seen = [acornParse(code, { ecmaVersion: 'latest', sourceType: 'script' })];
  while (seen.length > 0) {
    const node = seen.pop();
    if (node.type === 'WithStatement') {
      found.push('with-statement');
    } else if (
      (node.type === 'NewExpression' || node.type === 'CallExpression') &&
      node.callee &&
      node.callee.type === 'Identifier' &&
      (node.callee.name === 'Function' || node.callee.name === 'eval')
    ) {
      found.push(`${node.type === 'NewExpression' ? 'new ' : ''}${node.callee.name}()`);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeof item.type === 'string') seen.push(item);
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        seen.push(value);
      }
    }
  }
  return found;
}

/**
 * Runs a bundle in a DOM where constructing code from a string throws.
 *
 * This is the closest a Node test gets to the end-to-end CSP check: a browser
 * under `script-src 'self'` refuses `eval` and the `Function` constructor, so
 * refusing them here and then driving the application exercises the same
 * property on the same artifact. The e2e suite sets a real header; this runs on
 * every `npm test`.
 *
 * `Function` is replaced with a proxy rather than a throwing stub because the
 * runtime legitimately reads properties off it -- `Function.prototype.call`,
 * among others -- and a stub would fail for that rather than for evaluating
 * anything.
 * @param {string} bundle - The bundle to run.
 * @returns {{window: object, violations: string[]}} The window and what it refused.
 */
function runWithoutUnsafeEval(bundle) {
  const window = new Window({ url: 'http://localhost' });
  window.document.body.innerHTML = '<div id="app"></div>';

  const violations = [];
  const realFunction = window.Function;
  window.Function = new Proxy(realFunction, {
    /**
     * @returns {never} Always throws, as a browser would.
     */
    construct() {
      violations.push('new Function()');
      throw new window.EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed");
    },
    /**
     * @returns {never} Always throws, as a browser would.
     */
    apply() {
      violations.push('Function()');
      throw new window.EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed");
    },
  });

  // `window.eval` is how the bundle itself is loaded here, standing in for the
  // `<script src>` tag a browser would use, so it is trapped only for the
  // duration of the application's own execution.
  const realEval = window.eval;
  realEval.call(window, bundle);
  window.eval = (source) => {
    violations.push(`eval(${JSON.stringify(String(source).slice(0, 40))})`);
    throw new window.EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed");
  };

  return { window, violations };
}

const root = makeProject();

try {
  const strictDev = build(root, { mode: 'development', csp: { strict: true } });
  const ordinaryDev = build(root, { mode: 'development' });
  const strictProd = build(root, { mode: 'production', csp: { strict: true } });
  const ordinaryProd = build(root, { mode: 'production' });

  // ---------------------------------------------------------------------------
  console.log('🧪 Testing that a strict development bundle cannot evaluate source...');

  assert.deepStrictEqual(
    findDynamicCode(strictDev),
    [],
    'a csp.strict development bundle can still construct code from a string',
  );
  assert.ok(
    !INTERPRETER_INSTALLED.test(strictDev),
    'a csp.strict development bundle still installs the expression interpreter',
  );

  // The premise. Without these, the assertions above could pass because the
  // development bundle never had an interpreter in the first place, and the
  // option would be testing nothing.
  assert.ok(
    findDynamicCode(ordinaryDev).length > 0,
    'the ordinary development bundle lost the Function constructor, so this file cannot tell the two apart',
  );
  assert.ok(
    INTERPRETER_INSTALLED.test(ordinaryDev),
    'the ordinary development bundle no longer installs the interpreter it is meant to keep',
  );
  console.log('  ✅ The interpreter is absent from a strict development build and present without it.');

  // ---------------------------------------------------------------------------
  console.log('🧪 Testing that the option changes nothing about production output...');

  // A production build already linked no interpreter, so the option adds only
  // the check. Byte equality is the strongest available statement that turning
  // it on cannot change what a project deploys -- which is the backward
  // compatibility the issue asks for.
  assert.strictEqual(
    strictProd,
    ordinaryProd,
    'csp.strict changed the production bundle; it is only supposed to verify it',
  );
  console.log('  ✅ A strict production bundle is byte-identical to an ordinary one.');

  // ---------------------------------------------------------------------------
  console.log('🧪 Testing that the application still compiled, not merely shrank...');

  // A bundle with nothing in it would satisfy every assertion above. These are
  // the expression kinds the issue lists, each identified by something only the
  // code generator emits for it.
  for (const [what, pattern] of [
    ['an interpolation', /axGet\(\$s,\s*"count"\)/],
    ['a computed value', /"doubled"/],
    ['a bound attribute', /axGet\(\$s,\s*"label"\)/],
    ['a list item read', /axRead\(axGet\(\$s,\s*"item"\),\s*"name"/],
    ['an inline handler', /\(\$s\)\s*=>\s*\{\s*axCall\(axGet\(\$s,\s*"bump"\)/],
    ['a statement-bodied action', /"total":\s*\(\$s\)\s*=>\s*\{\s*let running/],
  ]) {
    assert.ok(pattern.test(strictDev), `${what} was not compiled into the strict development bundle`);
  }
  console.log('  ✅ Every expression kind the option covers is in the bundle as a function.');

  // ---------------------------------------------------------------------------
  console.log('🧪 Testing that a strict development bundle runs with eval refused...');

  const { window, violations } = runWithoutUnsafeEval(strictDev);

  const heading = window.document.querySelector('h1');
  assert.ok(heading, 'the application did not mount');
  assert.strictEqual(heading.textContent.trim(), 'Board: 0 / 0', 'the component did not render its state');
  assert.strictEqual(heading.getAttribute('title'), 'Board', 'the bound attribute did not render');
  assert.strictEqual(
    window.document.querySelectorAll('li').length,
    2,
    'the <@for> list did not render',
  );
  // `data-ax-show` toggles display rather than removing the node, so the
  // directive's effect is read off the element instead of its presence.
  assert.strictEqual(
    window.document.querySelector('.many').style.display,
    'none',
    'data-ax-show did not hide the element while the condition was false',
  );

  // Driving it matters more than mounting it. A compiled expression evaluated
  // at mount proves the table was linked; an inline handler and a
  // statement-bodied action only run on an interaction, and interpreting a
  // statement body is the one thing that reaches the Function constructor.
  window.document.querySelector('button.bump').click();
  // Updates are scheduled on the microtask queue, so a click's effect is not
  // visible until it drains. Two turns, because the scheduler itself defers
  // through a second one.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  window.document.querySelector('button.total').click();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepStrictEqual(violations, [], 'the application tried to construct code from a string');
  assert.strictEqual(
    window.document.querySelector('h1').textContent.trim(),
    'Board: 3 / 6',
    'the handler and the statement-bodied action did not both run',
  );
  assert.notStrictEqual(
    window.document.querySelector('.many').style.display,
    'none',
    'data-ax-show did not reveal the element once the condition held',
  );
  console.log('  ✅ It mounts, re-renders and runs both handlers with eval and Function refused.');

  // ---------------------------------------------------------------------------
  console.log('🧪 Testing that an expression the generator refuses fails a strict build...');

  // A security refusal already fails every build. What is checked here is that
  // it fails a strict *development* build too, where the interpreter would
  // otherwise have been the thing that ran it.
  fs.writeFileSync(
    path.join(root, 'src/components/board/board.component.js'),
    `<state count="0" />
<div><p>{{ window.name }}</p></div>`,
  );
  const refused = buildExpectingFailure(root, { mode: 'development', csp: { strict: true } });
  assert.ok(refused, 'a strict development build accepted an expression naming a restricted global');
  assert.match(
    refused.message,
    /AVX_C21|restricted global/,
    `unexpected failure for a restricted global: ${refused.message}`,
  );
  console.log('  ✅ A refused expression fails a strict development build.');

  // ---------------------------------------------------------------------------
  // Reported, not asserted. The number is what a developer weighing the option
  // wants to know, and it moves whenever the runtime does; a ceiling here would
  // fail for reasons that have nothing to do with CSP.
  const kb = (source) => (Buffer.byteLength(source, 'utf8') / 1024).toFixed(2);
  const gz = (source) => (zlib.gzipSync(Buffer.from(source, 'utf8')).length / 1024).toFixed(2);
  console.log('\n📏 Bundle-size impact of csp.strict:');
  console.log(`  development, ordinary: ${kb(ordinaryDev)} KB (${gz(ordinaryDev)} KB gzipped)`);
  console.log(`  development, strict:   ${kb(strictDev)} KB (${gz(strictDev)} KB gzipped)`);
  console.log(
    `  difference:            ${(Buffer.byteLength(ordinaryDev, 'utf8') - Buffer.byteLength(strictDev, 'utf8')) / 1024 > 0 ? '-' : '+'}` +
      `${Math.abs((Buffer.byteLength(ordinaryDev, 'utf8') - Buffer.byteLength(strictDev, 'utf8')) / 1024).toFixed(2)} KB ` +
      `(${Math.abs((zlib.gzipSync(Buffer.from(ordinaryDev, 'utf8')).length - zlib.gzipSync(Buffer.from(strictDev, 'utf8')).length) / 1024).toFixed(2)} KB gzipped)`,
  );
  console.log(`  production, either:    ${kb(strictProd)} KB (${gz(strictProd)} KB gzipped), unchanged`);

  // The direction is a property, even though the magnitude is not: leaving a
  // module out cannot make the bundle larger.
  assert.ok(
    Buffer.byteLength(strictDev, 'utf8') < Buffer.byteLength(ordinaryDev, 'utf8'),
    'a strict development bundle should be smaller, having linked one module fewer',
  );

  console.log('\n✅ csp.strict build system tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
