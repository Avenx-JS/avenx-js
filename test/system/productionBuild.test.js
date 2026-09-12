import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';
import { PUBLIC_GLOBALS, NAMESPACE_GLOBAL } from '../../lib/core/globals.js';

/**
 * Ceiling for a Hello World production bundle, in KB.
 *
 * This is a regression guard, not a target. It caught 438 KB of testing and
 * lint infrastructure once; its job is to catch the next module that gets
 * pulled into the graph by accident. Raise it only with a reason, and never to
 * accommodate development-only code.
 *
 * Raised from 230 to 430 when the concatenator was replaced by the Avenx
 * bundler, and the reason is the minifier rather than the graph. The old
 * number measured `dist/runtime.min.js`, produced by esbuild with identifier
 * mangling. Avenx now minifies its own output and deliberately does not
 * mangle: that needs a real ECMAScript parser, and a minifier that guesses
 * produces a bundle that is smaller and wrong. The uncompressed figure is
 * therefore larger and the *transferred* figure much closer, which is why
 * GZIPPED_CEILING_KB below is the number that actually matters. Tree shaking
 * moved the other way and now removes what the blob could not: the trace
 * recorder no longer ships to an application that never records, and neither
 * does the string renderer when every template compiled.
 *
 * Ratcheted from 430 when that became true. A ceiling well above the measured
 * size is a ceiling nothing can hit, and the point of one is to catch the
 * change that puts the weight back.
 * @type {number}
 */
const PRODUCTION_SIZE_CEILING_KB = 350;

/**
 * Ceiling for the same bundle over the wire, in KB.
 *
 * Comments and indentation are what gzip compresses best, so this is where the
 * gap between a conservative minifier and a mangling one nearly closes -- and
 * it is what a browser actually downloads. A regression here is a real one.
 *
 * Ratcheted from 100 alongside the raw ceiling.
 * @type {number}
 */
const GZIPPED_CEILING_KB = 80;

/**
 * Source that must never appear in a production bundle.
 *
 * Each marker is an export name or a string literal, both of which survive
 * minification — internal class and variable names do not, so matching those
 * would make this test pass for the wrong reason.
 * @type {Array<{label: string, marker: string}>}
 */
const FORBIDDEN = [
  { label: 'test mock: mountTestComponent', marker: 'mountTestComponent' },
  { label: 'test mock: flushPromises', marker: 'flushPromises' },
  { label: 'test mock: createMockBridge', marker: 'createMockBridge' },
  { label: 'ESLint tooling: extractLintableTemplate', marker: 'extractLintableTemplate' },
  { label: 'ESLint tooling: findInvalidComponentTags', marker: 'findInvalidComponentTags' },
  { label: 'build tooling: findRegisteredComponents', marker: 'findRegisteredComponents' },
  { label: 'Node fs shim', marker: 'readdirSync' },
  { label: 'Node fs shim', marker: 'existsSync' },
  { label: 'Node path shim', marker: 'isAbsolute' },
];

/**
 * Writes a minimal Hello World project into a temporary directory.
 * @returns {string} The project root.
 */
function makeHelloWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-prod-'));
  const write = (relative, contents) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };

  write(
    'src/components/hello/hello.component.js',
    `<state message="Hello World" count="0" untrusted="&lt;script&gt;alert(1)&lt;/script&gt;" />

<action name="increment"> count++; </action>

<action name="tallyUp">
  let running = 0;
  for (const step of [1, 2, 3]) { running += step; }
  count = running;
</action>

<div>
  <h1>{{ message }}</h1>
  <p class="count">Count: {{ count }}</p>
  <p class="untrusted">{{ untrusted }}</p>
  <button @click="increment()">+</button>
</div>`,
  );
  write(
    'src/main.app.js',
    `import { AvenxApp } from 'avenx-core/runtime';
import Hello from './components/hello/hello.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Hello', Hello);
app.mount('Hello');`,
  );
  write('avenx.config.json', '{}');
  return root;
}

