import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { runDoctor } from '../../bin/commands/doctor.js';

console.log('Testing avenx doctor --fix keeps the git check a warning...');

const originalCwd = process.cwd();
const originalLog = console.log;
const originalExitCode = process.exitCode;
const originalGitDir = process.env.GIT_DIR;

/**
 * Runs doctor --json in a throwaway project that is not a git repository.
 * @param {object} [options] - passed as runDoctor's third argument
 * @returns {{ payload: object, exitCode: number|undefined }}
 */
function runDoctorOutsideGit(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-doctor-git-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'doctor-git-test' }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'avenx.config.json'), '{}');
  const logs = [];
  let exitCode;
  try {
    process.chdir(dir);
    process.exitCode = undefined;
    // Point git at a directory that does not exist, so `git status` fails even
    // when the temp directory happens to sit inside a repository.
    process.env.GIT_DIR = path.join(dir, 'no-such-git-dir');
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    runDoctor({ baseDir: dir, config: {} }, true, options);
    exitCode = process.exitCode;
  } finally {
    console.log = originalLog;
    if (originalGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = originalGitDir;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { payload: JSON.parse(logs.join('\n')), exitCode };
}

const gitCheck = (payload) => payload.checks.find((check) => check.area === 'Git');

const plain = runDoctorOutsideGit();
const fixed = runDoctorOutsideGit({ fix: true });
const dryRun = runDoctorOutsideGit({ fix: true, dryRun: true });

assert.strictEqual(gitCheck(plain.payload).status, 'warn', 'without --fix, a missing repository is a warning');
for (const [name, run] of [
  ['--fix', fixed],
  ['--fix --dry-run', dryRun],
]) {
  assert.strictEqual(
    gitCheck(run.payload).status,
    'warn',
    `${name} cannot create a repository, so the git check must stay a warning`,
  );
  assert.strictEqual(
    run.payload.fail,
    plain.payload.fail,
    `${name} must not add a failure for the git check (plain: ${plain.payload.fail}, ${name}: ${run.payload.fail})`,
  );
  assert.strictEqual(run.exitCode, plain.exitCode, `${name} must exit like plain doctor`);
}

console.log('✓ doctor --fix keeps "Not a git repository" a warning');
