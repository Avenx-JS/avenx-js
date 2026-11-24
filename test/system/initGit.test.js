import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-init-git-')));
const config = path.join(root, 'gitconfig');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: config,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: root,
  GIT_TERMINAL_PROMPT: '0',
  NO_COLOR: '1',
};

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function init(cwd, args, extraEnv = env) {
  const result = spawnSync(process.execPath, [cli, 'init', ...args, '--yes'], {
    cwd,
    env: extraEnv,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

try {
  fs.writeFileSync(
    config,
    '[user]\nname = Avenx Test\nemail = avenx@example.test\n' +
      '[init]\ndefaultBranch = avenx-start\n[commit]\ngpgSign = false\n[core]\nautocrlf = false\n',
  );
  const project = path.join(root, 'with-git');
  init(root, ['with-git', '--git']);
  assert.equal(git(project, ['rev-list', '--count', 'HEAD']), '1', 'one initial commit is created');
  assert.equal(git(project, ['log', '-1', '--format=%s']), 'Initial commit from avenx init');
  assert.equal(git(project, ['branch', '--show-current']), 'avenx-start', 'init.defaultBranch is respected');
  assert.equal(git(project, ['status', '--porcelain']), '', 'the entire scaffold is committed');
  assert.equal(git(project, ['remote']), '', 'initialization does not add a remote');
  const tracked = git(project, ['ls-files']).split('\n');
  for (const file of ['.gitignore', 'avenx.config.json', 'package.json', 'index.html', 'src/main.app.js']) {
    assert.ok(tracked.includes(file), `${file} is in the initial commit`);
  }
  fs.writeFileSync(path.join(project, '.env.local'), 'PRIVATE=value\n');
  fs.writeFileSync(path.join(project, 'dist', 'output.js'), 'generated\n');
  fs.mkdirSync(path.join(project, 'node_modules'));
  fs.writeFileSync(path.join(project, 'node_modules', 'dependency.js'), 'generated\n');
  assert.equal(git(project, ['status', '--porcelain']), '', 'scaffold ignores keep generated and local files out');

  init(root, ['without-git']);
  assert.ok(fs.existsSync(path.join(root, 'without-git', 'src', 'main.app.js')));
  assert.ok(!fs.existsSync(path.join(root, 'without-git', '.git')), 'Git initialization remains opt-in');

  fs.writeFileSync(path.join(project, 'keep.txt'), 'staged before init\n');
  git(project, ['add', 'keep.txt']);
  const head = git(project, ['rev-parse', 'HEAD']);
  const index = git(project, ['diff', '--cached', '--binary']);
  const existing = init(project, ['nested', '--git', '--force']);
  assert.match(existing, /already.*repository.*skip|skip.*already.*repository/i);
  assert.equal(git(project, ['rev-parse', 'HEAD']), head, 'existing history is untouched');
  assert.equal(git(project, ['diff', '--cached', '--binary']), index, 'existing staging is untouched');
  assert.ok(!fs.existsSync(path.join(project, 'nested', '.git')), 'no nested repository is created');

  const emptyPath = path.join(root, 'empty-path');
  fs.mkdirSync(emptyPath);
  const noGitEnv = {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH')),
    PATH: emptyPath,
  };
  const missing = init(root, ['missing-git', '--git'], noGitEnv);
  assert.match(missing, /git.*unavailable|git.*not.*available/i);
  assert.ok(fs.existsSync(path.join(root, 'missing-git', 'src', 'main.app.js')));
  assert.ok(!fs.existsSync(path.join(root, 'missing-git', '.git')));

  const noIdentity = path.join(root, 'no-identity');
  fs.writeFileSync(config, '[user]\nuseConfigOnly = true\n[init]\ndefaultBranch = avenx-start\n');
  const failedCommit = init(root, ['no-identity', '--git']);
  assert.match(failedCommit, /git commit.*failed/i, 'commit errors are reported without failing the scaffold');
  assert.ok(fs.existsSync(path.join(noIdentity, 'src', 'main.app.js')));
  assert.notEqual(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: noIdentity, env }).status, 0);
  console.log('Optional init Git commits the scaffold and preserves existing repositories and failure handling.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
