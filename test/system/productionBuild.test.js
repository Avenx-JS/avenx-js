import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';
import { PUBLIC_GLOBALS, NAMESPACE_GLOBAL } from '../../lib/core/globals.js';

/**
 * Ceiling for a Hello World production bundle, in KB.
 *
 * This is a regression guard, not a target. It caught 438 KB of testing and
 * lint infrastructure once; its job is to catch the next module that gets
 * re-exported from the runtime barrel by accident. Raise it only with a
 * reason, and never to accommodate development-only code.
 * @type {number}
 */
const PRODUCTION_SIZE_CEILING_KB = 200;

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
    `<state message="Hello World" count="0" />

<action name="increment"> count++; </action>

<div>
  <h1>{{ message }}</h1>
  <p class="count">Count: {{ count }}</p>
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
 * Production output is minified, and materially smaller than development.
 * @param {string} bundle - The production bundle.
 * @param {string} devBundle - The development bundle.
 */
function testMinified(bundle, devBundle) {
  console.log('🧪 Testing that production output is minified...');

  // A proxy for minification that does not depend on generated names: minified
  // code packs many characters per line, unminified code does not.
  const charsPerLine = bundle.length / bundle.split('\n').length;
  assert.ok(
    charsPerLine > 200,
    `production output should be minified (${charsPerLine.toFixed(0)} chars/line)`,
  );

  const devCharsPerLine = devBundle.length / devBundle.split('\n').length;
  assert.ok(devCharsPerLine < 100, 'the development build stays readable');

  assert.ok(
    bundle.length < devBundle.length * 0.6,
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
      'Something large was added to the runtime graph — check what lib/core/index.js now re-exports.',
  );

  console.log(`  ✅ ${kb.toFixed(1)} KB, under the ${PRODUCTION_SIZE_CEILING_KB} KB ceiling.`);
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

  const { bridge, Avenx } = window;

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

  // Escaping is security-relevant, so confirm it survived minification.
  assert.strictEqual(
    new Avenx.HtmlEscaper().escape('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    'HTML escaping still works',
  );

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
    testMinified(bundle, devBundle);
    testSizeCeiling(bundle);
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
