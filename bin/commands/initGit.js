import { spawnSync } from 'node:child_process';
import { gray } from '../colors.js';

const commands = [['init'], ['add', '-A'], ['commit', '-m', 'Initial commit from avenx init']];

/**
 * Optionally put the completed scaffold in its own Git repository.
 * Git failures are notes: the project files have already been written.
 * @param {string} projectDir - The scaffolded project directory.
 * @param {object} [options] - Initialization options.
 * @param {boolean} [options.dryRun] - Report commands without executing Git.
 * @returns {void}
 */
export function initializeGit(projectDir, { dryRun = false } = {}) {
  if (dryRun) {
    for (const args of commands) {
      const command = args.map((arg) => (arg.includes(' ') ? JSON.stringify(arg) : arg)).join(' ');
      console.log(gray(`  [Dry Run] Would run: git ${command}`));
    }
    return;
  }

  const run = (args) =>
    spawnSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30000,
    });
  const repository = run(['rev-parse', '--git-dir']);
  if (repository.error) {
    console.log(gray('  Git is unavailable; skipped repository initialization.'));
    return;
  }
  if (repository.status === 0) {
    console.log(gray('  Already inside a Git repository; skipped initialization and commit.'));
    return;
  }

  for (const args of commands) {
    const result = run(args);
    if (result.error || result.status !== 0) {
      const detail = (result.stderr || result.error?.message || '').trim();
      console.log(gray(`  git ${args[0]} failed; the scaffold is ready.${detail ? `\n  ${detail}` : ''}`));
      return;
    }
  }
  console.log(gray('  Initialized Git repository and created the first commit.'));
}
