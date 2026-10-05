/**
 * @file scaffoldCleanBuild.test.js
 * @description What the CLI scaffolds must build without warning about itself.
 *
 * A developer's first contact with a diagnostic should never be the framework
 * complaining about code the framework wrote. If `avenx init` plus
 * `avenx generate` produces warnings, a new user learns on day one that the
 * build output is noise to scroll past -- which is precisely when AVX_W53 or
 * AVX_W55 stops being able to tell them anything.
 *
 * This was not hypothetical. The page scaffold shipped a stylesheet written as
 * a CSS selector (`.page-container { ... }`) and a template using
 * `class="page-container"`, so every generated page carried a stylesheet that
 * emitted nothing at all. The component scaffold beside it had always used
 * `@css` correctly, so the two disagreed about how the framework works and
 * nothing noticed, because neither produced an error.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-scaffold-'));
const routingRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-routing-scaffold-'));

/**
 * Runs the CLI in the scaffolded project.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, output: string}} The result.
 */
function avenx(args, cwd = root) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

try {
  console.log('🧪 Testing that a scaffolded project builds clean...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');

  // VS Code custom data ships in every scaffold. Its Avenx attributes must
  // match names the compiler actually handles, not merely valid HTML attrs.
  {
    const repoRoot = path.resolve(__dirname, '../..');
    const editorData = JSON.parse(
      fs.readFileSync(path.join(root, '.vscode/avenx.html-data.json'), 'utf8'),
    );
    const compilerAttributeNames = new Set();
    for (const sourcePath of ['lib/compiler/codegen/collect.js', 'lib/compiler/ir/build.js']) {
      const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8');
      for (const [, name] of source.matchAll(/['"]((?:data-ax|data-avenx)-[a-z0-9-]+)['"]/g)) {
        compilerAttributeNames.add(name);
      }
    }

    const customAttributes = editorData.globalAttributes
      .map(({ name }) => name)
      .filter((name) => name.startsWith('data-ax-'));
    for (const name of customAttributes) {
      assert.ok(
        compilerAttributeNames.has(name),
        `scaffolded VS Code data advertises unsupported Avenx attribute ${name}`,
      );
    }

    assert.ok(customAttributes.includes('data-ax-bind'), 'two-way binding completion should use data-ax-bind');
    assert.ok(!customAttributes.includes('data-ax-model'), 'the unsupported data-ax-model alias must not be suggested');
    const customTags = new Set(editorData.tags.map(({ name }) => name));
    assert.ok(customTags.has('@loading'), 'the defer loading alias should have completion data');
    assert.ok(customTags.has('@elif'), 'the conditional alias should have completion data');
  }
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate page should succeed');
  assert.strictEqual(avenx(['generate', 'component', 'Widget']).status, 0, 'generate component should succeed');

  // The one thing the scaffold does not do for the developer, and says so.
  fs.appendFileSync(path.join(root, 'src/main.app.js'), "\napp.initRouter({ '/': 'Home' });\n");

  const build = avenx(['build']);
  assert.strictEqual(build.status, 0, `the scaffolded project must build:\n${build.output}`);

  const codes = [...new Set(build.output.match(/AVX_[A-Z]\d+/g) || [])];
  assert.deepStrictEqual(
    codes,
    [],
    `a freshly scaffolded project must build without diagnostics, but reported ` +
      `${codes.join(', ')}:\n${build.output}`,
  );
  console.log('  ✅ init + generate page + generate component builds with no diagnostics');

  // --- the scaffolded stylesheets actually produce rules ------------------
  {
    const css = fs.readFileSync(path.join(root, 'dist', 'bundle.css'), 'utf8');
    const rules = css.split('\n').filter((line) => line.trim().startsWith('.avenx-'));
    assert.ok(
      rules.length > 0,
      'the scaffolded page stylesheet must emit rules. It shipped as a CSS ' +
        'selector for a long time, which emits nothing and says nothing.\n' +
        css,
    );
    assert.ok(
      /padding/.test(css),
      'the page scaffold declares padding; it should reach the stylesheet',
    );
    console.log(`  ✅ the scaffolded stylesheets emit ${rules.length} rules`);
  }

  // --- the page and component scaffolds agree on how styling works --------
  {
    const repoRoot = path.resolve(__dirname, '../..');
    for (const name of ['page/page', 'component/component']) {
      const template = fs.readFileSync(path.join(repoRoot, 'templates', `${name}.js.template`), 'utf8');
      const stylesheet = fs.readFileSync(path.join(repoRoot, 'templates', `${name}.css.template`), 'utf8');

      assert.ok(/@css\s+[\w-]+/.test(template), `${name}.js.template should attach a style block with @css`);
      assert.ok(
        !/^\s*\.[\w-]+\s*\{/m.test(stylesheet),
        `${name}.css.template declares a block with a leading dot. An Avenx style ` +
          'block is a name, not a selector, and a name starting with "." can never ' +
          'be attached.',
      );
    }
    console.log('  ✅ the page and component scaffolds both use named style blocks');
  }

  // --- routing scaffold builds without warnings ---------------------------
  {
    const init = avenx(['init', '--layout', 'routing'], routingRoot);
    assert.strictEqual(init.status, 0, `routing init should succeed:\n${init.output}`);

    const navbarPath = path.join(
      routingRoot,
      'src/components/navbar/navbar.component.js',
    );
    const navbar = fs.readFileSync(navbarPath, 'utf8');
    assert.ok(
      navbar.includes(
        'aria-current="{{ activeRoute === \'#/\' ? \'page\' : \'\' }}"',
      ),
      'the Home link should expose aria-current="page" when #/ is active',
    );
    assert.ok(
      navbar.includes(
        'aria-current="{{ activeRoute === \'#/about\' ? \'page\' : \'\' }}"',
      ),
      'the About link should expose aria-current="page" when #/about is active',
    );

    const routingBuild = avenx(['build'], routingRoot);
    assert.strictEqual(
      routingBuild.status,
      0,
      `the routing scaffold must build:\n${routingBuild.output}`,
    );

    const routingCodes = [
      ...new Set(routingBuild.output.match(/AVX_[A-Z]\d+/g) || []),
    ];
    assert.deepStrictEqual(
      routingCodes,
      [],
      `a fresh routing scaffold must build without diagnostics, but reported ` +
        `${routingCodes.join(', ')}:\n${routingBuild.output}`,
    );
    assert.ok(
      !/\bwarning\b/i.test(routingBuild.output),
      `a fresh routing scaffold must build without warnings:\n${routingBuild.output}`,
    );

    console.log('  ✅ routing scaffold builds with no warnings');
  }

  console.log('✅ Scaffold clean-build tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(routingRoot, { recursive: true, force: true });
}
