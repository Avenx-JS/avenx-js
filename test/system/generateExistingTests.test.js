// @avenx-serial

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const binPath = path.join(repoRoot, 'bin/avenx.js');
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-existing-tests-'));
const env = { ...process.env, NO_COLOR: '1', GIT_CEILING_DIRECTORIES: path.dirname(root) };

/**
 * Runs the Avenx CLI in the temporary project directory.
 * @param {string[]} args - CLI arguments.
 * @returns {{stdout: string, stderr: string}} Command output.
 */
function run(args) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Writes a file relative to the temporary project directory.
 * @param {string} relative - Relative file path.
 * @param {string} content - File contents.
 */
function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * Reads a file relative to the temporary project directory.
 * @param {string} relative - Relative file path.
 * @returns {string} File contents.
 */
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

try {
  run(['init', '--yes', '--layout', 'routing']);

  // 1. Routing scaffold `about` page: no route params, custom markup.
  run(['generate', 'test', 'about']);
  const aboutTest = read('src/pages/about.page.test.js');
  assert.doesNotMatch(aboutTest, /createMockRouter/, 'about has no route params');
  assert.doesNotMatch(aboutTest, /Welcome to the About page\./, 'must not stamp scaffold assertions');

  // 2. Hand-written page without route params.
  write(
    'src/pages/faq.page.js',
    '<section>\n  <h2>Frequently Asked Questions</h2>\n  <p>Answers here.</p>\n</section>\n',
  );
  run(['generate', 'test', 'page', 'faq']);
  const faqTest = read('src/pages/faq.page.test.js');
  assert.doesNotMatch(faqTest, /createMockRouter/);
  assert.match(faqTest, /container\.children\.length/);

  // 3. Hand-written page with route params declared in main.app.js.
  const mainApp = read('src/main.app.js');
  write(
    'src/main.app.js',
    mainApp.replace("'#/about': 'About',", "'#/about': 'About',\n  '#/orders/:orderId': 'OrderDetail',"),
  );
  write(
    'src/pages/order-detail.page.js',
    '<div>\n  <h2>Order {{ $route.params.orderId }}</h2>\n</div>\n',
  );
  run(['generate', 'test', 'page', 'order-detail']);
  const orderTest = read('src/pages/order-detail.page.test.js');
  assert.match(orderTest, /createMockRouter/);
  assert.match(orderTest, /orderId: '42'/);
  assert.match(orderTest, /hash: '#\/orders\/42'/);

  // 4. Hand-written bridge with multiple state keys and a zero-arg mutating action.
  write(
    'src/global/counter.bridge.js',
    "import { bridge } from 'avenx-core/runtime';\n\n" +
      'export default bridge({\n' +
      '  state: {\n' +
      '    count: 0,\n' +
      "    label: 'ready',\n" +
      '    items: [],\n' +
      '  },\n' +
      '  increment() {\n' +
      '    this.count += 1;\n' +
      '  },\n' +
      '});\n',
  );
  run(['generate', 'test', 'bridge', 'counter']);
  const counterTest = read('src/global/counter.bridge.test.js');
  assert.match(counterTest, /expect\(counter\.count\)\.toBe\(0\)/);
  assert.match(counterTest, /expect\(counter\.label\)\.toBe\('ready'\)/);
  assert.match(counterTest, /expect\(counter\.items\)\.toEqual\(\[\]\)/);
  assert.match(counterTest, /await counter\.increment\(\)/);

  // 5. Hand-written guard with custom canActivate logic.
  write(
    'src/guards/role.guard.js',
    "import { AvenxGuard } from 'avenx-core/runtime';\n\n" +
      'export default class RoleGuard extends AvenxGuard {\n' +
      '  canActivate(to) {\n' +
      "    return to.hash === '#/admin' ? '#/forbidden' : true;\n" +
      '  }\n' +
      '}\n',
  );
  run(['generate', 'test', 'guard', 'role']);
  const roleTest = read('src/guards/role.guard.test.js');
  assert.match(roleTest, /new GuardContext\(\)/);
  assert.match(roleTest, /expect\(decision\)\.toBeDefined\(\)/);

  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(modules, '@avenx'), { recursive: true });
  for (const [name, target] of [
    ['avenx-core', repoRoot],
    ['@avenx/vite', path.join(repoRoot, 'plugins/avenx-vite')],
    ['vitest', path.join(repoRoot, 'node_modules/vitest')],
    ['happy-dom', path.join(repoRoot, 'node_modules/happy-dom')],
  ]) {
    fs.symlinkSync(target, path.join(modules, name), 'junction');
  }

  const configMatch = aboutTest.match(/vitest\.config\.js includes:\r?\n([\s\S]*?)\r?\n \* 3\. Run:/);
  assert.ok(configMatch);
  write('vitest.config.js', `${configMatch[1].replace(/^ \*\s{6}/gm, '')}\n`);

  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const supportsVitest = nodeMajor === 24 || nodeMajor >= 26 || (nodeMajor === 22 && nodeMinor >= 12);
  if (supportsVitest) {
    const files = [
      'src/pages/about.page.test.js',
      'src/pages/faq.page.test.js',
      'src/pages/order-detail.page.test.js',
      'src/global/counter.bridge.test.js',
      'src/guards/role.guard.test.js',
    ];
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.js', ...files],
      { cwd: root, env, encoding: 'utf8', timeout: 120000 },
    );
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.equal(result.status, 0, `Vitest failed:\n${output}`);
    assert.match(output, /Test Files\s+5 passed/, output);
    assert.match(output, /Tests\s+6 passed/, output);
    console.log('Non-scaffold generate test targets (about, page, bridge, guard) passed under Vitest');
  } else {
    console.log(`Skipping the Vitest run: Vitest 5 does not support Node ${process.versions.node}`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
