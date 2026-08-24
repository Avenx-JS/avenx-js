import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import '../helpers/register-happy-dom.js';
import AvenxCompiler from '../../lib/compiler.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import {
  analyzeBridge,
  bridgeNameFromFile,
  emitBridge,
  extractEmittedEvents,
  extractSubscriptions,
  findBridgeImports,
  resolveBridgeSpecifier,
  declaredMembers,
} from '../../lib/compiler/BridgeParser.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

/**
 * Creates an isolated project directory for one compiler run.
 * @param {Record<string, string>} files - Relative paths to file contents.
 * @returns {string} The project root.
 */
function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-bridge-'));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/**
 * Builds a project and captures the bundle plus everything logged.
 * @param {Record<string, string>} files - The project files.
 * @returns {{bundle: string, output: string, error: Error|null, root: string}} The result.
 */
function build(files) {
  const root = makeProject(files);
  const lines = [];
  const capture = (...args) => lines.push(args.map(String).join(' '));
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  console.log = capture;
  console.info = capture;
  console.debug = capture;
  console.warn = capture;
  console.error = capture;

  let error = null;
  try {
    new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist' }).build();
  } catch (err) {
    error = err;
  } finally {
    Object.assign(console, original);
  }

  const bundlePath = path.join(root, 'dist', 'bundle.js');
  const bundle = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, 'utf-8') : '';
  return { bundle, output: lines.join('\n'), error, root };
}

const AUTH_BRIDGE = `import { bridge } from 'avenx-core/runtime';

const GUEST_NAME = 'Guest';

/**
 * Normalises a raw user record.
 * @param {object} raw - The record.
 * @returns {object} The normalised user.
 */
function normalize(raw) {
  return { name: raw.name || GUEST_NAME };
}

export default bridge({
  state: { user: null, status: 'anonymous' },

  get isLoggedIn() { return this.status === 'authenticated'; },
  get displayName() { return this.user ? this.user.name : GUEST_NAME; },

  login(raw) {
    this.user = normalize(raw);
    this.status = 'authenticated';
    this.emit('login', this.user);
  },

  logout() {
    this.user = null;
    this.emit('logout');
  },
});
`;

// ---------------------------------------------------------------------------
// Static analysis
// ---------------------------------------------------------------------------

/**
 * The parser reports the full declaration surface of a bridge module.
 */
function testAnalysis() {
  console.log('🧪 Testing bridge module analysis...');

  const descriptor = analyzeBridge('/p/src/bridges/auth.bridge.js', AUTH_BRIDGE);

  assert.strictEqual(descriptor.modern, true, 'a bridge() module is recognised');
  assert.strictEqual(descriptor.name, 'auth', 'the name comes from the file name');
  assert.strictEqual(descriptor.binding, '__avx_bridge_auth', 'the bundle identifier is derived');
  assert.deepStrictEqual(descriptor.stateKeys, ['user', 'status'], 'state keys are read');
  assert.deepStrictEqual(descriptor.getters, ['isLoggedIn', 'displayName'], 'getters are read');
  assert.deepStrictEqual(descriptor.actions, ['login', 'logout'], 'actions are read');
  assert.deepStrictEqual(descriptor.events, ['login', 'logout'], 'emitted events are inferred, not declared');
  assert.strictEqual(descriptor.hasSetup, false, 'no setup in this module');

  assert.deepStrictEqual(
    declaredMembers(descriptor).sort(),
    ['$dispose', '$name', 'displayName', 'isLoggedIn', 'login', 'logout', 'on', 'status', 'user'],
    'the consumable surface is the union of state, getters, actions and the API',
  );

  console.log('  ✅ Analysis reads state, getters, actions and events.');
}

/**
 * A legacy class bridge is recognised but not treated as a bridge() module.
 */
function testLegacyDetection() {
  console.log('🧪 Testing legacy bridge detection...');

  const legacy = `import { AvenxBridge } from 'avenx-core/runtime';
export default class AuthBridge extends AvenxBridge {
  constructor() { super(); this.isLoggedIn = false; }
}`;
  const descriptor = analyzeBridge('/p/src/global/auth.bridge.js', legacy);

  assert.strictEqual(descriptor.modern, false, 'a class bridge is not a bridge() module');
  assert.deepStrictEqual(descriptor.stateKeys, [], 'no members are claimed for it');

  console.log('  ✅ Legacy class bridges are told apart.');
}

