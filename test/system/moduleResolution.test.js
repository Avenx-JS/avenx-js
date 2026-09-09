/**
 * The invariant this whole migration exists to establish, checked against the
 * real CLI and real projects on disk:
 *
 *   avenx build reports success
 *     => every import in the application is present in the bundle
 *
 * The failure it replaces was not theoretical. `rewriteRuntimeImports` deleted
 * every import that was not the Avenx runtime entry, so a component importing
 * an npm package compiled to a green build whose action threw `ReferenceError`
 * the first time a user clicked. The build had no way to tell an import that
 * named a real package from one that named nothing, because it treated both the
 * same way: it removed them.
 *
 * Each case here is one shape of import. The green ones assert that the code
 * actually arrives; the red ones assert that the build stops and says why.
 * Nothing in between is acceptable, and "in between" is exactly where the old
 * pipeline lived.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { Window } from 'happy-dom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing module resolution end to end...');

const projects = [];

/**
 * Runs the Avenx CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, output: string}} Exit status and combined output.
 */
function avenx(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

/**
 * Scaffolds a project and writes the given files into it.
 * @param {Record<string, string>} files - Files keyed by path relative to the root.
 * @returns {string} The project root.
 */
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-resolution-'));
  projects.push(root);
  avenx(['init'], root);

  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/**
 * Writes a fake installed package into a project's node_modules.
 * @param {string} root - Project root.
 * @param {string} name - Package name.
 * @param {object} manifest - Fields to merge into its package.json.
 * @param {Record<string, string>} files - Files keyed by path inside the package.
 */
function installPackage(root, name, manifest, files) {
  const dir = path.join(root, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }, null, 2));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
}

/**
 * Reads a built bundle.
 * @param {string} root - Project root.
 * @returns {string} The bundle source.
 */
function bundleOf(root) {
  return fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf-8');
}

/**
 * Asserts that a bundle parses as the classic script a browser will load.
 * @param {string} code - The bundle source.
 */
function assertParses(code) {
  assert.doesNotThrow(() => new vm.Script(code, { filename: 'bundle.js' }), 'the emitted bundle parses');
}

