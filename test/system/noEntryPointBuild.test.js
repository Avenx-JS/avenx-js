import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-entry-build-'));
function cli(...args) {
  const result = spawnSync(process.execPath, [bin, ...args], {cwd: root, encoding: 'utf8'});
  return {status: result.status, output: result.stdout + result.stderr};
}
try {
  assert.equal(cli('init').status, 0);
  assert.equal(cli('generate', 'component', 'solo').status, 0);
  const entryFile = path.join(root, 'src/main.app.js');
  const entry = fs.readFileSync(entryFile, 'utf8');
  const unmounted = entry.replace(/^.*\.mount\([^\n]*$/gm, '');
  fs.writeFileSync(entryFile, unmounted);
  const build = cli('build');
  assert.equal(build.status, 0, build.output);
  assert.match(build.output, /AVX_W78/);
  const configFile = path.join(root, 'avenx.config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.warnings = { ...config.warnings, AVX_W78: 'error' };
  fs.writeFileSync(configFile, JSON.stringify(config));
  assert.notEqual(cli('build').status, 0);
  config.warnings.AVX_W78 = 'off';
  fs.writeFileSync(configFile, JSON.stringify(config));
  assert.doesNotMatch(cli('build').output, /AVX_W78/);
  fs.writeFileSync(entryFile, entry);
  config.warnings.AVX_W78 = 'error';
  fs.writeFileSync(configFile, JSON.stringify(config));
  const mounted = cli('build');
  assert.equal(mounted.status, 0, mounted.output);
  assert.doesNotMatch(mounted.output, /AVX_W78/);
  assert.equal(cli('explain', 'w78').status, 0);
} finally { fs.rmSync(root, {recursive: true, force: true}); }
console.log('No-entry build smoke passed.');
