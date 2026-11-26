/**
 * @file pluginExampleDiagnostics.test.js
 * @description Every official plugin example must build without diagnostics.
 *
 * The examples are the reference applications the plugin guides point at. CI
 * already builds them, but a build that emits warnings still succeeds, which
 * is how AVX_W49, AVX_W59 and AVX_W68 went unnoticed in them before. This
 * builds each `plugins/<name>/example` with the real CLI and fails on any
 * AVX_W or AVX_C code in its output, quoting the offending lines.
 *
 * The examples build into their own `dist/`, which `.gitignore` already covers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN_PATH = path.join(REPO_ROOT, 'bin/avenx.js');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const DIAGNOSTIC = /AVX_[WC]\d{2}/g;

/**
 * Diagnostics an example may emit, keyed by plugin directory. Every entry
 * needs a reason. An entry whose code no longer appears fails the test, so a
 * fix cannot leave a stale exemption behind.
 */
const ALLOWLIST = {
  // Hello.component.css is written as CSS selectors (`.title { ... }`) rather
  // than named style blocks, so no `@css` directive reaches it: the same
  // defect the persistence example had. Known defect, to be fixed separately.
  'avenx-vite': [{ code: 'AVX_W49', reason: 'Hello.component.css uses selectors instead of style blocks' }],
};

for (const [plugin, entries] of Object.entries(ALLOWLIST)) {
  for (const entry of entries)
    assert.ok(entry.reason?.trim(), `allowlist entry ${plugin} ${entry.code} needs a reason`);
}

const examples = fs
  .readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ plugin: entry.name, directory: path.join(PLUGINS_DIR, entry.name, 'example') }))
  .filter(({ directory }) =>
    ['avenx.config.json', 'index.html'].some((file) => fs.existsSync(path.join(directory, file))),
  )
  .sort((a, b) => a.plugin.localeCompare(b.plugin));

assert.ok(examples.length > 0, 'no plugin examples found under plugins/*/example');

const failures = [];
for (const { plugin, directory } of examples) {
  const label = `plugins/${plugin}/example`;
  const failuresBefore = failures.length;
  const result = spawnSync(process.execPath, [BIN_PATH, 'build'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error || result.status !== 0) {
    failures.push(`${label}: build failed (${result.error || `exit ${result.status}`})\n${output}`);
    console.log(`FAIL ${label}`);
    continue;
  }

  const allowed = new Set((ALLOWLIST[plugin] || []).map((entry) => entry.code));
  const seen = new Set();
  const offending = [];
  for (const line of output.split(/\r?\n/)) {
    const codes = line.match(DIAGNOSTIC);
    if (!codes) continue;
    codes.forEach((code) => seen.add(code));
    if (codes.some((code) => !allowed.has(code))) offending.push(`    ${line.trim()}`);
  }
  if (offending.length) failures.push(`${label} emitted diagnostics:\n${offending.join('\n')}`);
  for (const code of allowed) {
    if (!seen.has(code)) failures.push(`${label} no longer emits ${code}: remove its ALLOWLIST entry`);
  }
  console.log(`${failures.length > failuresBefore ? 'FAIL' : 'PASS'} ${label}`);
}

assert.equal(failures.length, 0, `Plugin examples must build without diagnostics:\n\n${failures.join('\n\n')}`);
console.log(`All ${examples.length} plugin examples build without unexpected diagnostics.`);
