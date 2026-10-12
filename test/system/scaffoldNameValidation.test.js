/**
 * @file scaffoldNameValidation.test.js
 * @description `avenx g` and `avenx d` must reject invalid component names
 * before modifying files or registering invalid identifiers.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-scaffold-name-'));

function avenx(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

const mainApp = () => fs.readFileSync(path.join(root, 'src/main.app.js'), 'utf8');

try {
  console.log('🧪 Testing scaffold name validation...');

  assert.strictEqual(avenx(['init', '-y']).status, 0, 'init should succeed');

  // 1. Path traversal names are refused and write nothing outside or inside src
  {
    const before = mainApp();
    const result = avenx(['g', 'component', '../../pwned', '--force']);

    assert.strictEqual(result.status, 1, `path traversal name must fail:\n${result.output}`);
    assert.ok(result.output.includes('Invalid name "../../pwned"'), 'message states the invalid name');
    assert.ok(!fs.existsSync(path.join(root, '../pwned.component.js')), 'no file written outside the project');
    assert.ok(!fs.existsSync(path.join(root, 'src/components/pwned')), 'no folder created');
    assert.strictEqual(mainApp(), before, 'main.app.js remains untouched');
  }
  console.log('  ✅ path traversal names are refused');

  // 2. Whitespace in names is refused
  {
    const before = mainApp();
    const result = avenx(['g', 'component', 'my component', '--force']);

    assert.strictEqual(result.status, 1, `whitespace name must fail:\n${result.output}`);
    assert.ok(result.output.includes('cannot contain whitespace'), 'explains whitespace issue');
    assert.strictEqual(mainApp(), before, 'main.app.js remains untouched');
  }
  console.log('  ✅ whitespace names are refused');

  // 3. Leading digits are refused
  {
    const before = mainApp();
    const result = avenx(['g', 'component', '123start', '--force']);

    assert.strictEqual(result.status, 1, `leading digit name must fail:\n${result.output}`);
    assert.ok(result.output.includes('cannot start with a number'), 'explains digit issue');
    assert.strictEqual(mainApp(), before, 'main.app.js remains untouched');
  }
  console.log('  ✅ leading digits are refused');

  // 4. Destroy command rejects invalid names too
  {
    const result = avenx(['d', 'component', '../../pwned', '--force']);
    assert.strictEqual(result.status, 1, `destroy must reject traversal name:\n${result.output}`);
    assert.ok(result.output.includes('Invalid name "../../pwned"'), 'destroy outputs rejection');
  }
  console.log('  ✅ destroy command refuses invalid names');

  // 5. Valid names still work as intended
  for (const name of ['my-component', 'my_component', 'MyComponent']) {
    const result = avenx(['g', 'component', name, '--force']);
    assert.strictEqual(result.status, 0, `valid name "${name}" should succeed:\n${result.output}`);
  }
  console.log('  ✅ valid names succeed');

  console.log('✅ scaffold name validation tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}