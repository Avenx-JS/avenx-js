/**
 * @file dynamicAttributeProduction.test.js
 * @description `:[expr]="expr"` must work in a production bundle, not only in development.
 *
 * A dynamic attribute name is documented in the API reference, has its own
 * runtime security guard (AVX_R35), and is listed in the rendering guide as a
 * construct that falls back to the string renderer. That renderer resolves both
 * sides at run time through the component's expression table.
 *
 * Neither side was ever collected into that table. `:[dynamicKey]` is not an
 * interpolation, so the collector's `{{ }}` scans passed over both the
 * bracketed name and the attribute value, and nothing was compiled.
 *
 * A development bundle still carries the interpreter, so it evaluated the
 * source text and the feature worked. A production bundle carries none, so both
 * sides resolved to nothing: the directive was consumed and no attribute was
 * set. Same source, same command bar `--dev`, and the build said nothing --
 * exactly the shape that should fail loudly as AVX_C27 if it cannot be
 * compiled.
 *
 * Measured in a browser before the fix: development produced
 * `aria-expanded="true"`, production produced an element with no attributes.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-dyn-attr-'));

/**
 * Runs the CLI in the fixture project.
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
 * Builds in production and returns the bundle and the compiled expression table.
 * @param {string} component - The component template.
 * @returns {{bundle: string, table: string, output: string}} The build.
 */
function buildProduction(component) {
  fs.writeFileSync(path.join(root, 'src/components/probe/probe.component.js'), component);
  const build = avenx(['build']);
  assert.strictEqual(build.status, 0, `build failed:\n${build.output}`);
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8');
  const table = (bundle.match(/Probe\.__axExprs\s*=\s*\{[\s\S]*?\n\};/) || [''])[0];
  return { bundle, table, output: build.output };
}

try {
  console.log('🧪 Testing dynamic attribute names in a production build...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate page should succeed');
  assert.strictEqual(avenx(['generate', 'component', 'Probe']).status, 0, 'generate component should succeed');
  fs.writeFileSync(path.join(root, 'src/components/probe/probe.component.css'), '');
  fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), '<div><Probe data-props-pn="\'data-p\'" data-props-pv="\'pv\'" /></div>');
  fs.writeFileSync(path.join(root, 'src/pages/home.page.css'), '');
  fs.writeFileSync(
    path.join(root, 'src/main.app.js'),
    [
      "import { AvenxApp } from 'avenx-core/runtime';",
      "import Probe from './components/probe/probe.component.js';",
      "const app = new AvenxApp({ target: '#app' });",
      "app.register('Probe', Probe);",
      "app.initRouter({ '/': 'Home' });",
      '',
    ].join('\n'),
  );

  // --- both sides of the directive reach the compiled table --------------
  {
    const { table, output } = buildProduction(
      '<state dynamicKey="\'aria-expanded\'" dynamicVal="\'true\'" />\n' +
        '<button :[dynamicKey]="dynamicVal">Submit</button>',
    );
    assert.ok(table, 'the component should emit a compiled expression table');
    assert.ok(
      /dynamicKey/.test(table),
      `the bracketed attribute *name* must be compiled, or production has no way ` +
        `to resolve it. Table was:\n${table}`,
    );
    assert.ok(
      /dynamicVal/.test(table),
      `the attribute value must be compiled too. Table was:\n${table}`,
    );
    assert.ok(!/AVX_C27/.test(output), 'and it must not be reported as unexecutable');
    console.log('  ✅ both the bracketed name and the value are compiled');
  }

  // --- a props-driven name is compiled too -------------------------------
  {
    const { table } = buildProduction('<span :[props.pn]="props.pv">x</span>');
    assert.ok(/props\.pn/.test(table), 'a props-driven attribute name is compiled');
    assert.ok(/props\.pv/.test(table), 'and so is its value');
    console.log('  ✅ a props-driven dynamic attribute is compiled');
  }

  // --- the production bundle still carries no interpreter ----------------
  {
    const { bundle, output } = buildProduction(
      '<state k="\'data-x\'" v="\'1\'" />\n<span :[k]="v">x</span>',
    );
    for (const forbidden of ['eval(', 'new Function']) {
      assert.ok(
        !bundle.includes(forbidden),
        `the fix must not reintroduce ${forbidden} into a production bundle`,
      );
    }
    assert.ok(
      /AVX_W47/.test(output),
      'the construct still falls back to the string renderer, as the rendering ' +
        'guide documents, and the build still says so',
    );
    console.log('  ✅ production stays free of eval/new Function, and still reports AVX_W47');
  }

  // --- development and production compile the same expressions -----------
  {
    const component = '<state k="\'data-x\'" v="\'1\'" />\n<span :[k]="v">x</span>';
    const prod = buildProduction(component).table;

    fs.writeFileSync(path.join(root, 'src/components/probe/probe.component.js'), component);
    const dev = avenx(['build', '--dev']);
    assert.strictEqual(dev.status, 0, `dev build failed:\n${dev.output}`);
    const devBundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8');

    for (const source of ['k', 'v']) {
      assert.ok(
        new RegExp(`"${source}"`).test(prod),
        `production must compile "${source}"; a development build resolves it ` +
          'through the interpreter either way, which is what hid this',
      );
    }
    assert.ok(devBundle.length > 0, 'the development build still produces a bundle');
    console.log('  ✅ production compiles what development could interpret');
  }

  console.log('✅ Dynamic attribute production tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
