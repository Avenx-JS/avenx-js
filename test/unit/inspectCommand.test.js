/**
 * `avenx inspect` reads the compiler's semantic model rather than scanning
 * source files with regular expressions.
 *
 * Two behaviours changed with that, deliberately:
 *
 * - Units are named the way the compiler names them, from the file name. A
 *   page in `home.page.js` registers as `Home`, so that is what inspect shows.
 *   The old scanner reported whatever `class X` it found in the file, which
 *   could be a name the router would never resolve.
 * - "Unused" now means nothing renders or imports it, rather than its name not
 *   appearing as a substring somewhere else.
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { runInspect } from '../../bin/commands/inspect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, 'inspect-unit-test-project');

/**
 * Creates an empty project directory.
 * @returns {void}
 */
function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

/**
 * Removes the project directory.
 * @returns {void}
 */
function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

/**
 * Runs inspect against the fixture, capturing what it prints.
 * @returns {string} The captured output.
 */
function captureInspect() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };
  try {
    runInspect({ baseDir: TEST_DIR, config: { srcDir: 'src' } });
  } finally {
    console.log = originalLog;
  }
  return logs.join('\n');
}

console.log('🧪 Testing bin/commands/inspect.js unit logic...');

try {
  setup();

  const srcDir = path.join(TEST_DIR, 'src');
  fs.mkdirSync(path.join(srcDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'components', 'header'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'components', 'unused-btn'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'bridges'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'guards'), { recursive: true });

  fs.writeFileSync(
    path.join(srcDir, 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';
import AuthGuard from './guards/auth.guard.js';

const app = new AvenxApp({ target: '#app' });
app.initRouter({
  '': 'Home',
  '#/home': 'Home',
  '#/user/:id': { page: 'User', guards: [AuthGuard] }
});
`,
  );

  fs.writeFileSync(
    path.join(srcDir, 'pages', 'home.page.js'),
    `<state title="Home" />
<Header />
<div>{{ title }}</div>
`,
  );

  fs.writeFileSync(path.join(srcDir, 'pages', 'user.page.js'), `<div>User</div>\n`);

  fs.writeFileSync(
    path.join(srcDir, 'components', 'header', 'header.component.js'),
    `<state label="Site" />
<h1>{{ label }}</h1>
`,
  );

  fs.writeFileSync(
    path.join(srcDir, 'components', 'unused-btn', 'unused-btn.component.js'),
    `<button>click</button>\n`,
  );

  fs.writeFileSync(
    path.join(srcDir, 'bridges', 'auth.bridge.js'),
    `import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { user: null },
});
`,
  );

  fs.writeFileSync(
    path.join(srcDir, 'guards', 'auth.guard.js'),
    `import { AvenxGuard } from 'avenx-core/runtime';

export default class AuthGuard extends AvenxGuard {
  canActivate() {
    return true;
  }
}
`,
  );

  const output = captureInspect();

  assert.ok(output.includes('📦 Avenx Project Hierarchy (src/)'), 'Header matches expected title');

  assert.ok(output.includes('📄 Pages (2)'), 'Pages category count matches');
  assert.ok(output.includes('Home (/home) -> src/pages/home.page.js'), 'Home page shows its route');
  assert.ok(output.includes('User (/user/:id) -> src/pages/user.page.js'), 'User page shows its parameterised route');

  assert.ok(output.includes('🧩 Components (2)'), 'Components category count matches');
  assert.ok(
    output.includes('Header -> src/components/header/header.component.js'),
    'A rendered component is listed',
  );
  assert.ok(
    !output.includes('Header -> src/components/header/header.component.js (⚠️ Unused)'),
    'A component rendered by a page is not marked unused',
  );
  assert.ok(
    output.includes('UnusedBtn -> src/components/unused-btn/unused-btn.component.js (⚠️ Unused)'),
    'A component nothing renders is marked unused',
  );

  assert.ok(output.includes('🌉 Bridges (1)'), 'Bridges category count matches');
  assert.ok(
    output.includes('auth -> src/bridges/auth.bridge.js (⚠️ Not imported anywhere)'),
    'A bridge nothing imports is flagged, which the old substring scan could not tell',
  );

  assert.ok(output.includes('🛡️  Guards (1)'), 'Guards are reported');
  assert.ok(
    output.includes('AuthGuard -> src/guards/auth.guard.js (/user/:id)'),
    'A guard names the routes it protects',
  );

  // A project the compiler would reject must still be inspectable: that is
  // often exactly when someone runs this command.
  fs.writeFileSync(path.join(srcDir, 'bridges', 'broken.bridge.js'), `export class NotABridge {}\n`);
  const degraded = captureInspect();
  assert.ok(degraded.includes('📦 Avenx Project Hierarchy'), 'inspect still reports on a project that cannot compile');

  console.log('✅ Unit test for bin/commands/inspect.js passed successfully!');
} catch (err) {
  console.error('❌ Unit test failed:', err);
  process.exit(1);
} finally {
  cleanup();
}
