/**
 * Unused components, and their scoped CSS, must not reach the bundle.
 *
 * The behaviour is the same; where it is decided is not. `findUsedComponents`
 * used to scan templates and import statements with regular expressions and
 * guess which components an application reached — an approximation that could
 * keep dead code or, worse, drop something that was needed. The bundler answers
 * the same question from the module graph instead: a component ships when
 * something imports it, transitively from the entry.
 *
 * That is also why these fixtures register their components. A component is
 * instantiated through the registry `app.register` fills, so a component
 * nothing registers could never render; the old pipeline concatenated it into
 * the output anyway, where it was weight that could not be reached.
 *
 * The CSS half matters just as much and is easy to lose: every component is now
 * compiled so Atlas can describe the project as written, which means the style
 * processor has seen stylesheets the application does not use.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import AvenxCompiler from '../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing component tree-shaking through the module graph...');

const roots = [];

/**
 * Writes a project and builds it.
 * @param {Record<string, string>} files - Files keyed by path relative to the root.
 * @param {object} [options] - Extra compiler options.
 * @returns {{js: string, css: string, root: string}} The emitted artifacts.
 */
function buildProject(files, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-shake-comp-'));
  roots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', logging: { silent: true }, ...options }).build();

  return {
    js: fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf-8'),
    css: fs.readFileSync(path.join(root, 'dist/bundle.css'), 'utf-8'),
    root,
  };
}

/**
 * The files every case in this test shares.
 * @type {Record<string, string>}
 */
const PROJECT = {
  'src/components/header/header.component.js': '<div @css header>Header</div>',
  'src/components/header/header.component.css': '<@css>\nheader {\n  color: black;\n}\n</@css>',

  'src/components/user-card/user-card.component.js':
    "import Avatar from '../avatar/avatar.component.js';\n\n<div @css card><Avatar /></div>",
  'src/components/user-card/user-card.component.css': '<@css>\ncard {\n  border: 1px solid red;\n}\n</@css>',

  'src/components/avatar/avatar.component.js': '<div @css avatar>Avatar</div>',
  'src/components/avatar/avatar.component.css': '<@css>\navatar {\n  width: 50px;\n}\n</@css>',

  'src/components/unused-widget/unused-widget.component.js': '<div @css unused>Unused</div>',
  'src/components/unused-widget/unused-widget.component.css': '<@css>\nunused {\n  display: none;\n}\n</@css>',

  'src/components/dead-button/dead-button.component.js': '<div @css dead>Dead</div>',
  'src/components/dead-button/dead-button.component.css': '<@css>\ndead {\n  background: red;\n}\n</@css>',

  'src/pages/home.page.js': '<div>\n  <Header />\n  <UserCard />\n</div>',

  'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Header from './components/header/header.component.js';
import UserCard from './components/user-card/user-card.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Header', Header);
app.register('UserCard', UserCard);
app.mount('Home');
`,
};

try {
  // ------------------------------------------------------ shaking, by default ---
  {
    const { js, css } = buildProject(PROJECT);

    assert.ok(js.includes('class Header'), 'a registered component is bundled');
    assert.ok(js.includes('class UserCard'), 'so is the other one');
    assert.ok(js.includes('class Avatar'), 'and its transitive dependency');

    assert.ok(!js.includes('class UnusedWidget'), 'a component nothing imports is not bundled');
    assert.ok(!js.includes('class DeadButton'), 'nor is the other one');

    assert.ok(css.includes('color: black'), "the header's styles ship");
    assert.ok(css.includes('border: 1px solid red'), "the card's styles ship");
    assert.ok(css.includes('width: 50px'), "the transitive dependency's styles ship");
    assert.ok(!css.includes('display: none'), 'an unbundled component leaves no CSS behind');
    assert.ok(!css.includes('background: red'), 'nor does the other one');

    console.log('  ✅ Unused components and their scoped CSS are both left out');
  }

  // ----------------------------------------------------- shaking, turned off ---
  {
    // `treeShake: false` stops the bundler pruning modules that are in the
    // graph. It cannot put back a component nothing imports, because such a
    // component was never in the graph to prune -- and could not have rendered
    // either, since nothing registered it. The escape hatch existed to
    // compensate for a regex scan that could guess wrong; the graph cannot.
    const shaken = buildProject(PROJECT);
    const whole = buildProject(PROJECT, { treeShake: false });

    assert.ok(!whole.js.includes('class UnusedWidget'), 'a component nothing imports is absent either way');
    assert.ok(whole.js.length > shaken.js.length, 'but modules the graph reaches are no longer pruned');

    console.log('  ✅ `treeShake: false` stops pruning without resurrecting unreachable files');
  }

  // --------------------------------------------------- the runtime, too ---
  {
    // Shaking is one mechanism for the application and the framework alike.
    // The trace recorder is a runtime module a production build never
    // references, and turning shaking off brings it back -- which is the
    // clearest demonstration that the runtime is now an ordinary participant in
    // the graph rather than a prebuilt blob.
    const shaken = buildProject(PROJECT);
    const whole = buildProject(PROJECT, { treeShake: false });

    assert.ok(!shaken.js.includes('installTraceRecorder'), 'the recorder is shaken out of a production build');
    assert.ok(whole.js.includes('installTraceRecorder'), 'and comes back when nothing is pruned');
    assert.ok(!shaken.js.includes('Refusing to save a trace'), 'CLI-side trace code never shipped and still does not');
    console.log('  ✅ The same pass applies to runtime modules, not just application ones');
  }
} catch (error) {
  console.error('❌ Component tree-shaking tests failed:', error);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
console.log('🎉 All component tree-shaking tests passed successfully!');
