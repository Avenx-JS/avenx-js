/**
 * @file checkAccessibility.test.js
 * @description System tests for `avenx check` static accessibility rule validation,
 * backward-compatibility exit codes, --json output, and severity overrides.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-check-a11y-'));

function avenx(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

function page(template) {
  fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), template);
  fs.writeFileSync(path.join(root, 'src/pages/home.page.css'), '');
}

function writeConfig(config) {
  fs.writeFileSync(path.join(root, 'avenx.config.json'), JSON.stringify(config, null, 2));
}

try {
  console.log('🧪 Testing avenx check accessibility lint rules and exit codes...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate should succeed');
  fs.appendFileSync(path.join(root, 'src/main.app.js'), "\napp.initRouter({ '/': 'Home' });\n");

  // 1. Accessibility warning defaults to exit code 0 (non-blocking)
  {
    page('<h1>Home</h1>\n<img src="/avatar.png">');
    const { status, output } = avenx(['check']);
    assert.strictEqual(status, 0, `accessibility warnings must not fail check by default:\n${output}`);
    assert.ok(output.includes('AVX_W65'), 'output must report AVX_W65');
    assert.ok(output.includes('alt'), 'output must mention missing alt attribute');
    console.log('  ✅ Accessibility warning exits 0 by default (non-blocking contract)');
  }

  // 2. avenx check --json includes accessibility warnings and valid: true
  {
    page('<h1>Home</h1>\n<img src="/avatar.png">');
    const { status, output } = avenx(['check', '--json']);
    assert.strictEqual(status, 0, 'avenx check --json exits 0 with only a11y warnings');

    const parsed = JSON.parse(output.slice(output.indexOf('{')));
    assert.strictEqual(parsed.valid, true, 'valid should be true when only non-blocking a11y warnings exist');
    assert.strictEqual(parsed.errorCount, 0, 'errorCount should be 0');
    assert.strictEqual(parsed.warningCount, 1, 'warningCount should be 1');
    assert.strictEqual(parsed.diagnostics.length, 1);

    const diag = parsed.diagnostics[0];
    assert.strictEqual(diag.code, 'AVX_W65');
    assert.strictEqual(diag.severity, 'warning');
    assert.ok(diag.message.includes('alt'));
    assert.ok(diag.file === 'Home' || diag.file.includes('home.page.js'), 'diag.file must identify component');
    console.log('  ✅ avenx check --json outputs valid JSON with code and location');
  }

  // 3. Dynamic attributes satisfy the check and produce 0 warnings
  {
    page('<state altText="User photo" />\n<img src="/avatar.png" alt="{{ altText }}">');
    const { status, output } = avenx(['check']);
    assert.strictEqual(status, 0);
    assert.ok(!output.includes('AVX_W65'), 'dynamic alt must satisfy check');
    console.log('  ✅ Dynamic attribute satisfies check without warning');
  }

  // 4. Escalating an a11y warning to "error" fails check with exit code 1
  {
    writeConfig({
      warnings: {
        AVX_W65: 'error',
      },
    });
    page('<h1>Home</h1>\n<img src="/avatar.png">');

    const check = avenx(['check']);
    assert.strictEqual(check.status, 1, `escalated AVX_W65 must exit 1:\n${check.output}`);
    assert.ok(check.output.includes('AVX_W65'), 'output must mention AVX_W65');

    const jsonRes = avenx(['check', '--json']);
    assert.strictEqual(jsonRes.status, 1, 'escalated AVX_W65 with --json must exit 1');
    const parsed = JSON.parse(jsonRes.output.slice(jsonRes.output.indexOf('{')));
    assert.strictEqual(parsed.valid, false);
    assert.strictEqual(parsed.errorCount, 1);
    console.log('  ✅ Escalating AVX_W65 to error causes exit code 1 and valid: false');
  }

  // 5. Silencing an a11y warning via "off"
  {
    writeConfig({
      warnings: {
        AVX_W65: 'off',
      },
    });
    page('<h1>Home</h1>\n<img src="/avatar.png">');

    const { status, output } = avenx(['check']);
    assert.strictEqual(status, 0);
    assert.ok(!output.includes('AVX_W65'), 'suppressed warning must not appear');

    const jsonRes = avenx(['check', '--json']);
    const parsed = JSON.parse(jsonRes.output.slice(jsonRes.output.indexOf('{')));
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.warningCount, 0);
    console.log('  ✅ Silencing AVX_W65 via "off" suppresses the warning');
  }

  // 6. avenx check --strict escalates a11y warnings to exit code 1
  {
    writeConfig({});
    page('<h1>Home</h1>\n<img src="/avatar.png">');

    const strictRes = avenx(['check', '--strict']);
    assert.strictEqual(strictRes.status, 1, '--strict flag must exit 1 even for non-blocking warnings');
    console.log('  ✅ avenx check --strict exits 1 on accessibility warnings');
  }

  // 7. Standard compiler warnings still exit 1 as before
  {
    writeConfig({});
    page('<state title="Home" />\n<h1>{{ undeclaredState }}</h1>');
    const { status, output } = avenx(['check']);
    assert.strictEqual(status, 1, `standard warning must still fail check:\n${output}`);
    console.log('  ✅ Standard compiler warnings still exit 1');
  }

  console.log('🎉 All avenx check accessibility system tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
