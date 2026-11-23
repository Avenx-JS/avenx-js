/**
 * @file scaffoldNoStyleBuild.test.js
 * @description `avenx generate ... --no-style` writes no stylesheet and still builds clean.
 *
 * A project that styles components another way (Tailwind, a global stylesheet)
 * got a `.component.css` or `.page.css` with every scaffold and had to delete it.
 * Deleting only the stylesheet is not enough: the template still names `@css`
 * blocks, which then raise AVX_W49. So `--no-style` has to drop both.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-no-style-'));

/**
 * Runs the CLI in the scaffolded project.
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

try {
  console.log('🧪 Testing scaffolds generated with --no-style...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');

  const dryRun = avenx(['generate', 'component', 'Plain', '--no-style', '--dry-run']);
  assert.strictEqual(dryRun.status, 0, `the dry run should succeed:\n${dryRun.output}`);
  assert.ok(dryRun.output.includes('plain.component.js'), 'the dry run should list the template');
  assert.ok(!dryRun.output.includes('plain.component.css'), 'the dry run should not list a stylesheet');

  const page = avenx(['generate', 'page', 'Home', '--no-style']);
  assert.strictEqual(page.status, 0, `generate page --no-style should succeed:\n${page.output}`);
  const component = avenx(['generate', 'component', 'Widget', '--no-style']);
  assert.strictEqual(component.status, 0, `generate component --no-style should succeed:\n${component.output}`);

  const pageTemplate = path.join(root, 'src/pages/home.page.js');
  const componentTemplate = path.join(root, 'src/components/widget/widget.component.js');
  assert.ok(fs.existsSync(pageTemplate), 'the page template should be written');
  assert.ok(fs.existsSync(componentTemplate), 'the component template should be written');
  assert.ok(!fs.existsSync(path.join(root, 'src/pages/home.page.css')), 'no page stylesheet should be written');
  assert.ok(
    !fs.existsSync(path.join(root, 'src/components/widget/widget.component.css')),
    'no component stylesheet should be written',
  );

  for (const template of [pageTemplate, componentTemplate]) {
    const source = fs.readFileSync(template, 'utf8');
    assert.ok(!source.includes('@css'), `${path.basename(template)} should name no style block:\n${source}`);
  }
  assert.ok(
    fs.readFileSync(componentTemplate, 'utf8').includes('<button @click="count++">Increment</button>'),
    'the rest of the component template should be kept',
  );

  // Route the page, as the scaffold tells the developer to (see scaffoldCleanBuild.test.js).
  fs.appendFileSync(path.join(root, 'src/main.app.js'), "\napp.initRouter({ '/': 'Home' });\n");

  const build = avenx(['build']);
  assert.strictEqual(build.status, 0, `the project should build:\n${build.output}`);
  const codes = [...new Set(build.output.match(/AVX_[A-Z]\d+/g) || [])];
  assert.deepStrictEqual(codes, [], `a --no-style scaffold should build without diagnostics:\n${build.output}`);

  console.log('  ✅ --no-style writes no stylesheet, leaves no @css reference and builds clean');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
