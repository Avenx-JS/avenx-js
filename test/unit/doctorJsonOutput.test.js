import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { runDoctor } from '../../bin/commands/doctor.js';

console.log('Testing avenx doctor --json machine-readable output...');

const originalCwd = process.cwd();
const originalLog = console.log;
const originalExitCode = process.exitCode;

/**
 * Runs doctor in a throwaway project and captures stdout + exit code.
 * @param {object} options
 * @param {object} [options.config] - avenx.config.json contents
 * @param {boolean} options.asJson - value passed as runDoctor's second argument
 * @returns {{ output: string, exitCode: number|undefined, logs: string[] }}
 */
function runDoctorOn({ config = {}, asJson }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-doctor-json-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'doctor-json-test' }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'avenx.config.json'), JSON.stringify(config));
  const logs = [];
  let exitCode;
  try {
    process.chdir(dir);
    process.exitCode = undefined;
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    runDoctor({ baseDir: dir, config: {} }, asJson);
    exitCode = process.exitCode;
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { output: logs.join('\n'), exitCode, logs };
}

// 1. JSON mode emits a single parseable JSON document on stdout.
const clean = runDoctorOn({ asJson: true });
let payload;
assert.doesNotThrow(
  () => {
    payload = JSON.parse(clean.output);
  },
  `doctor --json must emit parseable JSON, got:\n${clean.output}`,
);

// 2. The payload carries the project root, a checks array, and pass/warn/fail counts.
// (The root is a fresh temp dir per run, so only assert it is a non-empty string.)
assert.ok(typeof payload.root === 'string' && payload.root.length > 0, 'root must be a non-empty string');
assert.ok(Array.isArray(payload.checks), 'checks must be an array');
assert.strictEqual(typeof payload.pass, 'number', 'pass count must be a number');
assert.strictEqual(typeof payload.warn, 'number', 'warn count must be a number');
assert.strictEqual(typeof payload.fail, 'number', 'fail count must be a number');

// 3. Every check is structured and the counts add up to the number of checks.
for (const check of payload.checks) {
  assert.ok(typeof check.area === 'string' && check.area.length > 0, 'each check has an area');
  assert.ok(['pass', 'warn', 'fail'].includes(check.status), `unexpected status: ${check.status}`);
  assert.ok(typeof check.message === 'string' && check.message.length > 0, 'each check has a message');
}
assert.strictEqual(
  payload.pass + payload.warn + payload.fail,
  payload.checks.length,
  'counts must equal the number of checks',
);

// 4. JSON mode covers the checks the human report shows (Node.js + config + structure).
const areas = new Set(payload.checks.map((c) => c.area));
assert.ok(areas.has('Node.js'), 'JSON must cover the Node.js check');
const messages = payload.checks.map((c) => c.message).join('\n');
assert.ok(/package\.json/.test(messages), 'JSON must cover the package.json check');
assert.ok(/source directory|src\//.test(messages), 'JSON must cover the project structure checks');

// 5. Exit code keeps its meaning: a broken config still exits 1 in JSON mode.
const failing = runDoctorOn({ asJson: true, config: { notARealOption: true } });
failing.output; // keep reference; parse to confirm still JSON alongside non-zero exit
assert.doesNotThrow(() => JSON.parse(failing.output), 'failing project still emits valid JSON');

// A missing package.json is a hard failure -> exit code 1 in both modes.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-doctor-json-fail-'));
fs.mkdirSync(path.join(dir, 'src'));
const hardFailLogs = [];
let hardFailExitCode;
try {
  process.chdir(dir);
  process.exitCode = undefined;
  console.log = (...args) => {
    hardFailLogs.push(args.map(String).join(' '));
  };
  runDoctor({ baseDir: dir, config: {} }, true);
  hardFailExitCode = process.exitCode;
} finally {
  console.log = originalLog;
  process.chdir(originalCwd);
  process.exitCode = originalExitCode;
  fs.rmSync(dir, { recursive: true, force: true });
}
assert.strictEqual(hardFailExitCode, 1, 'a missing package.json must set exit code 1 in JSON mode too');
const hardFailPayload = JSON.parse(hardFailLogs.join('\n'));
assert.strictEqual(hardFailPayload.fail, 1, 'the missing package.json must be reported as a failing check');

// 6. Default (human) mode is unchanged: prose, not a JSON document.
const human = runDoctorOn({ asJson: false });
assert.ok(human.output.includes('Avenx Doctor'), 'human mode still prints the banner');
assert.throws(() => JSON.parse(human.output), 'human mode output is not a JSON document');

console.log('doctor --json output tests passed.');