/**
 * The scanner is not fooled by braces inside strings, templates or comments.
 */
function testScannerRobustness() {
  console.log('🧪 Testing scanner robustness...');

  const tricky = `import { bridge } from 'avenx-core/runtime';
export default bridge({
  state: {
    // a comment with { braces } and a 'quote
    label: 'has { a brace } inside',
    pattern: "and \\" an escaped quote {",
    tpl: \`template \${'with'} \${ { nested: 1 } } substitution\`,
    nested: { deep: { deeper: 1 } },
    list: [{ a: 1 }, { b: 2 }],
  },
  /* block comment with { and , */
  get label2() { return this.label; },
  act(a, b) { return this.emit('done', { a, b }); },
});`;

  const descriptor = analyzeBridge('/p/x.bridge.js', tricky);

  assert.deepStrictEqual(
    descriptor.stateKeys,
    ['label', 'pattern', 'tpl', 'nested', 'list'],
    'commas inside strings, templates, comments and nested literals are ignored',
  );
  assert.deepStrictEqual(descriptor.getters, ['label2'], 'the getter after a block comment is found');
  assert.deepStrictEqual(descriptor.actions, ['act'], 'the action is found');
  assert.deepStrictEqual(descriptor.events, ['done'], 'the emitted event is found');

  console.log('  ✅ The scanner handles strings, templates, comments and nesting.');
}

/**
 * Name derivation and identifier generation handle awkward file names.
 */
function testNameDerivation() {
  console.log('🧪 Testing name derivation...');

  assert.strictEqual(bridgeNameFromFile('/a/auth.bridge.js'), 'auth');
  assert.strictEqual(bridgeNameFromFile('/a/user-prefs.bridge.js'), 'userPrefs');
  assert.strictEqual(bridgeNameFromFile('/a/user_prefs.bridge.js'), 'userPrefs');
  assert.strictEqual(bridgeNameFromFile('/a/a-b-c.bridge.js'), 'aBC');

  console.log('  ✅ Bridge names are the camelCase file name.');
}

/**
 * Only explicit `.bridge.js` specifiers count as bridge imports.
 */
function testSpecifierResolution() {
  console.log('🧪 Testing specifier resolution...');

  const from = '/p/src/components/nav.component.js';
  assert.ok(resolveBridgeSpecifier(from, '../bridges/auth.bridge.js'), 'an explicit bridge path resolves');
  assert.ok(resolveBridgeSpecifier(from, '../bridges/auth.bridge'), 'the extension may be omitted');
  assert.strictEqual(resolveBridgeSpecifier(from, './child.component.js'), null, 'a component import is not a bridge');
  assert.strictEqual(resolveBridgeSpecifier(from, './utils.js'), null, 'a helper import is not a bridge');
  assert.strictEqual(resolveBridgeSpecifier(from, 'avenx-core/runtime'), null, 'a package import is not a bridge');

  const source = `import auth from '../bridges/auth.bridge.js';
import Child from './child.component.js';
import { helper } from './utils.js';`;
  const found = findBridgeImports(from, source);
  assert.strictEqual(found.length, 1, 'only the bridge import is collected');
  assert.strictEqual(found[0].local, 'auth', 'the local name is captured');

  console.log('  ✅ Bridge imports are identified precisely.');
}

/**
 * Event names are inferred from emit calls; subscriptions are found in consumers.
 */
function testEventExtraction() {
  console.log('🧪 Testing event extraction...');

  assert.deepStrictEqual(
    extractEmittedEvents(`this.emit('a'); this.emit("b", 1); this.emit(\`c\`); this.emit('a');`),
    ['a', 'b', 'c'],
    'literal event names are collected once each',
  );

  const subs = extractSubscriptions(`auth.on('login', f); cart.on("added", g); auth.on('logout', h);`);
  assert.deepStrictEqual(subs, [
    { target: 'auth', event: 'login' },
    { target: 'cart', event: 'added' },
    { target: 'auth', event: 'logout' },
  ]);

  console.log('  ✅ Emissions and subscriptions are extracted.');
}

