/**
 * @file cspStrict.test.js
 * @description The three gates `csp.strict` adds, tested one at a time.
 *
 * `test/system/cspStrictBuild.test.js` checks the option end to end, on real
 * build output. That is the test that matters, and it is also the test that
 * cannot say *why* something failed. This file covers the pieces:
 *
 * - the output scan, including the cases a text search would get wrong;
 * - the configuration surface, including what it refuses;
 * - the expression gate, driven directly, because the code generator and the
 *   expression parser are currently in lockstep and no valid template produces
 *   a language gap. The gate still has to work for the day one does, and the
 *   honest way to test that today is to hand the compiler a gap.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertNoDynamicCode } from '../../lib/compiler/bundle/validate.js';
import loadConfig, { CONFIG_SCHEMA } from '../../lib/config.js';
import AvenxCompiler from '../../lib/compiler.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

// `loadConfig` logs and calls process.exit(1) on an invalid configuration,
// except under NODE_ENV=test, where it throws instead. The refusals below are
// the point of the option's validation, so they have to be observable.
process.env.NODE_ENV = 'test';

/**
 * Runs the scan over one artifact.
 * @param {string} code - The source to scan.
 * @returns {Error|null} The thrown error, or null when it passed.
 */
function scan(code) {
  try {
    assertNoDynamicCode(new Map([['bundle.js', code]]));
    return null;
  } catch (error) {
    return error;
  }
}

// =============================================================================
console.log('🧪 Testing the dynamic-code scan...');

for (const [label, code] of [
  ['ordinary code', 'const a = 1; function f() { return a; }'],
  ['a method called eval', 'const o = { eval(x) { return x; } }; o.eval(1);'],
  ['a property called Function', 'const o = { Function: 1 }; o.Function;'],
  ['a local shadowing Function', 'function f(Function) { return Function; }'],
]) {
  assert.strictEqual(scan(code), null, `the scan refused ${label}`);
}

// The cases a text search gets wrong, and the reason the scan parses. Both of
// these strings occur in the framework's own comments and diagnostic messages,
// so a build that failed on them would fail on its own documentation.
for (const [label, code] of [
  ['a comment', '// this used to call new Function("x")\nconst a = 1;'],
  ['a string literal', 'const message = "built with new Function(...) and eval";'],
  ['a template literal', 'const message = `eval(x) is refused`;'],
]) {
  assert.strictEqual(scan(code), null, `the scan matched ${label}, which it must not`);
}

for (const [label, code, expected] of [
  ['new Function', 'const f = new Function("return 1");', 'the Function constructor'],
  ['a bare Function call', 'const f = Function("return 1");', 'a call to Function'],
  ['eval', 'const x = 1;\nconst y = eval("x");', 'a call to eval'],
  ['a with-statement', 'const o = {};\nwith (o) { }', 'a with-statement'],
  ['eval inside a nested function', 'function f() { return () => eval("1"); }', 'a call to eval'],
]) {
  const error = scan(code);
  assert.ok(error, `the scan allowed ${label}`);
  assert.strictEqual(error.code, AvenxErrorCodes.COMPILER_CSP_STRICT_DYNAMIC_CODE, `${label} got the wrong code`);
  assert.ok(error.message.includes(expected), `${label} was not described as "${expected}": ${error.message}`);
  assert.ok(error.message.includes('bundle.js'), `${label} did not name the artifact`);
}

// The line and the source text, because a diagnostic pointing at a 350 KB
// bundle without either is one a developer cannot act on.
const located = scan('const a = 1;\nconst b = 2;\nconst f = new Function("x");');
assert.ok(located.message.includes('line 3'), `the diagnostic did not name the line: ${located.message}`);
assert.ok(located.message.includes('new Function'), 'the diagnostic did not quote the source line');

// Output the scan cannot parse is a failure, not a skip. `assertValidOutputs`
// has already compiled the artifact with V8 by this point, so acorn refusing it
// means the two disagree -- and passing the artifact over would leave the build
// claiming a guarantee it never checked.
const unparseable = scan('const a = ;');
assert.ok(unparseable, 'the scan silently accepted an artifact it could not parse');
assert.strictEqual(
  unparseable.code,
  AvenxErrorCodes.COMPILER_INVALID_OUTPUT,
  `an unparseable artifact should be reported as invalid output, not as ${unparseable.code}`,
);

// Source maps and stylesheets are not scanned: a map legitimately contains the
// source text of anything it maps, including the interpreter's own.
assert.strictEqual(
  (() => {
    try {
      assertNoDynamicCode(new Map([['bundle.js.map', '{"sourcesContent":["new Function(1)"]}']]));
      return null;
    } catch (error) {
      return error;
    }
  })(),
  null,
  'the scan read a source map as if it were executable',
);

console.log('  ✅ Parses rather than searches: comments, strings and member names are not matches.');

// =============================================================================
console.log('🧪 Testing the configuration surface...');

const originalCwd = process.cwd();

/**
 * Loads a configuration from a throwaway project.
 * @param {object|null} config - The avenx.config.json contents, or null for none.
 * @returns {{config: object|null, error: Error|null, warnings: string[]}} The outcome.
 */
