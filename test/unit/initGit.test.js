import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeGit } from '../../bin/commands/initGit.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-git-preview-')));
const project = path.join(root, 'not-created');
const log = console.log;
const output = [];
try {
  console.log = (message) => output.push(message);
  initializeGit(project, { dryRun: true });
  assert.ok(!fs.existsSync(project), 'a Git preview does not need or create the project directory');
} finally {
  console.log = log;
  fs.rmSync(root, { recursive: true, force: true });
}
assert.equal(output.length, 3);
assert.match(output[0], /\[Dry Run\] Would run: git init/);
assert.match(output[1], /\[Dry Run\] Would run: git add -A/);
assert.match(output[2], /\[Dry Run\] Would run: git commit -m "Initial commit from avenx init"/);
console.log('Git initialization previews all commands without running them.');