/**
 * Emission preserves the whole module body, including code above the export.
 */
function testEmission() {
  console.log('🧪 Testing bundle emission...');

  const descriptor = analyzeBridge('/p/src/bridges/auth.bridge.js', AUTH_BRIDGE);
  const emitted = emitBridge(descriptor, AUTH_BRIDGE, new Map());

  assert.ok(emitted.includes('const __avx_bridge_auth = (() => {'), 'the module becomes a scoped IIFE');
  assert.ok(emitted.includes("const GUEST_NAME = 'Guest'"), 'a constant above the export survives');
  assert.ok(emitted.includes('function normalize(raw)'), 'a helper above the export survives');
  assert.ok(emitted.includes('return bridge({'), 'the default export becomes the return value');
  assert.ok(!emitted.includes('export default'), 'the export keyword is gone');
  assert.ok(!emitted.includes("from 'avenx-core/runtime'"), 'the runtime import is stripped');
  assert.ok(emitted.includes('defineBridgeName("auth"'), 'the bridge is labelled for diagnostics');

  console.log('  ✅ The whole module body survives compilation.');
}

// ---------------------------------------------------------------------------
// End-to-end compilation
// ---------------------------------------------------------------------------

/**
 * Imported bridges are emitted and bound into the importing component only.
 */
function testEndToEndCompilation() {
  console.log('🧪 Testing end-to-end compilation...');

  const { bundle, error } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<div><span>{{ auth.displayName }}</span><button @click="auth.logout()">out</button></div>`,
    'src/components/plain.component.js': `<div>no bridges here</div>`,
    'src/pages/home.page.js': `<div><Navbar /><Plain /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, `the build should succeed: ${error && error.message}`);
  assert.ok(bundle.includes('const __avx_bridge_auth ='), 'the bridge is declared in the bundle');
  assert.ok(
    bundle.includes('{ ...bridges, "auth": __avx_bridge_auth }'),
    'the importing component receives the bridge under its local name',
  );
  assert.ok(
    /class Plain extends AvenxComponent[\s\S]*?super\([^)]*?, bridges,/.test(bundle),
    'a component that imports nothing gets no bridge bindings',
  );
  assert.ok(!bundle.includes('import auth from'), 'the import statement does not reach the bundle');
  assert.ok(
    !/"[^"]*import auth from/.test(bundle),
    'the import statement does not leak into the template string',
  );
  assert.ok(bundle.includes("app.registerBridge('auth', __avx_bridge_auth)"), 'the bridge is registered for devtools');

  console.log('  ✅ Imports become compile-time scope bindings.');
}

/**
 * A local alias is honoured, so two components may name the same bridge
 * differently.
 */
function testImportAliases() {
  console.log('🧪 Testing import aliases...');

  const { bundle, error } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/navbar.component.js': `import session from '../bridges/auth.bridge.js';

<div>{{ session.displayName }}</div>`,
    'src/components/sidebar.component.js': `import auth from '../bridges/auth.bridge.js';

<div>{{ auth.displayName }}</div>`,
    'src/pages/home.page.js': `<div><Navbar /><Sidebar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'the build should succeed');
  assert.ok(bundle.includes('"session": __avx_bridge_auth'), 'the aliased name is bound');
  assert.ok(bundle.includes('"auth": __avx_bridge_auth'), 'the plain name is bound');
  assert.strictEqual(
    (bundle.match(/const __avx_bridge_auth = /g) || []).length,
    1,
    'the bridge itself is only emitted once',
  );

  console.log('  ✅ Each component sees the bridge under the name it chose.');
}

/**
 * A bridge nothing imports never reaches the bundle.
 */
