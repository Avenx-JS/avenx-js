/**
 * @file cliSubcommandHelp.test.js
 * @description Subcommand help must exit before any command can have side effects.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { KNOWN_COMMANDS } from '../../bin/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-subcommand-help-'));
const sentinel = path.join(TEST_DIR, 'dist', 'keep.txt');

function snapshotTree(directory) {
  const snapshot = {};
  const pending = [directory];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        snapshot[path.relative(directory, absolutePath)] = fs.readFileSync(absolutePath, 'utf8');
      }
    }
  }

  return snapshot;
}

console.log('🧪 Testing `--help` on every CLI subcommand...');

try {
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, 'must remain untouched');
  fs.mkdirSync(path.join(TEST_DIR, 'src', 'components', 'card'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'src', 'unformatted.js'), 'const  value=1\n');
  fs.writeFileSync(
    path.join(TEST_DIR, 'src', 'components', 'card', 'card.component.js'),
    'export default class Card {}\n',
  );
  const before = snapshotTree(TEST_DIR);

  for (const command of KNOWN_COMMANDS) {
    const result = spawnSync(process.execPath, [BIN_PATH, command, '--help'], {
      cwd: TEST_DIR,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 5000,
    });

    assert.strictEqual(result.error, undefined, `${command} --help should not time out or fail to launch`);
    assert.strictEqual(result.status, 0, `${command} --help should exit 0\n${result.stderr}`);
    assert.match(result.stdout, /Avenx-JS CLI/, `${command} --help should print the CLI help text`);
  }

  assert.ok(fs.existsSync(sentinel), '`clean --help` must not remove the build output');
  assert.strictEqual(
    fs.readFileSync(sentinel, 'utf8'),
    'must remain untouched',
    '`clean --help` must not change existing build output',
  );
  assert.deepStrictEqual(
    snapshotTree(TEST_DIR),
    before,
    '`build`, `format`, and `destroy` help requests must not change the project',
  );
  console.log('  ✅ every subcommand prints help without touching the project');
} finally {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
