/**
 * @file flagValueUsageErrors.test.js
 * @description A mistyped flag value is a usage error, not a crash.
 *
 * These flags used to throw a plain `Error`, which `bin/fatal.js` reports as an
 * internal defect: a "failed" headline and a stack trace through the
 * framework's own files. They now print one line that names the flag and the
 * accepted values, and exit 1. A real defect still prints its stack.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportFatal, UsageError } from '../../bin/fatal.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(repo, 'bin/avenx.js');
const atlasFixture = path.join(repo, 'test/fixtures/atlas-app');

/**
 * Runs the CLI.
 * @param {string} cwd - Working directory.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number|null, stderr: string}} The result.
 */
function avenx(cwd, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, stderr: result.stderr || '' };
}

console.log('🧪 Testing that invalid flag values are reported as usage errors...');

const project = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-usage-errors-'));
try {
  assert.equal(avenx(project, ['init', '--yes']).status, 0, 'init should succeed');

  const cases = [
    [atlasFixture, ['atlas', '--graph', '--format', 'svg'], /--format must be mermaid or dot, not "svg"/],
    [atlasFixture, ['atlas', '--graph', '--kinds', 'nope'], /Unknown Atlas node kind "nope".*Kinds: component, page/],
    [atlasFixture, ['atlas', '--graph', '--focus', 'Nothing'], /No Atlas symbol named "Nothing"[\s\S]*avenx atlas/],
    [
      atlasFixture,
      ['atlas', '--graph', '--focus', 'Checkout', '--depth', 'x'],
      /--depth must be a non-negative integer/,
    ],
    [project, ['stats', '--compare', '--max-increase', 'abc'], /--max-increase must be a non-negative percentage/],
    [project, ['serve', '--https'], /HTTPS requires --cert and --key/],
    [project, ['serve', '--https', '--cert', 'nope.pem', '--key', 'nope.key'], /Cannot load HTTPS certificate\/key/],
  ];
  for (const [cwd, args, message] of cases) {
    const { status, stderr } = avenx(cwd, args);
    const command = `avenx ${args.join(' ')}`;
    assert.equal(status, 1, `${command} must exit 1:\n${stderr}`);
    assert.match(stderr, message, `${command} must name the problem:\n${stderr}`);
    assert.doesNotMatch(stderr, /^\s+at /m, `${command} must not print a stack trace:\n${stderr}`);
    assert.doesNotMatch(stderr, /file:\/\//, `${command} must not print internal file URLs:\n${stderr}`);
    assert.doesNotMatch(stderr, /failed/, `${command} must not use the crash headline:\n${stderr}`);
  }
  console.log(`  ✅ ${cases.length} invalid flag values print one line and exit 1`);
} finally {
  fs.rmSync(project, { recursive: true, force: true });
}

// The bin/fatal.js contract for real defects is unchanged.
{
  const printed = [];
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.error = (...args) => printed.push(args.join(' '));
  try {
    reportFatal(new TypeError('boom'), 'avenx atlas');
    const defect = printed.join('\n');
    assert.match(defect, /avenx atlas failed/);
    assert.match(defect, /TypeError: boom\n\s+at /, 'a defect keeps its stack trace');

    printed.length = 0;
    reportFatal(new UsageError('Bad value.', { hint: 'Try this.' }), 'avenx atlas');
    const usage = printed.join('\n');
    assert.match(usage, /Bad value\./);
    assert.match(usage, /Try this\./);
    assert.doesNotMatch(usage, /failed|\n\s+at /);
    assert.equal(process.exitCode, 1);
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
  console.log('  ✅ a defect still prints its stack; a UsageError prints its message and hint');
}

console.log('✅ Flag value usage errors');
