import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runDoctor } from '../../bin/commands/doctor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'avenx.js');

console.log('Testing avenx doctor --json output...');

const originalCwd = process.cwd();
const originalLog = console.log;
const originalExitCode = process.exitCode;

/**
 * Builds a throwaway project and runs doctor against it.
 * @param {object} [options]
 * @param {boolean} [options.healthy] - Whether to create the files a healthy project has.
 * @param {string[]} [options.args] - Arguments passed through to runDoctor.
 * @returns {{ output: string, report: object, exitCode: number|undefined, dir: string }}
 */
function runDoctorOn({ healthy = true, args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-doctor-json-'));
  if (healthy) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'doctor-test' }));
    fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'global'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.vscode', 'jsconfig.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, 'avenx.config.json'), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html><head></head><body><script src="dist/bundle.js"></script></body></html>',
    );
  }
  const logs = [];
  let report;
  let exitCode;
  try {
    process.chdir(dir);
    process.exitCode = undefined;
    console.log = (...logArgs) => {
      logs.push(logArgs.map(String).join(' '));
    };
    report = runDoctor({ baseDir: dir, config: {} }, args);
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    exitCode = process.exitCode;
    process.exitCode = originalExitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { output: logs.join('\n'), report, exitCode };
}

// 1. --json emits only JSON, covering every check the human report shows.
const human = runDoctorOn({ healthy: true, args: [] });
assert.ok(human.output.includes('Avenx Doctor'), 'human mode should still print the prose report');
assert.throws(() => JSON.parse(human.output), 'human mode output should not parse as JSON');

const json = runDoctorOn({ healthy: true, args: ['--json'] });
assert.ok(!json.output.includes('Avenx Doctor'), 'JSON mode must not print the prose report');
assert.strictEqual(json.output.trimStart()[0], '{', 'JSON mode output should start with an object');
const parsed = JSON.parse(json.output);
assert.strictEqual(parsed.projectRoot, json.report.projectRoot, 'the payload should name the project root');
assert.ok(Array.isArray(parsed.checks), 'the payload should carry a checks array');
assert.strictEqual(
  parsed.checks.length,
  human.report.checks.length,
  'JSON mode should cover every check the human report shows',
);
assert.deepStrictEqual(parsed.summary, human.report.summary, 'the summary counts should match the human report');
assert.deepStrictEqual(parsed.checks, human.report.checks, 'the checks should match the human report');
assert.deepStrictEqual(
  parsed.summary,
  { pass: 10, warn: 1, fail: 0 },
  'the healthy fixture should pass 10, warn 1, fail 0',
);
for (const check of parsed.checks) {
  assert.ok(
    ['Node.js', 'Project files', 'Project structure', 'Git'].includes(check.area),
    `unknown check area: ${check.area}`,
  );
  assert.ok(['pass', 'warn', 'fail'].includes(check.status), `unknown check status: ${check.status}`);
  assert.strictEqual(typeof check.message, 'string', 'every check should carry a message');
  assert.ok(check.message.length > 0, 'every check message should be non-empty');
}
assert.ok(
  parsed.checks.some((check) => check.area === 'Node.js' && check.status === 'pass'),
  'the payload should carry the Node.js check',
);
assert.ok(
  parsed.checks.some((check) => check.area === 'Git'),
  'the payload should carry the Git check',
);
assert.strictEqual(json.exitCode, undefined, 'a healthy project should not set a failure exit code');
console.log('  ✅ --json emits only JSON covering every human-report check');

// 2. -j is the same flag.
const shortFlag = runDoctorOn({ healthy: true, args: ['-j'] });
assert.deepStrictEqual(
  JSON.parse(shortFlag.output).summary,
  { pass: 10, warn: 1, fail: 0 },
  '-j should behave like --json',
);
console.log('  ✅ -j behaves like --json');

// 3. A failing project: JSON still parses, and the exit code keeps its meaning.
const failing = runDoctorOn({ healthy: false, args: ['--json'] });
const failingParsed = JSON.parse(failing.output);
assert.ok(failingParsed.summary.fail > 0, 'a project with no package.json or src/ should fail checks');
assert.strictEqual(failing.exitCode, 1, 'JSON mode should exit 1 when a check fails');
const failingHuman = runDoctorOn({ healthy: false, args: [] });
assert.strictEqual(failingHuman.exitCode, 1, 'human mode should exit 1 on the same project');
assert.deepStrictEqual(
  failingParsed.summary,
  failingHuman.report.summary,
  'the failing summary should match in both modes',
);
console.log('  ✅ a failing project keeps exit code 1 in JSON mode');

// 4. End to end through the CLI: `avenx doctor --json` in a real project.
const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-doctor-json-cli-'));
try {
  fs.writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify({ name: 'doctor-cli-test' }));
  fs.mkdirSync(path.join(cliDir, 'src'), { recursive: true });
  const result = spawnSync(process.execPath, [BIN_PATH, 'doctor', '--json'], {
    cwd: cliDir,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `CLI doctor --json should exit 0 here; stderr: ${result.stderr}`);
  const cliParsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(cliParsed.checks) && cliParsed.checks.length > 0, 'CLI JSON should carry checks');
  assert.ok(
    cliParsed.checks.some((check) => check.message.includes('doctor-cli-test')),
    'CLI JSON should name the project',
  );
  assert.ok(!result.stdout.includes('Avenx Doctor'), 'CLI JSON output must not contain the prose report');
  console.log('  ✅ `avenx doctor --json` parses end to end through the CLI');
} finally {
  fs.rmSync(cliDir, { recursive: true, force: true });
}

console.log('✅ All doctor --json tests passed!');
