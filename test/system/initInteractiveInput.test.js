/**
 * @file initInteractiveInput.test.js
 * @description Forced-interactive init must handle EOF and piped answers.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

/**
 * Creates an isolated directory for one init invocation.
 * @returns {string} Temporary project directory.
 */
function makeTempDir() {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-init-interactive-'));
}

/**
 * Runs forced-interactive init with controlled stdin.
 * @param {string} cwd - Project directory.
 * @param {string} input - Complete stdin contents.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} CLI result.
 */
function runInteractiveInit(cwd, input) {
  return spawnSync(process.execPath, [BIN_PATH, 'init', '--force'], {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      AVENX_FORCE_INTERACTIVE: 'true',
      NO_COLOR: '1',
    },
  });
}

/**
 * Reads the generated Avenx config.
 * @param {string} dir - Project directory.
 * @returns {object} Parsed avenx.config.json.
 */
function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'avenx.config.json'), 'utf8'));
}

console.log('🧪 Testing forced-interactive init stdin handling...');

// EOF before the first answer must settle the prompts and scaffold defaults.
{
  const dir = makeTempDir();
  try {
    const result = runInteractiveInit(dir, '');

    assert.strictEqual(
      result.status,
      0,
      `closed stdin should scaffold with prompt defaults, got ${result.status}:\n${result.stderr}`,
    );
    assert.ok(
      /Project initialized successfully/.test(result.stdout),
      `closed stdin must not exit successfully without scaffolding:\n${result.stdout}`,
    );
    assert.ok(fs.existsSync(path.join(dir, 'src', 'main.app.js')), 'default scaffold should be created');
    assert.strictEqual(readConfig(dir).style?.preprocessor, 'none', 'EOF should use the style default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ closed stdin settles both prompts and scaffolds defaults');
}

// More than one piped answer must survive between sequential wizard questions.
{
  const dir = makeTempDir();
  try {
    const result = runInteractiveInit(dir, '2\n2\n');

    assert.strictEqual(
      result.status,
      0,
      `piped answers should scaffold successfully, got ${result.status}:\n${result.stderr}`,
    );
    assert.strictEqual(readConfig(dir).style?.preprocessor, 'sass', 'first piped answer should select Sass');
    assert.ok(
      fs.existsSync(path.join(dir, 'src', 'pages', 'home.page.js')),
      'second piped answer should select the routing layout',
    );
    assert.ok(
      fs.existsSync(path.join(dir, 'src', 'components', 'navbar', 'navbar.component.js')),
      'routing scaffold should include the Navbar component',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ sequential prompts consume both piped answers');
}

// Validator retries must consume the next queued line rather than hanging.
{
  const dir = makeTempDir();
  try {
    const result = runInteractiveInit(dir, '9\n2\n3\n2\n');

    assert.strictEqual(
      result.status,
      0,
      `validator retries should recover from invalid piped input, got ${result.status}:\n${result.stderr}`,
    );
    assert.match(
      result.stdout,
      /Please enter a number between 1 and 4/,
      'style validator should report the invalid first answer',
    );
    assert.match(
      result.stdout,
      /Please enter 1 or 2/,
      'layout validator should report the invalid first answer',
    );
    assert.strictEqual(readConfig(dir).style?.preprocessor, 'sass', 'retry should accept the next style answer');
    assert.ok(
      fs.existsSync(path.join(dir, 'src', 'pages', 'about.page.js')),
      'retry should accept the next layout answer and scaffold routing',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ validator retries continue to consume queued input');
}

console.log('✅ Forced-interactive init stdin tests passed!');