/**
 * Builds a project and returns the bundle.
 * @param {string} root - Project root.
 * @param {'production'|'development'} mode - Build mode.
 * @returns {string} The bundle source.
 */
function buildBundle(root, mode) {
  const original = { log: console.log, info: console.info, warn: console.warn };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  try {
    new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', mode }).build();
  } finally {
    Object.assign(console, original);
  }
  return fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf-8');
}

/**
 * A Hello World project builds and produces a bundle.
 * @param {string} bundle - The production bundle.
 */
function testBuildsSuccessfully(bundle) {
  console.log('🧪 Testing a Hello World production build...');

  assert.ok(bundle.length > 0, 'the build produces a bundle');
  assert.ok(bundle.includes('AvenxComponent'), 'the runtime is included');
  assert.ok(bundle.includes('Hello World'), 'the application template is included');

  console.log('  ✅ Hello World builds in production mode.');
}

/**
 * Development infrastructure never reaches production output.
 * @param {string} bundle - The production bundle.
 */
function testNoDevelopmentCode(bundle) {
  console.log('🧪 Testing that development code is excluded...');

  const found = FORBIDDEN.filter((entry) => bundle.includes(entry.marker));
  assert.deepStrictEqual(
    found.map((entry) => entry.label),
    [],
    'production bundles must not carry testing, lint or Node-shim code',
  );

  console.log(`  ✅ None of the ${FORBIDDEN.length} development markers are present.`);
}

/**
 * An action body reaches production as a compiled function and not as text.
 *
 * The body used to travel as source and run through `new Function("with(this)
 * { … }")`, which is what made `'unsafe-eval'` a requirement. It is compiled
 * now, and reached by name, so the text has no job left in a production bundle:
 * nothing there can start a recording, which is the only thing that read it.
 * A development build still carries it, because `avenx trace view` prints it.
 * @param {string} production - The production bundle.
 * @param {string} development - The development bundle.
 */
