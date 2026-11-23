/**
 * @file scaffoldTypeValidation.test.js
 * @description `avenx g` and `avenx d` must not read a mistyped type as a name.
 *
 * `avenx g <name>` is the documented shorthand for generating a component, so
 * an unrecognised first argument is normally a name. It cannot be a name when a
 * second positional argument follows it: `avenx g pge home` can only have meant
 * `avenx g page home`.
 *
 * Reading it as the shorthand created a component called "pge", registered it
 * in `src/main.app.js`, discarded "home" and exited 0 -- a mistyped command
 * that reports success and quietly edits the application entry point.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-scaffold-type-'));

/**
 * Runs a CLI command in the fixture project.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, output: string}} The result.
 */
function avenx(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

/**
 * The application entry point, as it stands.
 * @returns {string} Its contents.
 */
const mainApp = () => fs.readFileSync(path.join(root, 'src/main.app.js'), 'utf8');

try {
  console.log('🧪 Testing scaffold type validation...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');

  // 1. A mistyped type with a name after it is refused, and nothing is written.
  {
    const before = mainApp();
    const result = avenx(['g', 'pge', 'home']);

    assert.strictEqual(result.status, 1, `a mistyped type must fail:\n${result.output}`);
    assert.ok(result.output.includes('Unknown type "pge"'), 'the message names the bad type');
    assert.ok(result.output.includes('avenx g page home'), 'and suggests the nearest real one');
    assert.ok(
      !fs.existsSync(path.join(root, 'src/components/pge')),
      'no component is scaffolded from the mistyped type',
    );
    assert.strictEqual(mainApp(), before, 'and the application entry point is untouched');
  }

  // 2. Destroy is refused the same way, in its own words.
  {
    const result = avenx(['d', 'pge', 'home']);
    assert.strictEqual(result.status, 1, 'destroy refuses a mistyped type too');
    assert.ok(result.output.includes('To remove a component'), 'the hint suits the command');
  }
  console.log('  ✅ a mistyped type with a name after it is refused');

  // 3. The documented shorthand is untouched: one argument is still a name,
  //    even one that looks nothing like a type.
  {
    const result = avenx(['g', 'MyButton']);
    assert.strictEqual(result.status, 0, `the shorthand must keep working:\n${result.output}`);
    assert.ok(
      fs.existsSync(path.join(root, 'src/components/my-button/my-button.component.js')),
      'the component is scaffolded',
    );
    assert.ok(mainApp().includes('MyButton'), 'and registered');
  }

  // 4. Every real type still works with a name.
  for (const [type, probe] of [
    ['component', 'src/components/card/card.component.js'],
    ['page', 'src/pages/home.page.js'],
    ['bridge', 'src/global/session.bridge.js'],
    ['guard', 'src/guards/admin.guard.js'],
  ]) {
    const name = { component: 'card', page: 'home', bridge: 'session', guard: 'admin' }[type];
    const result = avenx(['g', type, name]);
    assert.strictEqual(result.status, 0, `avenx g ${type} ${name} failed:\n${result.output}`);
    assert.ok(fs.existsSync(path.join(root, probe)), `avenx g ${type} wrote ${probe}`);
  }
  console.log('  ✅ the shorthand and every real type still work');

  console.log('✅ scaffold type validation tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
