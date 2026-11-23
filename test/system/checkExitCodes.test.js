/**
 * @file checkExitCodes.test.js
 * @description The exit codes `avenx check` promises, and its JSON shape.
 *
 * The CLI reference recommends this command for CI pipelines, which makes its
 * exit code the single most important thing about it -- and until now the
 * section never stated one. It is deliberately stricter than `avenx build`:
 * a warning fails `check` and does not fail `build`. Two different contracts
 * on the same diagnostics is a reasonable design and an unreasonable surprise,
 * so both are now documented and both are asserted here.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');
const DOCS = path.join(__dirname, '../../docs/src/content/docs/cli-reference/commands.md');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-check-exit-'));

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
 * Replaces the fixture page, and its stylesheet along with it.
 *
 * The stylesheet has to go too: the scaffold generates a `container` block and
 * a template that names it, so replacing only the template leaves a declared
 * block nothing uses and the project reports AVX_W55 for a reason that has
 * nothing to do with what is being tested.
 * @param {string} template - The page source.
 * @returns {void}
 */
function page(template) {
  fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), template);
  fs.writeFileSync(path.join(root, 'src/pages/home.page.css'), '');
}

try {
  console.log('🧪 Testing avenx check exit codes...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate should succeed');
  fs.appendFileSync(path.join(root, 'src/main.app.js'), "\napp.initRouter({ '/': 'Home' });\n");

  // --- a clean project passes both ---------------------------------------
  {
    page('<state title="Home" />\n<h1>{{ title }}</h1>');
    assert.strictEqual(avenx(['check']).status, 0, 'a clean project must pass check');
    assert.strictEqual(avenx(['build']).status, 0, 'and must build');
    console.log('  ✅ a clean project exits 0 from both check and build');
  }

  // --- a warning fails check but not build -------------------------------
  {
    page('<state title="Home" />\n<h1>{{ nope }}</h1>');
    const check = avenx(['check']);
    const build = avenx(['build']);
    assert.strictEqual(check.status, 1, `a warning must fail check:\n${check.output}`);
    assert.strictEqual(build.status, 0, `the same warning must not fail build:\n${build.output}`);
    console.log('  ✅ a warning fails check and does not fail build');
  }

  // --- an error fails both ------------------------------------------------
  {
    page('<state title="Home" />\n<action name="x">1');
    assert.strictEqual(avenx(['check']).status, 1, 'an error fails check');
    assert.strictEqual(avenx(['build']).status, 1, 'and fails build');
    console.log('  ✅ a compiler error fails both');
  }

  // --- the JSON shape the reference promises ------------------------------
  {
    page('<state title="Home" />\n<h1>{{ nope }}</h1>');
    const { status, output } = avenx(['check', '--json']);
    assert.strictEqual(status, 1, 'the exit code is the same with --json');

    const parsed = JSON.parse(output.slice(output.indexOf('{')));
    for (const key of ['valid', 'errorCount', 'warningCount', 'diagnostics']) {
      assert.ok(key in parsed, `the JSON must carry "${key}"`);
    }
    assert.strictEqual(parsed.valid, false, 'a project with diagnostics is not valid');
    assert.ok(parsed.diagnostics.length > 0, 'and lists them');
    for (const key of ['file', 'code', 'severity', 'message']) {
      assert.ok(key in parsed.diagnostics[0], `each diagnostic must carry "${key}"`);
    }
    console.log('  ✅ --json has the documented shape and the same exit code');
  }

  // --- the reference actually documents this ------------------------------
  {
    const docs = fs.readFileSync(DOCS, 'utf8');
    const section = docs.slice(docs.indexOf('`avenx check`'));
    assert.ok(
      /Exit codes/.test(section.slice(0, 2000)),
      'the check section must state its exit codes -- it is recommended for CI',
    );
    const headings = [...docs.matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1]));
    assert.deepStrictEqual(
      headings,
      [...headings].sort((a, b) => a - b),
      `the numbered command sections must read in order, got ${headings.join(', ')}`,
    );
    console.log('  ✅ the reference documents the exit codes and numbers sections in order');
  }

  console.log('✅ avenx check exit code tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
