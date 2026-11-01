import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { getInitialHtml } from '../../bin/commands/serve.js';
import { runDoctor } from '../../bin/commands/doctor.js';

console.log('Testing avenx doctor index.html bundle reference check...');

const originalCwd = process.cwd();
const originalLog = console.log;
const originalExitCode = process.exitCode;

/**
 * Runs doctor against a throwaway project.
 * @param {object} options
 * @param {object} [options.config] - avenx.config.json contents
 * @param {string|null} options.html - index.html contents, or null to omit the file
 * @returns {string} The doctor output
 */
function runDoctorOn({ config = {}, html }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-doctor-html-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'doctor-test' }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'avenx.config.json'), JSON.stringify(config));
  if (html !== null) fs.writeFileSync(path.join(dir, 'index.html'), html);
  const logs = [];
  try {
    process.chdir(dir);
    process.exitCode = undefined;
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    runDoctor({ baseDir: dir, config: {} });
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return logs.join('\n');
}

const STALE_WARNING = 'index.html does not reference the bundle';

// 1. Default config: the scaffolded index.html matches, so no warning.
const defaultHtml = getInitialHtml({ config: { distDir: 'dist' } });
assert.ok(
  !runDoctorOn({ html: defaultHtml }).includes(STALE_WARNING),
  'a scaffolded project with default config must not get a bundle warning',
);

// 2. outputName changed but index.html left untouched: warn, naming the expected path.
const staleOutputName = runDoctorOn({ config: { outputName: 'app.bundle' }, html: defaultHtml });
assert.ok(
  staleOutputName.includes(`${STALE_WARNING} (dist/app.bundle.js or dist/app.bundle.css)`),
  `doctor should warn and name dist/app.bundle.js when outputName changed; got:\n${staleOutputName}`,
);

// 3. distDir changed but index.html left untouched: warn, naming the expected path.
const staleDistDir = runDoctorOn({ config: { distDir: 'build' }, html: defaultHtml });
assert.ok(
  staleDistDir.includes(`${STALE_WARNING} (build/bundle.js or build/bundle.css)`),
  `doctor should warn and name build/bundle.js when distDir changed; got:\n${staleDistDir}`,
);

// 4. index.html correctly updated for the new outputName and distDir: no warning.
const updatedHtml = getInitialHtml({ config: { distDir: 'build' } }).replace(/bundle\.(js|css)/g, 'app.bundle.$1');
assert.ok(
  !runDoctorOn({ config: { outputName: 'app.bundle', distDir: 'build' }, html: updatedHtml }).includes(STALE_WARNING),
  'an index.html updated to the configured bundle paths must not get a warning',
);

// 5. A missing index.html keeps the existing warning and does not crash.
const missing = runDoctorOn({ html: null });
assert.ok(missing.includes('index.html missing at project root'), 'a missing index.html keeps its existing warning');
assert.ok(!missing.includes(STALE_WARNING), 'a missing index.html must not also report a stale bundle reference');

console.log('doctor index.html bundle reference tests passed.');
