import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-composition-'));

/**
 * Writes one fixture file.
 * @param {string} name - Relative path.
 * @param {string} contents - File contents.
 */
function write(name, contents) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/**
 * Runs the real CLI and requires a successful command.
 * @param {string[]} args - Command and flags.
 * @returns {string} Standard output.
 */
function cli(...args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

/**
 * Checks measured bytes against the exact emitted artifact, not another report.
 * @param {string} flag - Mode switch.
 * @param {string} mode - Expected resolved mode.
 * @returns {object} Verified report.
 */
function check(flag, mode) {
  const build = cli('build', flag);
  const { bundle: report, summary } = JSON.parse(cli('stats', flag, '--json'));
  const code = fs.readFileSync(path.join(root, 'output/app.js'));
  assert.equal(report.available, true);
  assert.equal(report.mode, mode);
  assert.equal(report.file, 'output/app.js');
  assert.equal(report.bytes, code.length);
  assert.equal(report.gzipBytes, gzipSync(code).length);
  assert.ok(build.includes(`app.js: ${(code.length / 1024).toFixed(2)} KB`));
  assert.equal(report.modules.reduce((sum, row) => sum + row.bytes, report.overhead.bytes), code.length);
  assert.equal(report.directories.reduce((sum, row) => sum + row.bytes, report.overhead.bytes), code.length);
  assert.ok(Math.abs(report.modules.reduce((sum, row) => sum + row.share, report.overhead.share) - 100) < 1e-9);
  assert.ok(report.modules.every((row) => !row.file.includes('\\') && !path.isAbsolute(row.file)));
  assert.ok(report.modules.some((row) => row.file === 'src/main.app.js'));
  assert.ok(report.directories.some((row) => row.directory === 'Application code'));
  assert.ok(report.directories.some((row) => row.directory === 'lib/core/runtime'));
  assert.ok(!report.modules.some((row) => row.file.endsWith('/unused.js')), 'unused import is shaken out');
  assert.ok(report.modulesShaken > 0);
  assert.equal(report.modulesInGraph, report.modulesEmitted + report.modulesShaken);
  assert.ok(summary.totalFiles > 0, 'source metrics remain available');
  const text = cli('stats', flag);
  for (const label of ['Runtime Bundle Composition', mode, 'By directory', 'Application code', 'Bundle overhead', 'Whole-bundle gzip:', 'Linked capabilities:', 'Shaken out:']) {
    assert.ok(text.includes(label), label);
  }
  return report;
}

try {
  write('avenx.config.json', JSON.stringify({ distDir: 'output', outputName: 'app' }));
  write('src/components/hello.component.js', '<div>Hello 上海 😀</div>');
  write('src/unused.js', 'export const unused = 123;');
  write('src/values.js', "export const value = 1;\nexport { unused } from './unused.js';");
  write('src/main.app.js', [
    "import { AvenxApp } from 'avenx-core/runtime';",
    "import Hello from './components/hello.component.js';",
    "import { value } from './values.js'; void value;",
    "const app = new AvenxApp({ target: '#app' });",
    "app.register('Hello', Hello); app.mount('Hello');",
  ].join('\n'));
  const missing = JSON.parse(cli('stats', '--prod', '--json')).bundle;
  assert.equal(missing.available, false);
  assert.match(missing.message, /avenx build --prod/);
  assert.ok(!fs.existsSync(path.join(root, 'output/app.js')), 'stats does not build as a side effect');

  const production = check('--prod', 'production');
  assert.ok(!production.capabilities.includes('expression interpreter'));
  assert.ok(!production.capabilities.includes('trace recorder'));
  const wrongMode = JSON.parse(cli('stats', '--dev', '--json')).bundle;
  assert.equal(wrongMode.available, false);
  assert.match(wrongMode.message, /last build is production.*avenx build --dev/);
  const development = check('--dev', 'development');
  assert.ok(development.capabilities.includes('expression interpreter'));
  assert.ok(development.capabilities.includes('trace recorder'));
  assert.ok(development.bytes > production.bytes);

  fs.appendFileSync(path.join(root, 'output/app.js'), '\n// replaced');
  assert.match(JSON.parse(cli('stats', '--dev', '--json')).bundle.reason, /has changed/);
  write('output/app.stats.json', '{');
  assert.equal(JSON.parse(cli('stats', '--dev', '--json')).bundle.available, false);
  write('output/app.stats.json', '{}');
  assert.match(JSON.parse(cli('stats', '--dev', '--json')).bundle.reason, /invalid/);
  console.log('Bundle composition matches real production/development output and refuses stale metadata.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
