/**
 * @file statsStyleBlocks.test.js
 * @description `avenx stats` must agree with `avenx build` about a project.
 *
 * `stats` re-parses each unit to measure it. It called `extractTemplate` with
 * an empty style-block map, and that call validates every `@css <block>`
 * directive against the map it is handed -- so every block a component
 * declares was reported as undeclared. A freshly scaffolded project, which
 * `build` and `check` both accept in silence, produced a screenful of AVX_W49
 * from `stats`.
 *
 * The blocks were being read further down the same branch, for the CSS byte
 * count, which was too late to be of use to the validation above it.
 *
 * This is the second time a measurement command has reported a diagnostic the
 * build does not: the same call previously passed empty declaration maps and
 * printed AVX_W03 for actions the component plainly declares. The general
 * claim is the one worth pinning, so this asserts that a scaffolded project is
 * silent across all three commands, not merely that one code stopped firing.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-stats-css-'));

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
 * Every diagnostic code a command reported.
 * @param {string} output - Command output.
 * @returns {string[]} Sorted unique codes.
 */
function codes(output) {
  return [...new Set([...output.matchAll(/^\[(AVX_[A-Z]\d+)\]/gm)].map((m) => m[1]))].sort();
}

try {
  console.log('🧪 Testing `avenx stats` against a scaffolded project...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate page should succeed');
  assert.strictEqual(avenx(['generate', 'component', 'Card']).status, 0, 'generate component should succeed');
  fs.writeFileSync(
    path.join(root, 'src/main.app.js'),
    [
      "import { AvenxApp } from 'avenx-core/runtime';",
      "import Card from './components/card/card.component.js';",
      "const app = new AvenxApp({ target: '#app' });",
      "app.register('Card', Card);",
      "app.initRouter({ '/': 'Home' });",
      '',
    ].join('\n'),
  );

  // 1. The scaffold is silent for the build, and must be silent for stats too.
  {
    const build = avenx(['build']);
    const stats = avenx(['stats']);
    assert.strictEqual(build.status, 0, `build failed:\n${build.output}`);
    assert.strictEqual(stats.status, 0, `stats failed:\n${stats.output}`);

    assert.ok(
      !stats.output.includes('AVX_W49'),
      'a scaffolded component declares every block its template names, so stats ' +
        `must not report AVX_W49. Output was:\n${stats.output}`,
    );
    assert.deepStrictEqual(
      codes(stats.output),
      codes(build.output),
      'stats and build must report the same diagnostics for the same project',
    );
  }
  console.log('  ✅ a scaffolded project is silent for stats as well as build');

  // 2. It still measures. A regression that skipped the stylesheet entirely
  //    would satisfy the assertion above and lose the CSS column.
  {
    const stats = avenx(['stats']);
    assert.ok(/Scoped CSS Payload:\s+[1-9]/.test(stats.output),
      `stats must still measure the scoped CSS payload. Output was:\n${stats.output}`);
    assert.ok(/\bCard\b/.test(stats.output), 'and still list the component');
  }
  console.log('  ✅ the CSS payload is still measured');

  // 3. The check is not weakened: a block the stylesheet does not declare is
  //    still reported, by stats and by build alike.
  {
    fs.writeFileSync(
      path.join(root, 'src/components/card/card.component.js'),
      '<div @css nosuchblock>x</div>\n',
    );
    const build = avenx(['build']);
    const stats = avenx(['stats']);
    assert.ok(build.output.includes('AVX_W49'), 'build reports a genuinely undeclared block');
    assert.ok(
      stats.output.includes('AVX_W49'),
      `stats must still report a genuinely undeclared block. Output was:\n${stats.output}`,
    );
    assert.ok(stats.output.includes('nosuchblock'), 'and name it');
  }
  console.log('  ✅ a genuinely undeclared block is still reported');

  console.log('✅ stats style block tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
