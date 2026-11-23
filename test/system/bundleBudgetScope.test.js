/**
 * @file bundleBudgetScope.test.js
 * @description What the bundle-size budget (AVX_W01) is measured against.
 *
 * The budget describes what a browser downloads on a page load. The build
 * already excludes the trace sidecar and the Atlas on exactly that reasoning,
 * but source maps -- which are the same category, and which are larger than
 * the bundle they describe -- were still weighed.
 *
 * That had two costs. Every development build warned about bundle.js.map by
 * default, so AVX_W01 became a line developers scroll past rather than a signal
 * that the shipped bundle grew. And a project that escalates AVX_W01 to
 * "error", which the configuration reference documents as supported, could not
 * run a development build at all: it failed on the size of a file it does not
 * ship.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-budget-'));

/**
 * Runs a build and returns its result.
 * @param {string[]} args - Extra CLI arguments.
 * @returns {{status: number, output: string}} The result.
 */
function build(args = []) {
  const res = spawnSync(process.execPath, [BIN_PATH, 'build', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

/**
 * Writes the project configuration.
 * @param {object} config - The configuration object.
 * @returns {void}
 */
function writeConfig(config) {
  fs.writeFileSync(path.join(root, 'avenx.config.json'), JSON.stringify(config, null, 2));
}

try {
  console.log('🧪 Testing the scope of the bundle-size budget...');

  const init = spawnSync(process.execPath, [BIN_PATH, 'init'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(init.status, 0, `init failed:\n${init.stdout}${init.stderr}`);
  fs.writeFileSync(
    path.join(root, 'src/pages/home.page.js'),
    '<state title="Home" />\n<h1>{{ title }}</h1>',
  );
  fs.appendFileSync(path.join(root, 'src/main.app.js'), "\napp.initRouter({ '': 'Home' });\n");

  // A budget of 1 KB puts every artifact over the line, so which files are
  // weighed is the only thing that decides what is reported.
  writeConfig({ bundleSizeWarningKb: 1 });

  // --- source maps are not weighed ---------------------------------------
  {
    const { output } = build(['--dev']);
    assert.ok(/bundle\.js\.map/.test(output), 'a development build should emit a source map');
    const warned = output
      .split('\n')
      .filter((line) => line.includes('AVX_W01'))
      .join('\n');
    assert.ok(warned.length > 0, 'the budget should still report the bundle itself');
    assert.ok(
      !/\.map/.test(warned),
      `no source map may be weighed against the budget, but saw:\n${warned}`,
    );
    console.log('  ✅ source maps are not weighed against the budget');
  }

  // --- a development build survives AVX_W01 escalated to an error --------
  {
    writeConfig({ bundleSizeWarningKb: 4096, warnings: { AVX_W01: 'error' } });
    const { status, output } = build(['--dev']);
    assert.strictEqual(
      status,
      0,
      'a development build must not fail on the size of a source map it does not ' +
        `ship. Output:\n${output}`,
    );
    console.log('  ✅ an escalated budget does not fail a build over a source map');
  }

  // --- the bundle itself is still weighed --------------------------------
  {
    writeConfig({ bundleSizeWarningKb: 1, warnings: { AVX_W01: 'error' } });
    const { status, output } = build();
    assert.notStrictEqual(status, 0, 'an over-budget bundle must still fail when escalated');
    assert.ok(/AVX_W01/.test(output), 'the size violation is still reported');
    assert.ok(/bundle\.js/.test(output), 'the bundle is named');
    console.log('  ✅ the bundle itself is still weighed and still escalates');
  }

  // --- the CSS asset is still weighed ------------------------------------
  {
    writeConfig({ bundleSizeWarningKb: 0.01 });
    const { output } = build();
    assert.ok(
      /AVX_W01.*bundle\.css/.test(output),
      'a stylesheet is downloaded on a page load and must stay in the budget',
    );
    console.log('  ✅ the stylesheet is still weighed');
  }

  console.log('✅ Bundle budget scope tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