function testDeadBridgeElimination() {
  console.log('🧪 Testing unused bridge elimination...');

  const { bundle, output, error } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/bridges/unused.bridge.js': `import { bridge } from 'avenx-core/runtime';
export default bridge({ state: { nobody: 'imports me' } });`,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<div>{{ auth.displayName }}</div>`,
    'src/pages/home.page.js': `<div><Navbar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'the build should succeed');
  assert.ok(bundle.includes('__avx_bridge_auth'), 'the imported bridge is present');
  assert.ok(!bundle.includes('__avx_bridge_unused'), 'the unimported bridge is absent');
  assert.ok(!bundle.includes('nobody'), 'its state does not ship either');
  assert.ok(output.includes('not imported anywhere'), 'the build explains what it dropped');

  console.log('  ✅ Unused bridges are not bundled.');
}

/**
 * A bridge may import another bridge, and dependencies are emitted first.
 */
function testBridgeComposition() {
  console.log('🧪 Testing bridge composition...');

  const { bundle, error } = build({
    'src/bridges/http.bridge.js': `import { bridge } from 'avenx-core/runtime';
export default bridge({ state: { pending: 0 }, get(url) { return url; } });`,
    'src/bridges/auth.bridge.js': `import { bridge } from 'avenx-core/runtime';
import http from './http.bridge.js';
export default bridge({
  state: { user: null },
  load() { this.user = http.get('/me'); },
});`,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<div>{{ auth.user }}</div>`,
    'src/pages/home.page.js': `<div><Navbar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'the build should succeed');
  assert.ok(
    bundle.indexOf('const __avx_bridge_http') < bundle.indexOf('const __avx_bridge_auth'),
    'the dependency is emitted before the bridge that imports it',
  );
  assert.ok(bundle.includes('const http = __avx_bridge_http;'), 'the import is re-bound inside the IIFE');
  assert.ok(
    bundle.includes('__avx_bridge_http'),
    'a bridge reachable only through another bridge is still bundled',
  );

  console.log('  ✅ Bridges compose, in dependency order.');
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Mistyped members and events are reported with a suggestion.
 */
function testUsageWarnings() {
  console.log('🧪 Testing usage warnings...');

  const { output, error } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<action name="init">
  auth.on('logn', () => {});
</action>

<div>{{ auth.displaName }}</div>`,
    'src/pages/home.page.js': `<div><Navbar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'warnings do not stop the build');
  assert.ok(output.includes(AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_MEMBER), 'the unknown member is reported');
  assert.ok(output.includes('Did you mean "displayName"?'), 'the member typo gets a suggestion');
  assert.ok(output.includes(AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_EVENT), 'the unknown event is reported');
  assert.ok(output.includes('Did you mean "login"?'), 'the event typo gets a suggestion');

  console.log('  ✅ Typos are caught at build time with suggestions.');
}

/**
 * Correct usage produces no bridge warnings — the check must not cry wolf.
 */
function testNoFalsePositives() {
  console.log('🧪 Testing warning precision...');

  const { output, error } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<action name="init">
  auth.on('login', () => {});
  auth.logout();
</action>

<div>
  <span>{{ auth.displayName }}</span>
  <span>{{ auth.user?.name }}</span>
  <span>{{ auth.isLoggedIn ? 'in' : 'out' }}</span>
  <span>{{ auth.status }}</span>
</div>`,
    'src/pages/home.page.js': `<div><Navbar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'the build should succeed');
  assert.ok(!output.includes(AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_MEMBER), 'no false member warnings');
  assert.ok(!output.includes(AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_EVENT), 'no false event warnings');
  assert.ok(
    !output.includes(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE),
    'an imported bridge counts as declared in the template',
  );

  console.log('  ✅ Valid usage produces no warnings.');
}

/**
 * Importing a bridge module that does not exist stops the build.
 */
function testMissingBridgeIsFatal() {
  console.log('🧪 Testing missing bridge import...');

  const { error } = build({
    'src/components/navbar.component.js': `import ghost from '../bridges/ghost.bridge.js';

<div>{{ ghost.x }}</div>`,
    'src/pages/home.page.js': `<div><Navbar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.ok(error, 'the build fails');
  assert.strictEqual(error.code, AvenxErrorCodes.COMPILER_BRIDGE_NOT_FOUND, 'with the right code');
  assert.ok(error.message.includes('ghost.bridge.js'), 'naming the unresolved specifier');

  console.log('  ✅ A missing bridge is a build error.');
}