function load(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-csp-config-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'csp-config-test' }));
  if (config !== null) {
    fs.writeFileSync(path.join(dir, 'avenx.config.json'), JSON.stringify(config));
  }
  const originalWarn = console.warn;
  // The loader reports an invalid configuration before throwing, and the
  // refusals below are expected, so the report is captured rather than printed.
  const originalError = console.error;
  const warnings = [];
  try {
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    console.error = () => {};
    process.chdir(dir);
    return { config: loadConfig(dir), error: null, warnings };
  } catch (error) {
    return { config: null, error, warnings };
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Off by default, with and without a configuration file. This is the whole of
// the backward-compatibility promise: a project that says nothing is unaffected.
assert.strictEqual(load(null).config.csp.strict, false, 'csp.strict should default to false with no config file');
assert.strictEqual(load({}).config.csp.strict, false, 'csp.strict should default to false with an empty config');
assert.strictEqual(load({ csp: { strict: true } }).config.csp.strict, true, 'csp.strict should be settable');
assert.strictEqual(load({ csp: {} }).config.csp.strict, false, 'an empty csp object should leave the default');

// A string is the mistake someone makes with a JSON config, and silently
// treating "false" as truthy would turn the option on when it was meant off.
for (const value of ['true', 'false', 1, 0, null]) {
  const { error } = load({ csp: { strict: value } });
  assert.ok(error, `csp.strict accepted ${JSON.stringify(value)}, which is not a boolean`);
  assert.match(error.message, /csp\.strict must be a boolean/, `wrong message for ${JSON.stringify(value)}`);
}

const notAnObject = load({ csp: true });
assert.ok(notAnObject.error, 'csp accepted a non-object');
assert.match(notAnObject.error.message, /csp must be an object/, 'wrong message for a non-object csp');

// A misspelled sub-key warns and names the right section, rather than being
// read as "strict is absent, so off" -- which is the failure mode that would
// leave someone believing they had the guarantee.
const misspelled = load({ csp: { strickt: true } });
assert.ok(
  misspelled.warnings.some((line) => line.includes('csp.strickt') && line.includes('csp.strict')),
  `a misspelled csp sub-key should suggest the right one: ${JSON.stringify(misspelled.warnings)}`,
);

assert.ok(CONFIG_SCHEMA.topLevel.includes('csp'), 'csp should be a documented top-level option');
assert.deepStrictEqual(CONFIG_SCHEMA.csp, ['strict'], 'the csp section should declare its sub-keys');

console.log('  ✅ Off by default, settable, and refuses anything that is not a boolean.');

// =============================================================================
console.log('🧪 Testing that an uncompiled expression fails a strict build...');

/**
 * A compiler over an empty throwaway project.
 * @param {object} options - Extra compiler options.
 * @returns {{compiler: AvenxCompiler, root: string}} The compiler and its root.
 */
function compilerFor(options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-csp-gate-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'csp-gate-test' }));
  fs.writeFileSync(path.join(root, 'avenx.config.json'), '{}');
  const originalInfo = console.info;
  console.info = () => {};
  try {
    return { compiler: new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', ...options }), root };
  } finally {
    console.info = originalInfo;
  }
}

/**
 * Seeds one language gap and asks the compiler what it makes of it.
 *
 * The gap is injected rather than compiled from a template on purpose. The
 * expression parser and the code generator accept exactly the same language
 * today, so there is no template text that parses and then fails to compile --
 * which means the only way to test the gate is to put a gap in front of it.
 * When the two do diverge, this keeps working unchanged.
 * @param {object} options - Extra compiler options, such as the mode.
 * @returns {Error|null} What the compiler raised, or null.
 */
function reportSeededGap(options) {
  const { compiler, root } = compilerFor(options);
  compiler.componentParser.expressionGaps = [
    {
      name: 'Board',
      filePath: path.join(root, 'src/components/board/board.component.js'),
      refusals: [],
      gaps: [{ source: 'items.map(({ id }) => id)', reason: 'could not be parsed', line: 12 }],
    },
  ];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    compiler.reportExpressionGaps();
    return null;
  } catch (error) {
    return error;
  } finally {
    console.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A development build warns and carries on; that is the behaviour the option
// exists to decline, so it is asserted rather than assumed.
assert.strictEqual(
  reportSeededGap({ mode: 'development' }),
  null,
  'an ordinary development build should warn about a language gap, not fail',
);

for (const mode of ['development', 'production']) {
  const error = reportSeededGap({ mode, csp: { strict: true } });
  assert.ok(error, `a strict ${mode} build accepted an expression that did not compile`);
  assert.strictEqual(
    error.code,
    AvenxErrorCodes.COMPILER_CSP_STRICT_EXPRESSION,
    `a strict ${mode} build raised ${error.code} instead of AVX_C31`,
  );
  // Naming the component and the expression is what the issue asks for, and
  // what makes the error actionable without a second build.
  assert.ok(error.message.includes('<Board>'), `the diagnostic did not name the component: ${error.message}`);
  assert.ok(
    error.message.includes('items.map'),
    `the diagnostic did not quote the expression: ${error.message}`,
  );
}

console.log('  ✅ AVX_C31 in both modes, naming the component and the expression.');

console.log('\n✅ csp.strict unit tests passed');
