/**
 * Runs `avenx inspect --json` and `avenx env --json` as subprocesses against the
 * atlas fixture and parses both payloads, the way a CI step would.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');
const fixture = path.join(repoRoot, 'test/fixtures/atlas-app');

console.log('🧪 Testing avenx inspect --json and avenx env --json as subprocesses...');

/**
 * Runs the CLI in a project directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Where to run it.
 * @param {Record<string, string>} [extraEnv] - Extra environment variables.
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function avenx(args, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-json-system-'));

try {
  // ── inspect --json ────────────────────────────────────────────────────────
  {
    const result = avenx(['inspect', '--json'], fixture);
    assert.strictEqual(result.status, 0, `avenx inspect --json failed:\n${result.stderr}`);
    const doc = JSON.parse(result.stdout);
    assert.strictEqual(doc.srcDir, 'src', 'inspect JSON names the source directory');
    assert.strictEqual(doc.pages.length, 2, 'inspect JSON lists both pages');
    assert.strictEqual(doc.components.length, 3, 'inspect JSON lists all three components');
    assert.strictEqual(doc.bridges.length, 1, 'inspect JSON lists the bridge');
    assert.strictEqual(doc.guards.length, 1, 'inspect JSON lists the guard');
    assert.ok(
      doc.pages.some((page) => page.route === '/checkout' && typeof page.file === 'string'),
      'inspect JSON gives the checkout page its route and file',
    );
    assert.ok(
      doc.guards.every((guard) => Array.isArray(guard.routes)),
      'inspect JSON gives each guard its routes as an array',
    );
    console.log('  ✅ inspect --json parses and matches the fixture hierarchy');
  }

  // ── env --json ────────────────────────────────────────────────────────────
  {
    const project = path.join(tmp, 'app');
    fs.cpSync(fixture, project, { recursive: true });
    fs.writeFileSync(path.join(project, '.env'), 'AVX_PUBLIC_FROM_FILE=file-value\nDB_PASSWORD=supersecret\n');

    const result = avenx(['env', '--json'], project, { AVX_PUBLIC_FROM_SHELL: 'shell-value' });
    assert.strictEqual(result.status, 0, `avenx env --json failed:\n${result.stderr}`);
    const doc = JSON.parse(result.stdout);
    assert.strictEqual(doc.envFile.exists, true, 'env JSON reports the .env file');
    assert.ok(doc.configFile && doc.configFile.endsWith('avenx.config.json'), 'env JSON reports the config file');

    const fromFile = doc.public.find((entry) => entry.key === 'AVX_PUBLIC_FROM_FILE');
    assert.deepStrictEqual(
      fromFile && { value: fromFile.value, source: fromFile.source },
      { value: 'file-value', source: 'env-file' },
      'a .env public value is sourced from the env file',
    );
    const fromShell = doc.public.find((entry) => entry.key === 'AVX_PUBLIC_FROM_SHELL');
    assert.deepStrictEqual(
      fromShell && { value: fromShell.value, source: fromShell.source },
      { value: 'shell-value', source: 'process' },
      'a value set in the shell is sourced from the process',
    );
    const secret = doc.system.find((entry) => entry.key === 'DB_PASSWORD');
    assert.ok(secret && secret.value !== 'supersecret', 'env JSON masks system values');
    console.log('  ✅ env --json parses and reports the source of each value');
  }

  console.log('✅ inspect --json and env --json system tests passed!');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
