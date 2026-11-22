/**
 * `avenx inspect --json` and `avenx env --json` emit the same data as their
 * text output, as a single parseable JSON document.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { runInspect } from '../../bin/commands/inspect.js';
import { runEnv } from '../../bin/commands/env.js';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-json-unit-'));

/**
 * Runs a command function and returns what it printed to stdout.
 * @param {() => void} fn
 * @returns {string}
 */
function capture(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return logs.join('\n');
}

console.log('🧪 Testing --json output for inspect and env...');

const savedEnv = { ...process.env };
try {
  const srcDir = path.join(TEST_DIR, 'src');
  fs.mkdirSync(path.join(srcDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'components', 'header'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'components', 'unused-btn'), { recursive: true });
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
    `<state title="Home" />\n<Header />\n<div>{{ title }}</div>\n`,
  );
  fs.writeFileSync(path.join(srcDir, 'pages', 'user.page.js'), `<div>User</div>\n`);
  fs.writeFileSync(path.join(srcDir, 'components', 'header', 'header.component.js'), `<h1>Site</h1>\n`);
  fs.writeFileSync(path.join(srcDir, 'components', 'unused-btn', 'unused-btn.component.js'), `<button>x</button>\n`);
  fs.writeFileSync(
    path.join(srcDir, 'guards', 'auth.guard.js'),
    `import { AvenxGuard } from 'avenx-core/runtime';\n\nexport default class AuthGuard extends AvenxGuard {\n  canActivate() {\n    return true;\n  }\n}\n`,
  );

  // inspect --json
  const inspect = JSON.parse(capture(() => runInspect({ baseDir: TEST_DIR, config: { srcDir: 'src' } }, ['--json'])));
  assert.strictEqual(inspect.srcDir, 'src', 'inspect JSON names the source directory');
  const home = inspect.pages.find((page) => page.name === 'Home');
  assert.deepStrictEqual(
    { route: home && home.route, file: home && home.file },
    { route: '/home', file: 'src/pages/home.page.js' },
    'inspect JSON gives each page its route and file',
  );
  const unused = inspect.components.find((component) => component.name === 'UnusedBtn');
  assert.strictEqual(unused && unused.unused, true, 'inspect JSON flags a component nothing renders');
  const guard = inspect.guards.find((entry) => entry.name === 'AuthGuard');
  assert.deepStrictEqual(guard && guard.routes, ['/user/:id'], 'inspect JSON lists the routes a guard protects');

  // env --json
  process.env.AVX_PUBLIC_API_URL = 'https://example.test';
  fs.writeFileSync(path.join(TEST_DIR, '.env'), 'AVX_PUBLIC_SITE=demo\nDB_PASSWORD=supersecret\n');
  delete process.env.AVX_PUBLIC_SITE;
  delete process.env.DB_PASSWORD;
  const env = JSON.parse(capture(() => runEnv({ baseDir: TEST_DIR, config: { mode: 'production' } }, ['--json'])));
  assert.strictEqual(env.mode, 'production', 'env JSON reports the mode');
  assert.strictEqual(env.envFile.exists, true, 'env JSON reports the .env file');
  assert.strictEqual(env.configFile, null, 'env JSON reports no config file when there is none');
  const publicSite = env.public.find((entry) => entry.key === 'AVX_PUBLIC_SITE');
  assert.deepStrictEqual(
    publicSite && { value: publicSite.value, source: publicSite.source },
    { value: 'demo', source: 'env-file' },
    'env JSON gives a public variable its value and source',
  );
  const secret = env.system.find((entry) => entry.key === 'DB_PASSWORD');
  assert.ok(secret && secret.value !== 'supersecret', 'env JSON masks system values');

  console.log('✅ Unit test for --json output of inspect and env passed successfully!');
} catch (err) {
  console.error('❌ Unit test failed:', err);
  process.exitCode = 1;
} finally {
  process.env = savedEnv;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