function testActionBodiesAreCompiled(production, development) {
  console.log('🧪 Testing action bodies ship compiled, not as source...');

  // The marker has to be a fragment the generator *rewrites*, so that finding
  // it can only mean the body is present as written. Most of a compiled body is
  // copied through verbatim -- that is the point of the design -- so a line
  // containing no free identifiers would match both forms and prove nothing.
  // `count` is state, so this line survives only as source.
  const asWritten = 'count = running;';

  assert.ok(
    !production.includes(asWritten),
    'the production bundle still carries an action body as source text',
  );
  assert.ok(
    development.includes(asWritten),
    'the development bundle dropped the body text that Trace reports',
  );

  // The compiled form is there, reached by name rather than by source.
  assert.ok(
    /__axActions\s*=\s*\{/.test(production),
    'the production bundle has no compiled action table',
  );
  assert.ok(
    /"tallyUp":\s*\(\$s\)\s*=>/.test(production),
    'the statement-bodied action was not compiled to a function',
  );

  console.log('  ✅ Bodies compile to functions; the text stays in development.');
}

/**
 * A production bundle contains no way to evaluate source at run time.
 *
 * This is the property the whole compile-the-expressions exercise exists to
 * establish, so it is asserted on the emitted bundle rather than argued for in
 * a comment. Every expression, handler and action body is a closure the engine
 * compiled when it compiled the bundle; the parser, the tree-walking evaluator
 * and the source-text sandbox that used to back them are unreachable from a
 * production entry, so the bundler drops them.
 *
 * A development build still has them, and must: an expression the generator
 * could not compile is reported as AVX_W48 and interpreted, so a template being
 * edited keeps rendering.
 * @param {string} production - The production bundle.
 * @param {string} development - The development bundle.
 */
function testProductionNeedsNoUnsafeEval(production, development) {
  console.log('🧪 Testing production carries no expression interpreter...');

  assert.ok(
    !/\bnew\s+Function\s*\(/.test(production),
    'the production bundle can still construct a function from a string',
  );
  assert.ok(
    !/\bwith\s*\(/.test(production),
    'the production bundle still contains a with-statement',
  );

  for (const marker of ['AvenxSandbox', 'ExpressionParseError', 'parseExpressionProgram', 'function evalNode']) {
    assert.ok(
      !production.includes(marker),
      `the production bundle still carries the interpreter (found ${marker})`,
    );
  }

  // The development build keeps all of it, which is what makes the difference a
  // matter of reachability rather than of a runtime flag.
  assert.ok(development.includes('AvenxSandbox'), 'the development build lost the interpreter');
  assert.ok(
    /\bnew\s+Function\s*\(/.test(development),
    'the development build lost the statement fallback it is meant to keep',
  );

  console.log('  ✅ No eval, no new Function, no parser; development keeps them.');
}

/**
 * Production output is minified, and materially smaller than development.
 * @param {string} bundle - The production bundle.
 * @param {string} devBundle - The development bundle.
 */
function testMinified(bundle, devBundle) {
  console.log('🧪 Testing that production output is minified...');

  // Measured by what the minifier removes, rather than by characters per line.
  // Avenx's minifier is deliberately conservative: it strips comments and
  // margins and does not rename identifiers or join statements, because those
  // need a real ECMAScript parser to do safely. It buys one property with the
  // bytes it leaves behind, and that property is asserted here too.
  assert.ok(!/\/\*\*/.test(bundle), 'JSDoc blocks are gone from production output');
  assert.ok(!/^\s+\/\//m.test(bundle), 'indented line comments are gone');

  const lines = bundle.split('\n');
  const indented = lines.filter((line) => /^[ \t]+\S/.test(line)).length;
  assert.ok(
    indented / lines.length < 0.1,
    `indentation is gone from all but the multi-line template literals that carry it as data (${indented}/${lines.length})`,
  );

  assert.ok(devBundle.includes('/**'), 'the development build keeps its comments');
  assert.ok(
    bundle.length < devBundle.length * 0.75,
    `production should be well under the development build (${bundle.length} vs ${devBundle.length})`,
  );

  console.log('  ✅ Production is minified; development stays readable.');
}

/**
 * The bundle stays within the size ceiling.
 * @param {string} bundle - The production bundle.
 */
function testSizeCeiling(bundle) {
  console.log('🧪 Testing the bundle size ceiling...');

  const kb = Buffer.byteLength(bundle, 'utf8') / 1024;
  assert.ok(
    kb < PRODUCTION_SIZE_CEILING_KB,
    `Hello World production bundle is ${kb.toFixed(1)} KB, over the ${PRODUCTION_SIZE_CEILING_KB} KB ceiling. ` +
      'Something large joined the module graph — check what the application imports, and what lib/core/index.js re-exports.',
  );

  const gzipKb = zlib.gzipSync(Buffer.from(bundle, 'utf8')).length / 1024;
  assert.ok(
    gzipKb < GZIPPED_CEILING_KB,
    `Hello World transfers ${gzipKb.toFixed(1)} KB gzipped, over the ${GZIPPED_CEILING_KB} KB ceiling.`,
  );

  console.log(
    `  ✅ ${kb.toFixed(1)} KB raw / ${gzipKb.toFixed(1)} KB gzipped, under the ` +
      `${PRODUCTION_SIZE_CEILING_KB} / ${GZIPPED_CEILING_KB} KB ceilings.`,
  );
}

/**
 * A build where every template compiled does not carry the string renderer.
 *
 * This is the property the whole conditional-linking arrangement exists for,
 * and it is asserted on an emitted bundle rather than by reasoning about
 * imports -- reachability is exactly the thing that was wrong before, when the
 * four classes were behind lazy getters and still in every bundle because
 * AvenxComponent named them at the top of the file.
 * @param {string} bundle - The production bundle source.
 */
function testStringRendererIsAbsent(bundle) {
  console.log('🧪 Testing a fully compiled build leaves the string renderer out...');

  for (const marker of ['class DomPatcher', 'class ListManager', 'class DeferManager', 'class TemplateRenderer']) {
    assert.ok(
      !bundle.includes(marker),
      `${marker} is in a bundle whose every template compiled; something still reaches it`,
    );
  }

  // The seam itself is tiny and may well be present; what must not be present
  // is anything it would have pulled in.
  console.log('  ✅ the patcher, the list manager, the defer manager and the template renderer are all gone.');
}

/**
 * A built-in nobody referenced is not in the bundle either.
 * @param {string} bundle - The production bundle source.
 */
function testUnusedBuiltinIsAbsent(bundle) {
  console.log('🧪 Testing an unreferenced built-in component is not linked...');

  assert.ok(
    !bundle.includes('class VirtualList'),
    'VirtualList is in a bundle whose templates never mention it',
  );
  console.log('  ✅ <VirtualList> is linked by use, not by default.');
}

/**
 * No op in any emitted program carries expression source text.
 *
 * The addressing invariant. A program that carried source would mean the
 * compiler and the runtime were agreeing by string identity again, which is
 * unverifiable, and it would mean every expression shipped twice.
 * @param {string} bundle - The production bundle source.
 */
function testProgramsAddressExpressionsByIndex(bundle) {
  console.log('🧪 Testing render programs address expressions by index...');

  const programs = [...bundle.matchAll(/__axProgram = (\{.*?\});\n/g)].map((match) => JSON.parse(match[1]));
  assert.ok(programs.length > 0, 'the fixture must produce at least one program, or this checks nothing');

  /**
   * @param {object[]} ops - Ops to check.
   * @param {string} where - A label for the failure message.
   */
  const check = (ops, where) => {
    for (const op of ops) {
      if (op.x !== undefined && op.x !== null) {
        assert.strictEqual(typeof op.x, 'number', `${where}: op ${op.k} carries expression source`);
      }
      for (const part of op.p || []) {
        if (typeof part !== 'string') {
          assert.strictEqual(typeof part.x, 'number', `${where}: an attribute part carries expression source`);
        }
      }
      for (const arm of op.arms || []) {
        assert.ok(arm.x === null || typeof arm.x === 'number', `${where}: an arm carries expression source`);
      }
    }
  };

  for (const program of programs) {
    assert.strictEqual(program.v, 2, 'programs are emitted at the current format version');
    check(program.ops, 'root');
    for (const [index, block] of (program.blocks || []).entries()) {
      check(block.ops, `block ${index}`);
    }
  }

  console.log(`  ✅ ${programs.length} program(s), every expression addressed by index.`);
}

/**
 * The production bundle runs in a browser-like environment: it mounts the
 * application, and installs the documented global surface and only that.
 * @param {string} bundle - The production bundle.
 * @returns {object} The window the bundle ran in.
 */
function testExecutesInBrowser(bundle) {
  console.log('🧪 Testing that the production bundle runs in a browser...');

  const window = new Window({ url: 'http://localhost' });
  window.document.body.innerHTML = '<div id="app"></div>';

  // Snapshot after the mount point exists: the DOM publishes a named global
  // for every element id, so an id in the fixture would look like a leak.

  const before = new Set(Object.keys(window));
  window.eval(bundle);

  const heading = window.document.querySelector('h1');
  assert.ok(heading, 'the application mounted and rendered');
  assert.strictEqual(heading.textContent.trim(), 'Hello World', 'the component rendered its state');

  const namespace = window[NAMESPACE_GLOBAL];
  assert.ok(namespace, `the bundle publishes window.${NAMESPACE_GLOBAL}`);
  assert.strictEqual(typeof namespace.AvenxComponent, 'function', 'the namespace carries the runtime');

  for (const name of PUBLIC_GLOBALS) {
    assert.ok(window[name] !== undefined, `${name} is published as a bare global`);
    assert.strictEqual(window[name], namespace[name], `${name} is the same object as on the namespace`);
  }

  // Only the namespace and the declared globals may be added. Anything else is
  // the 67-name dump creeping back.
  const added = Object.keys(window).filter((key) => !before.has(key));
  const expected = [NAMESPACE_GLOBAL, ...PUBLIC_GLOBALS].sort();
  assert.deepStrictEqual(
    added.sort(),
    expected,
    'the runtime installs the namespace and the declared globals, and nothing else',
  );

  console.log(`  ✅ Mounts in a DOM and installs exactly ${expected.length} globals.`);
  return window;
}

/**
 * The runtime still works after minification.
 * @param {object} window - The window the bundle was evaluated in.
 */
function testRuntimeStillWorks(window) {
  console.log('🧪 Testing runtime behaviour in the minified bundle...');

  const { bridge } = window;

  const counter = bridge({
    state: { count: 0 },
    get doubled() {
      return this.count * 2;
    },
    increment() {
      this.count += 1;
      this.emit('changed', this.count);
    },
  });

  assert.strictEqual(counter.count, 0, 'bridge state reads');
  assert.strictEqual(counter.doubled, 0, 'bridge getters evaluate');

  let seen = null;
  counter.on('changed', (value) => {
    seen = value;
  });
  counter.increment();

  assert.strictEqual(counter.count, 1, 'actions mutate state');
  assert.strictEqual(counter.doubled, 2, 'getters recompute');
  assert.strictEqual(seen, 1, 'events reach subscribers');

  assert.throws(() => {
    counter.count = 99;
  }, 'state stays read-only for consumers');

  // Escaping is security-relevant, so confirm it survived minification. Checked
  // through what the application rendered rather than by calling HtmlEscaper on
  // the namespace: the namespace now carries the documented globals and nothing
  // else, and rendered output is the stronger assertion anyway.
  const untrusted = window.document.querySelector('.untrusted');
  assert.ok(untrusted, 'the component rendered the untrusted value');
  assert.ok(untrusted.textContent.includes('script'), 'the value reaches the DOM as text');
  assert.strictEqual(
    untrusted.querySelector('script'),
    null,
    'and never as markup: HTML escaping still works after minification',
  );
  assert.strictEqual(untrusted.children.length, 0, 'the interpolation produced no elements at all');

  console.log('  ✅ Reactivity, events, read-only state and escaping all work.');
}

/**
 * A development build keeps the readable runtime.
 * @param {string} devBundle - The development bundle.
 */
function testDevelopmentBuild(devBundle) {
  console.log('🧪 Testing the development build...');

  assert.ok(devBundle.includes('AvenxComponent'), 'the development build includes the runtime');
  assert.ok(
    !FORBIDDEN.some((entry) => devBundle.includes(entry.marker)),
    'development builds exclude testing and lint code too — the split is in the graph, not the mode',
  );

  console.log('  ✅ Development output is readable and equally free of dev tooling.');
}

/**
 * Runs the suite.
 */
function run() {
  const root = makeHelloWorld();

  try {
    const bundle = buildBundle(root, 'production');
    const devBundle = buildBundle(root, 'development');

    testBuildsSuccessfully(bundle);
    testNoDevelopmentCode(bundle);
    testActionBodiesAreCompiled(bundle, devBundle);
    testProductionNeedsNoUnsafeEval(bundle, devBundle);
    testMinified(bundle, devBundle);
    testSizeCeiling(bundle);
    testStringRendererIsAbsent(bundle);
    testUnusedBuiltinIsAbsent(bundle);
    testProgramsAddressExpressionsByIndex(bundle);
    const window = testExecutesInBrowser(bundle);
    testRuntimeStillWorks(window);
    testDevelopmentBuild(devBundle);

    console.log('\n✅ All production build tests passed!');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  console.error('❌ Production build tests failed:', error);
  process.exit(1);
}
