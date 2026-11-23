/**
 * @file initProjectDirectory.test.js
 * @description `avenx init <name>` creates the project directory and scaffolds into it.
 *
 * Without a name, `init` keeps scaffolding into the current directory. A name
 * follows the rules of the other scaffold commands, and an existing directory
 * that is not empty is refused before anything is written unless `--force`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-init-name-'));

/**
 * Runs the CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, output: string}} The result.
 */
function avenx(args, cwd) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

/**
 * Makes an empty working directory under the test root.
 * @param {string} name - Directory name.
 * @returns {string} Its path.
 */
function workspace(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  return dir;
}

try {
  console.log('🧪 Testing avenx init <name>...');

  // A name creates the directory, scaffolds into it and prints the cd step.
  {
    const cwd = workspace('named');
    const result = avenx(['init', 'my-app', '-y'], cwd);
    assert.strictEqual(result.status, 0, `init my-app should succeed:\n${result.output}`);
    assert.ok(fs.existsSync(path.join(cwd, 'my-app/src/main.app.js')), 'the project should be scaffolded in my-app/');
    assert.ok(!fs.existsSync(path.join(cwd, 'src')), 'nothing should be scaffolded in the current directory');
    assert.match(result.output, /cd my-app/, `the next step should be printed:\n${result.output}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'my-app/package.json'), 'utf8'));
    assert.strictEqual(pkg.name, 'my-app', 'the package.json name should match the directory');
  }

  // Without a name, init scaffolds into the current directory as before.
  {
    const cwd = workspace('unnamed');
    const result = avenx(['init', '-y'], cwd);
    assert.strictEqual(result.status, 0, `init should succeed:\n${result.output}`);
    assert.ok(fs.existsSync(path.join(cwd, 'src/main.app.js')), 'the project should be scaffolded in place');
    assert.doesNotMatch(result.output, /Next: cd/, 'no cd step without a name');
  }

  // A non-empty directory is refused before anything is written, unless --force.
  {
    const cwd = workspace('taken');
    fs.mkdirSync(path.join(cwd, 'existing'));
    fs.writeFileSync(path.join(cwd, 'existing/notes.txt'), 'keep me\n');

    const refused = avenx(['init', 'existing', '-y'], cwd);
    assert.strictEqual(refused.status, 1, `a non-empty target should be refused:\n${refused.output}`);
    assert.match(refused.output, /not empty/, refused.output);
    assert.deepStrictEqual(fs.readdirSync(path.join(cwd, 'existing')), ['notes.txt'], 'nothing should be written');

    const forced = avenx(['init', 'existing', '-y', '--force'], cwd);
    assert.strictEqual(forced.status, 0, `--force should scaffold into it:\n${forced.output}`);
    assert.ok(fs.existsSync(path.join(cwd, 'existing/src/main.app.js')), '--force should scaffold the project');
    assert.strictEqual(fs.readFileSync(path.join(cwd, 'existing/notes.txt'), 'utf8'), 'keep me\n');
  }

  // An empty existing directory is used as it is.
  {
    const cwd = workspace('empty');
    fs.mkdirSync(path.join(cwd, 'ready'));
    const result = avenx(['init', 'ready', '-y'], cwd);
    assert.strictEqual(result.status, 0, `an empty target should be used:\n${result.output}`);
    assert.ok(fs.existsSync(path.join(cwd, 'ready/src/main.app.js')));
  }

  // Invalid names are refused with the scaffold naming rules, and nothing is created.
  {
    const cwd = workspace('invalid');
    for (const name of ['../escape', 'my app', '1app']) {
      const result = avenx(['init', name, '-y'], cwd);
      assert.strictEqual(result.status, 1, `"${name}" should be refused:\n${result.output}`);
      assert.match(result.output, /Invalid project name/, result.output);
    }
    assert.deepStrictEqual(fs.readdirSync(cwd), [], 'no directory should be created for an invalid name');
    assert.ok(!fs.existsSync(path.join(root, 'escape')), 'a traversal name must not create anything outside');
  }

  // More than one name is refused.
  {
    const cwd = workspace('two');
    const result = avenx(['init', 'one', 'two', '-y'], cwd);
    assert.strictEqual(result.status, 1, `two names should be refused:\n${result.output}`);
    assert.deepStrictEqual(fs.readdirSync(cwd), [], 'nothing should be created');
  }

  console.log('  ✅ init <name> creates the directory; init alone, refusals and --force behave');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