/**
 * Two bridge files that resolve to the same name stop the build.
 */
function testDuplicateNameIsFatal() {
  console.log('🧪 Testing duplicate bridge names...');

  const { error } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/global/auth.bridge.js': AUTH_BRIDGE,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.ok(error, 'the build fails');
  assert.strictEqual(error.code, AvenxErrorCodes.COMPILER_BRIDGE_DUPLICATE_NAME, 'with the right code');

  console.log('  ✅ Duplicate bridge names are a build error.');
}

/**
 * A bridge importing a module the bundler cannot inline stops the build,
 * instead of silently dropping the import as the old pipeline did.
 */
function testUnsupportedImportIsFatal() {
  console.log('🧪 Testing unsupported bridge imports...');

  const { error } = build({
    'src/bridges/auth.bridge.js': `import { bridge } from 'avenx-core/runtime';
import { helper } from '../utils/helper.js';
export default bridge({ state: { value: helper() } });`,
    'src/utils/helper.js': `export function helper() { return 1; }`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.ok(error, 'the build fails');
  assert.strictEqual(error.code, AvenxErrorCodes.COMPILER_BRIDGE_UNSUPPORTED_IMPORT, 'with the right code');
  assert.ok(error.message.includes('helper.js'), 'naming the offending import');

  console.log('  ✅ An un-inlinable import fails loudly instead of vanishing.');
}

/**
 * Bridges that import each other in a cycle stop the build.
 *
 * Regression: emission orders dependencies first, so a cycle previously
 * produced a bundle whose IIFE referenced a `const` declared later — a
 * temporal dead zone error at load, with a clean build log.
 */
function testCircularBridgeImportIsFatal() {
  console.log('🧪 Testing circular bridge imports...');

  const { error } = build({
    'src/bridges/a.bridge.js': `import { bridge } from 'avenx-core/runtime';
import b from './b.bridge.js';
export default bridge({ state: { x: 1 }, peek() { return b.y; } });`,
    'src/bridges/b.bridge.js': `import { bridge } from 'avenx-core/runtime';
import a from './a.bridge.js';
export default bridge({ state: { y: 2 }, peek() { return a.x; } });`,
    'src/components/c.component.js': `import a from '../bridges/a.bridge.js';

<div>{{ a.x }}</div>`,
    'src/pages/home.page.js': `<div><C /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.ok(error, 'the build fails instead of emitting a broken bundle');
  assert.strictEqual(error.code, AvenxErrorCodes.COMPILER_BRIDGE_CIRCULAR_IMPORT, 'with the right code');
  assert.ok(/a -> b -> a/.test(error.message), 'the message shows the cycle');

  console.log('  ✅ A bridge import cycle is a build error.');
}

/**
 * An isolated component may not import a bridge.
 */
function testIsolatedImportIsFatal() {
  console.log('🧪 Testing isolated contract enforcement...');

  const { output } = build({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/iso.component.js': `import auth from '../bridges/auth.bridge.js';
<contract isolated />
<div>{{ auth.displayName }}</div>`,
    'src/pages/home.page.js': `<div><Iso /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.ok(output.includes(AvenxErrorCodes.COMPILER_BRIDGE_ISOLATED_IMPORT), 'the violation is reported');
  assert.ok(output.includes('isolated'), 'the message explains the contract');

  console.log('  ✅ Isolated components may not import bridges.');
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

/**
 * Legacy class bridges keep working exactly as before, alongside new ones.
 */
function testLegacyCompatibility() {
  console.log('🧪 Testing legacy bridge compatibility...');

  const { bundle, error } = build({
    'src/global/theme.bridge.js': `import { AvenxBridge } from 'avenx-core/runtime';
export default class ThemeBridge extends AvenxBridge {
  constructor() { super(); this.mode = 'light'; }
}`,
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<div>{{ auth.displayName }} {{ ThemeBridge.mode }}</div>`,
    'src/pages/home.page.js': `<div><Navbar /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'both styles compile together');
  assert.ok(bundle.includes("app.registerBridge('ThemeBridge'"), 'the legacy bridge keeps its ambient registration');
  assert.ok(bundle.includes("app.registerBridge('auth', __avx_bridge_auth)"), 'the new bridge registers too');

  console.log('  ✅ Legacy and new bridges coexist.');
}

/**
 * Parsing a component on its own still resolves its bridge imports.
 */
function testStandaloneParsing() {
  console.log('🧪 Testing standalone component parsing...');

  const root = makeProject({
    'src/bridges/auth.bridge.js': AUTH_BRIDGE,
    'src/components/navbar.component.js': `import auth from '../bridges/auth.bridge.js';

<div>{{ auth.displayName }}</div>`,
  });

  const parser = new ComponentParser(new StyleProcessor({}, {}), [], {});
  const output = parser.parse(path.join(root, 'src/components/navbar.component.js'));

  assert.ok(
    output.includes('"auth": __avx_bridge_auth'),
    'a parser with no pre-supplied registry analyses the bridge on demand',
  );

  console.log('  ✅ Standalone parsing resolves bridges from disk.');
}

/**
 * The definitive check: run the compiled bundle and drive the UI through it.
 *
 * This exercises the whole chain at once — the bridge IIFE executing against
 * the bundled runtime, defineBridgeName labelling it, module-level constants
 * surviving compilation, the component receiving its binding, and a template
 * handler calling an action that re-renders the DOM.
 */
async function testCompiledBundleRuns() {
  console.log('🧪 Testing that the compiled bundle actually runs...');

  const { bundle, error } = build({
    'src/bridges/counter.bridge.js': `import { bridge } from 'avenx-core/runtime';

const STEP = 2;

export default bridge({
  state: { count: 0 },
  get doubled() { return this.count * STEP; },
  increment() { this.count++; },
});`,
    'src/components/display.component.js': `import counter from '../bridges/counter.bridge.js';

<div>[{{ counter.count }}/{{ counter.doubled }}]<button id="inc" @click="counter.increment()">+</button></div>`,
    'src/pages/home.page.js': `<div><Display /></div>`,
    'src/main.app.js': `const app = new AvenxApp({ target: '#app' });`,
  });

  assert.strictEqual(error, null, 'the build should succeed');

  // The bundle's entry point constructs an AvenxApp against '#app'.
  document.body.innerHTML = '<div id="app"></div><div id="bundle-root"></div>';
  const exported = new Function(`${bundle}\n; return { Display, counter: __avx_bridge_counter };`)();

  assert.strictEqual(exported.counter.$name, 'counter', 'the bridge is labelled at runtime');
  assert.strictEqual(exported.counter.doubled, 0, 'the module-level constant survived compilation');

  const component = new exported.Display({});
  component.mount(document.querySelector('#bundle-root'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const text = () => document.querySelector('#bundle-root').textContent;
  assert.ok(text().includes('[0/0]'), `the initial render reads the bridge, got "${text()}"`);

  document.querySelector('#inc').click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(text().includes('[1/2]'), `the action updated the DOM reactively, got "${text()}"`);
  assert.strictEqual(exported.counter.count, 1, 'the bridge holds the new state');
  assert.strictEqual(exported.counter.doubled, 2, 'the getter recomputed');

  component.unmount();
  console.log('  ✅ The compiled bundle runs and updates the DOM.');
}

/**
 * Runs the suite.
 */
async function run() {
  console.log('=== Bridge compiler tests ===\n');
  testAnalysis();
  testLegacyDetection();
  testScannerRobustness();
  testNameDerivation();
  testSpecifierResolution();
  testEventExtraction();
  testEmission();
  testEndToEndCompilation();
  testImportAliases();
  testDeadBridgeElimination();
  testBridgeComposition();
  testUsageWarnings();
  testNoFalsePositives();
  testMissingBridgeIsFatal();
  testDuplicateNameIsFatal();
  testUnsupportedImportIsFatal();
  testCircularBridgeImportIsFatal();
  testIsolatedImportIsFatal();
  testLegacyCompatibility();
  testStandaloneParsing();
  await testCompiledBundleRuns();
  console.log('\n✅ All bridge compiler tests passed!');
}

run().catch((error) => {
  console.error('❌ Bridge compiler tests failed:', error);
  process.exit(1);
});
