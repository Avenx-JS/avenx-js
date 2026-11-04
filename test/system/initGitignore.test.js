/**
 * @file initGitignore.test.js
 * @description Verifies that `avenx init` scaffolds a .gitignore containing .env ignores,
 * leaves existing .gitignore untouched, and that the repo's own .gitignore ignores .env.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');
const REPO_ROOT = path.join(__dirname, '../..');

/**
 * Creates an isolated directory for one init invocation.
 * @returns {string} Temporary project directory.
 */
function makeTempDir() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-init-gitignore-'));
}

/**
 * Runs `avenx init --yes` in the specified directory.
 * @param {string} cwd - Project directory.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} CLI result.
 */
function runInit(cwd) {
  return spawnSync(process.execPath, [BIN_PATH, 'init', '--yes'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
}

console.log('🧪 Testing avenx init .gitignore scaffolding and .env exclusion...');

// 1. `avenx init --yes` in an empty directory writes a .gitignore with .env rules
{
  const dir = makeTempDir();
  try {
    const result = runInit(dir);
    assert.strictEqual(result.status, 0, `init failed with ${result.status}:\n${result.stderr}`);

    const gitignorePath = path.join(dir, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore should be created');

    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.env\n'), '.gitignore must ignore .env');
    assert.ok(content.includes('.env.*\n'), '.gitignore must ignore .env.* variants');
    assert.ok(content.includes('!.env.example'), '.gitignore must unignore .env.example');

    // Initialize git in temp dir and verify check-ignore
    spawnSync('git', ['init'], { cwd: dir });
    const checkEnv = spawnSync('git', ['check-ignore', '.env'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(checkEnv.status, 0, '.env should be ignored by git');

    const checkEnvLocal = spawnSync('git', ['check-ignore', '.env.local'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(checkEnvLocal.status, 0, '.env.local should be ignored by git');

    // .env.example must not be ignored (git check-ignore exits with 1 when not ignored)
    const checkExample = spawnSync('git', ['check-ignore', '.env.example'], { cwd: dir, encoding: 'utf8' });
    assert.notStrictEqual(checkExample.status, 0, '.env.example must remain trackable');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ scaffolded .gitignore ignores .env and variants while keeping .env.example trackable');
}

// 2. An existing .gitignore is left alone
{
  const dir = makeTempDir();
  try {
    const gitignorePath = path.join(dir, '.gitignore');
    const existingContent = '# custom gitignore\nbuild/\n';
    fs.writeFileSync(gitignorePath, existingContent, 'utf8');

    const result = runInit(dir);
    assert.strictEqual(result.status, 0, `init failed with ${result.status}:\n${result.stderr}`);

    const contentAfter = fs.readFileSync(gitignorePath, 'utf8');
    assert.strictEqual(contentAfter, existingContent, 'existing .gitignore should not be modified');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ existing .gitignore is preserved unmodified');
}

// 3. This repository's own .gitignore ignores .env
{
  const repoGitignorePath = path.join(REPO_ROOT, '.gitignore');
  const repoContent = fs.readFileSync(repoGitignorePath, 'utf8');
  assert.ok(repoContent.includes('.env'), "repository's own .gitignore must contain .env");
  assert.ok(repoContent.includes('.env.*'), "repository's own .gitignore must contain .env.*");
  assert.ok(repoContent.includes('!.env.example'), "repository's own .gitignore must contain !.env.example");

  const checkRepoEnv = spawnSync('git', ['check-ignore', '.env'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.strictEqual(checkRepoEnv.status, 0, '.env should be ignored in this repository');

  const checkRepoExample = spawnSync('git', ['check-ignore', '-v', '.env.example'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.ok(checkRepoExample.stdout.includes('!.env.example'), '.env.example should match unignore rule');
  console.log('  ✅ repository root .gitignore ignores .env and preserves .env.example');
}

console.log('✅ All init .gitignore tests passed!');
