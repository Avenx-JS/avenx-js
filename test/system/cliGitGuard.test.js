/**
 * @file cliGitGuard.test.js
 * @description The working-tree guard that gates init, generate, destroy and build.
 *
 * Three defects lived here at once, and each was invisible to a test that only
 * looked at stdout and the exit code of a happy path:
 *
 *  - The guard ran `git status` in the process's working directory rather than
 *    in the project, so scaffolding inside a subdirectory of an unrelated
 *    repository reported that repository's changes.
 *  - Outside a repository, git's own `fatal: not a git repository` reached the
 *    user's terminal, because `execSync` forwards a child's stderr by default.
 *    Every `avenx init` in a plain directory printed it.
 *  - Declining the prompt returned from `run()` without an exit code, so
 *    `avenx build` exited 0 having built nothing. The CLI reference states
 *    that build exits 0 only on a successful build.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

/**
 * Creates an empty temporary directory outside any repository checkout.
 * @returns {string} The directory path.
 */
function makeTempDir() {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-git-guard-'));
}

/**
 * Runs the CLI in a directory and captures both streams separately.
 * @param {string} cwd - Working directory for the child.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function runCli(cwd, args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/**
 * Initialises a git repository with one dirty file.
 * @param {string} dir - The directory to turn into a repository.
 * @returns {void}
 */
function makeDirtyRepo(dir) {
  const opts = { cwd: dir, stdio: 'ignore' };
  execFileSync('git', ['init'], opts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  execFileSync('git', ['add', '.'], opts);
  execFileSync('git', ['commit', '-m', 'seed'], opts);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'dirty\n');
}

console.log('🧪 Testing the CLI working-tree guard...');

// --- git's stderr never reaches the user ---------------------------------
{
  const dir = makeTempDir();
  try {
    const { status, stdout, stderr } = runCli(dir, ['init']);
    assert.strictEqual(status, 0, `init outside a repository should succeed, got ${status}`);
    assert.ok(
      !/not a git repository/i.test(stderr) && !/not a git repository/i.test(stdout),
      `git's own fatal message must not reach the user. stderr was:\n${stderr}`,
    );
    assert.ok(/initialized successfully/.test(stdout), 'init should report success');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ init outside a git repository prints no git error');
}

// --- the success line is the last thing printed --------------------------
{
  const dir = makeTempDir();
  try {
    const { stdout } = runCli(dir, ['init']);
    const lines = stdout.trim().split('\n').filter((line) => line.trim());
    const successIndex = lines.findIndex((line) => line.includes('initialized successfully'));
    assert.ok(successIndex !== -1, 'init should report success');
    assert.strictEqual(
      successIndex,
      lines.length - 1,
      `nothing may be printed after the success line, but saw:\n${lines.slice(successIndex).join('\n')}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ init prints its success line last');
}

// --- the guard reads the project, not the process's directory ------------
{
  const outer = makeTempDir();
  try {
    makeDirtyRepo(outer);
    // A clean repository nested inside the dirty one. The guard must read this
    // one, because this is where the command writes.
    const inner = path.join(outer, 'project');
    fs.mkdirSync(inner);
    execFileSync('git', ['init'], { cwd: inner, stdio: 'ignore' });

    const { stdout, stderr } = runCli(inner, ['init']);
    assert.ok(
      !/unstaged changes/i.test(stdout + stderr),
      'the enclosing repository\'s dirt must not be reported for a clean project',
    );
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
  console.log('  ✅ the guard inspects the project directory, not the enclosing repository');
}

// --- a dirty tree still warns on a non-TTY, and still proceeds -----------
{
  const dir = makeTempDir();
  try {
    makeDirtyRepo(dir);
    const { status, stdout, stderr } = runCli(dir, ['init']);
    assert.ok(
      /unstaged changes/i.test(stdout + stderr),
      'a genuinely dirty project tree must still warn',
    );
    assert.strictEqual(status, 0, 'a non-interactive run proceeds past the warning');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ a dirty project tree still warns');
}

// --- declining the prompt exits non-zero ---------------------------------
{
  const dir = makeTempDir();
  try {
    makeDirtyRepo(dir);

    // The guard only prompts on a terminal, and a spawned child's pipes are
    // not one. This harness marks the streams as a TTY and then runs the real
    // CLI, so the decline path executes exactly as it does for a user.
    const harness = path.join(dir, 'decline-harness.mjs');
    fs.writeFileSync(
      harness,
      [
        'process.stdin.isTTY = true;',
        'process.stdout.isTTY = true;',
        `const { AvenxCLI } = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, '../../bin/cli.js')).href)});`,
        'const cli = new AvenxCLI({ baseDir: process.cwd() });',
        "await cli.run('build', []);",
        'process.exit(0);',
      ].join('\n'),
    );

    const res = spawnSync(process.execPath, [harness], {
      cwd: dir,
      encoding: 'utf8',
      input: 'n\n',
      env: { ...process.env, NO_COLOR: '1' },
    });

    assert.ok(
      /unstaged changes/i.test(res.stdout + res.stderr),
      'the guard should have prompted about the dirty tree',
    );
    assert.strictEqual(
      res.status,
      1,
      `declining "avenx build" must exit non-zero, got ${res.status}. ` +
        'Exiting 0 without building makes "avenx build && deploy" deploy a stale bundle.',
    );
    assert.ok(
      !fs.existsSync(path.join(dir, 'dist', 'bundle.js')),
      'a declined build must not have produced a bundle',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ declining the guard exits non-zero and builds nothing');
}

console.log('✅ CLI working-tree guard tests passed!');