try {
  // ============================================================ green paths ===

  {
    // An npm package imported from a component. The case that motivated all of
    // this: it used to build green and throw at runtime.
    const root = project({
      'src/components/greeter/greeter.component.js': `import { greet } from 'tiny-greeter';

<state message="" />

<action name="say"> message = greet('world'); </action>

<div><p class="out">{{ message }}</p><button @click="say()">go</button></div>`,
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Greeter from './components/greeter/greeter.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Greeter', Greeter);
app.mount('Greeter');
`,
    });
    installPackage(root, 'tiny-greeter', { main: 'index.js' }, {
      'index.js': 'export function greet(who) { return `hello ${who}`; }\n',
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `a component may import an npm package:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);
    assert.ok(bundle.includes('hello ${who}'), "the package's code is actually in the bundle");

    // The strongest form of the claim: run it. Under the old pipeline this
    // bundle parsed, mounted, and threw `ReferenceError: greet is not defined`
    // the first time the button was clicked -- which is precisely why "the
    // build succeeded" had to stop being the last word.
    const window = new Window({ url: 'http://localhost/' });
    window.document.write(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'));
    window.eval(bundle);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const button = window.document.querySelector('button');
    assert.ok(button, 'the component mounted');
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.strictEqual(
      window.document.querySelector('.out').textContent,
      'hello world',
      'the action called into the npm package and the DOM updated',
    );
    console.log('  ✅ An npm package imported from a component is bundled, and the application runs it');
  }

  {
    // The same from a bridge, which used to be refused outright with AVX_C09.
    const root = project({
      'src/bridges/cart.bridge.js': `import { bridge } from 'avenx-core/runtime';
import { total } from 'tiny-math';

export default bridge({
  state: { items: [2, 3] },
  get sum() { return total(this.items); },
});
`,
      'src/components/summary/summary.component.js': `import cart from '../../bridges/cart.bridge.js';

<div>{{ cart.sum }}</div>`,
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Summary from './components/summary/summary.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Summary', Summary);
`,
    });
    installPackage(root, 'tiny-math', { module: 'esm/index.js', main: 'cjs/index.js' }, {
      'esm/index.js': 'export function total(values) { return values.reduce((a, b) => a + b, 0); }\n',
      'cjs/index.js': 'module.exports = { total: () => 0 };\n',
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `a bridge may import an npm package:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);
    assert.ok(bundle.includes('values.reduce'), "the package's ES build is in the bundle");
    assert.ok(!bundle.includes('total: () => 0'), 'and its CommonJS build is not: `module` wins over `main`');
    console.log('  ✅ An npm package imported from a bridge is resolved, preferring its ES build');
  }

  {
    // A CommonJS package, which a browser cannot load and the old pipeline
    // could not have inlined either.
    const root = project({
      'src/components/legacy/legacy.component.js': `import stamp from 'legacy-stamp';

<state label="" />

<action name="fill"> label = stamp.make(); </action>

<div>{{ label }}</div>`,
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Legacy from './components/legacy/legacy.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Legacy', Legacy);
`,
    });
    installPackage(root, 'legacy-stamp', { main: 'index.js' }, {
      'index.js': "const prefix = require('./prefix.js');\nmodule.exports = { make: () => prefix + '-stamped' };\n",
      'prefix.js': "module.exports = 'avenx';\n",
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `a CommonJS package builds:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);
    assert.ok(bundle.includes("'-stamped'"), 'the CommonJS module is bundled');
    assert.ok(bundle.includes("'avenx'"), 'and so is what it requires');
    console.log('  ✅ A CommonJS package is bundled, including its require() graph');
  }

  {
    // A local helper module, and one imported through a directory index.
    const root = project({
      'src/utils/index.js': "export { shout } from './shout.js';\nexport const UNUSED_HERE = 'dead';\n",
      'src/utils/shout.js': 'export function shout(value) { return `${value}!`; }\n',
      'src/components/loud/loud.component.js': `import { shout } from '../../utils/index.js';

<state text="" />

<action name="say"> text = shout('hi'); </action>

<div>{{ text }}</div>`,
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Loud from './components/loud/loud.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Loud', Loud);
`,
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `a local helper module builds:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);
    assert.ok(bundle.includes('`${value}!`'), 'the helper is bundled');
    console.log('  ✅ A local module, reached through a directory index, is bundled');
  }

  {
    // An import that is never used. It still resolves, because an unresolvable
    // import is a mistake whether or not the binding is read.
    const root = project({
      'src/components/quiet/quiet.component.js': `import { helper } from '../../utils/helper.js';

<state count="0" />

<div>{{ count }}</div>`,
      'src/utils/helper.js': "export function helper() { return 'unused'; }\n",
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Quiet from './components/quiet/quiet.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Quiet', Quiet);
`,
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `an unused import still resolves:\n${build.output}`);
    assertParses(bundleOf(root));
    console.log('  ✅ An unused import is resolved rather than assumed harmless');
  }

  {
    // The imports the compiler writes for the developer: every page under
    // src/pages, and every bridge something imports.
    const root = project({
      'src/pages/home.page.js': '<state title="Home" />\n\n<div><h1>{{ title }}</h1></div>',
      'src/pages/about.page.js': '<state title="About" />\n\n<div><h1>{{ title }}</h1></div>',
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

app.initRouter({ '': 'Home', '#/about': 'About' });
`,
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `pages are discovered and registered:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);
    assert.ok(/registerPage\("Home"/.test(bundle), 'the home page is registered');
    assert.ok(/registerPage\("About"/.test(bundle), 'and so is the other one');
    assert.ok(bundle.includes('class Home extends'), 'the page class is in the bundle it was registered from');
    console.log('  ✅ Generated page imports and registrations resolve like any other');
  }

  {
    // A dynamic import. Avenx does not emit separate chunks yet, so the module
    // is bundled eagerly and `import()` resolves immediately with its
    // namespace. That is the correct observable behaviour for an unsplit
    // build: what is missing is a chunk boundary, not the semantics. Leaving
    // the `import()` in place would be the one remaining way a specifier could
    // reach a browser unresolved, because the bundle is a classic script.
    const root = project({
      'src/components/lazy/lazy.component.js': `<state text="" />

<action name="load"> text = 'ready'; </action>

<div><p class="out">{{ text }}</p></div>`,
      'src/utils/heavy.js': "export const heavy = 'loaded lazily';\nexport default 'heavy default';\n",
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Lazy from './components/lazy/lazy.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Lazy', Lazy);

import('./utils/heavy.js').then((mod) => {
  globalThis.__avxLazy = { named: mod.heavy, fallback: mod.default };
});
`,
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `a dynamic import builds:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);
    assert.ok(bundle.includes("'loaded lazily'"), 'the dynamically imported module is bundled');
    assert.ok(!/\bimport\s*\(\s*['"]/.test(bundle), 'and no import() survives into the classic script');

    const window = new Window({ url: 'http://localhost/' });
    window.document.write(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'));
    window.eval(bundle);
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Compared field by field: the object was created inside the window's own
    // realm, so its prototype is not this realm's Object.prototype.
    assert.ok(window.__avxLazy, 'the dynamic import settled');
    assert.strictEqual(window.__avxLazy.named, 'loaded lazily', 'a named export resolves');
    assert.strictEqual(window.__avxLazy.fallback, 'heavy default', 'and so does the default');
    console.log('  ✅ A dynamic import resolves to the bundled module namespace');
  }

  // ============================================================== red paths ===

  /**
   * Every way an import can fail, and the code it must fail with.
   * @type {Array<{label: string, files: Record<string, string>, code: string, mentions: string}>}
   */
  const failures = [
    {
      label: 'a package that is not installed',
      files: {
        'src/components/broken/broken.component.js': "import { format } from 'not-installed';\n\n<div>{{ 1 }}</div>",
      },
      code: 'AVX_C17',
      mentions: 'not-installed',
    },
    {
      label: 'a local module that does not exist',
      files: {
        'src/components/broken/broken.component.js': "import { thing } from '../../utils/gone.js';\n\n<div>{{ 1 }}</div>",
      },
      code: 'AVX_C17',
      mentions: 'gone.js',
    },
    {
      label: 'a name the target does not export',
      files: {
        'src/components/broken/broken.component.js': "import { missing } from '../../utils/real.js';\n\n<div>{{ 1 }}</div>",
        'src/utils/real.js': 'export const present = 1;\n',
      },
      code: 'AVX_C18',
      mentions: 'missing',
    },
    {
      label: 'a Node builtin, which no browser can load',
      files: {
        'src/components/broken/broken.component.js': "import fs from 'fs';\n\n<div>{{ 1 }}</div>",
      },
      code: 'AVX_C17',
      mentions: 'builtin',
    },
    {
      label: 'a dynamic import with a computed specifier',
      files: {
        'src/components/broken/broken.component.js': '<div>{{ 1 }}</div>',
        'src/utils/loader.js': "const name = './thing.js';\nexport const load = () => import(name);\n",
      },
      extraMain: "import { load } from './utils/loader.js';\nvoid load;\n",
      code: 'AVX_C17',
      mentions: 'computed specifier',
    },
    {
      label: 'a stylesheet, which Avenx does not bundle',
      files: {
        'src/components/broken/broken.component.js': "import '../../styles/theme.css';\n\n<div>{{ 1 }}</div>",
        'src/styles/theme.css': 'body { color: red; }\n',
      },
      code: 'AVX_C17',
      mentions: 'does not bundle',
    },
  ];

  for (const failure of failures) {
    const root = project({
      ...failure.files,
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Broken from './components/broken/broken.component.js';
${failure.extraMain || ''}
const app = new AvenxApp({ target: '#app' });
app.register('Broken', Broken);
`,
    });

    const build = avenx(['build'], root);
    assert.notStrictEqual(build.status, 0, `${failure.label} must fail the build:\n${build.output}`);
    assert.ok(build.output.includes(failure.code), `${failure.label} is reported as ${failure.code}:\n${build.output}`);
    assert.ok(
      build.output.includes(failure.mentions),
      `${failure.label} names what went wrong:\n${build.output}`,
    );
    assert.ok(
      !build.output.includes('Build successful'),
      `${failure.label} must not also report success:\n${build.output}`,
    );
    assert.ok(!fs.existsSync(path.join(root, 'dist', 'bundle.js')), 'and nothing is written');
  }
  console.log(`  ✅ All ${failures.length} unresolvable-import shapes fail the build with a coded diagnostic`);

  // ======================================================= bundle integrity ===

  {
    // The property the whole file is about, asserted directly: nothing in a
    // successful bundle refers to a module that is not in it.
    const root = project({
      'src/components/deep/deep.component.js': `import { chain } from '../../utils/a.js';

<state value="" />

<action name="run"> value = chain(); </action>

<div>{{ value }}</div>`,
      'src/utils/a.js': "import { b } from './b.js';\nexport function chain() { return b() + '-a'; }\n",
      'src/utils/b.js': "import { c } from './c.js';\nexport function b() { return c() + '-b'; }\n",
      'src/utils/c.js': "export function c() { return 'c'; }\n",
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Deep from './components/deep/deep.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Deep', Deep);
`,
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `a chain of local modules builds:\n${build.output}`);

    const bundle = bundleOf(root);
    assertParses(bundle);

    for (const marker of ["'-a'", "'-b'", "return 'c'"]) {
      assert.ok(bundle.includes(marker), `${marker} reached the bundle`);
    }

    // No `import` or `require` survives into the emitted classic script: every
    // specifier was resolved into the graph rather than left for a browser that
    // has no module loader for it.
    assert.ok(!/^\s*import\s/m.test(bundle), 'no import declaration survives into the bundle');
    assert.ok(!/\brequire\s*\(\s*['"][^'"]*['"]\s*\)/.test(bundle.replace(/function require\(id\)[\s\S]*?\n/g, '')),
      'no unresolved require() survives into the bundle');

    console.log('  ✅ A successful bundle contains every module it refers to, and no unresolved specifier');
  }
} finally {
  for (const root of projects) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('✅ All module resolution tests passed!');
