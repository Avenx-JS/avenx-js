/**
 * @file unregisteredComponent.test.js
 * @description AVX_W56 -- a template renders a component nothing registers.
 *
 * Pages under `src/pages` are registered by the compiler. Components are not:
 * an application must call `app.register()` for each one, and `avenx generate
 * component` writes that call into main.app.js. Rewrite main.app.js by hand --
 * to add routing, say -- and the registrations go with it.
 *
 * A component a template uses but nothing registers renders nothing. The host
 * element stays empty, the build is clean, `avenx check` passes, and the only
 * sign is AVX_W13 in the browser console once someone opens the page. Found by
 * building a catalogue app whose four product rows each rendered a price tag:
 * the rows appeared and every price tag was missing.
 *
 * The absence claim is guarded the way Atlas guards the others: a `register()`
 * call whose name is computed at run time means any component could be
 * registered, so nothing is reported for that application at all.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-unregistered-'));

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
 * Writes main.app.js.
 * @param {string[]} lines - The file's lines.
 * @returns {void}
 */
function mainApp(lines) {
  fs.writeFileSync(path.join(root, 'src/main.app.js'), lines.join('\n') + '\n');
}

const IMPORT_WIDGET = "import Widget from './components/widget/widget.component.js';";
const BASE = ["import { AvenxApp } from 'avenx-core/runtime';", IMPORT_WIDGET];
const APP = "const app = new AvenxApp({ target: '#app' });";
const ROUTER = "app.initRouter({ '/': 'Home' });";

try {
  console.log('🧪 Testing AVX_W56 (unregistered component)...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate page should succeed');
  assert.strictEqual(avenx(['generate', 'component', 'Widget']).status, 0, 'generate component should succeed');

  const widgetDir = path.join(root, 'src/components/widget');
  fs.writeFileSync(path.join(widgetDir, 'widget.component.js'), '<p>widget</p>');
  fs.writeFileSync(path.join(widgetDir, 'widget.component.css'), '');
  fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), '<div><Widget /></div>');
  fs.writeFileSync(path.join(root, 'src/pages/home.page.css'), '');

  // --- a rendered component nothing registers is reported ----------------
  {
    mainApp([...BASE, '', APP, '', ROUTER]);
    const { status, output } = avenx(['build']);
    assert.strictEqual(status, 0, 'it is a warning, not a build failure');
    assert.ok(/AVX_W56/.test(output), `expected AVX_W56, got:\n${output}`);
    assert.ok(/Widget/.test(output), 'the component is named');
    assert.ok(/Home/.test(output), 'and so is the template that renders it');
    assert.ok(
      /app\.register\('Widget', Widget\)/.test(output),
      `the message should print the exact line to add, got:\n${output}`,
    );
    assert.ok(
      !/\{\d\}/.test(output),
      `every placeholder must be substituted, but one survived:\n${output}`,
    );
    console.log('  ✅ a rendered component nothing registers is reported');
  }

  // --- registering it silences the warning -------------------------------
  {
    mainApp([...BASE, '', APP, '', "app.register('Widget', Widget);", '', ROUTER]);
    const { status, output } = avenx(['build']);
    assert.strictEqual(status, 0, 'the build still succeeds');
    assert.ok(!/AVX_W56/.test(output), `registering it must silence the warning:\n${output}`);
    console.log('  ✅ registering the component silences it');
  }

  // --- a component nothing renders is not reported -----------------------
  {
    fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), '<div>no components here</div>');
    mainApp([...BASE, '', APP, '', ROUTER]);
    const { output } = avenx(['build']);
    assert.ok(
      !/AVX_W56/.test(output),
      `an unused component needs no registration, so nothing to report:\n${output}`,
    );
    fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), '<div><Widget /></div>');
    console.log('  ✅ a component nothing renders is not reported');
  }

  // --- a dynamic registration suppresses the claim entirely --------------
  {
    mainApp([
      ...BASE,
      '',
      APP,
      '',
      "const name = 'Widget';",
      'app.register(name, Widget);',
      '',
      ROUTER,
    ]);
    const { output } = avenx(['build']);
    assert.ok(
      !/AVX_W56/.test(output),
      'a name computed at run time could register any component, so no absence ' +
        `claim is safe anywhere in the application:\n${output}`,
    );
    console.log('  ✅ a run-time registration name suppresses the claim');
  }

  // --- the warning is configurable ---------------------------------------
  {
    mainApp([...BASE, '', APP, '', ROUTER]);
    fs.writeFileSync(
      path.join(root, 'avenx.config.json'),
      JSON.stringify({ warnings: { AVX_W56: 'off' } }, null, 2),
    );
    assert.ok(!/AVX_W56/.test(avenx(['build']).output), '"off" silences it');

    fs.writeFileSync(
      path.join(root, 'avenx.config.json'),
      JSON.stringify({ warnings: { AVX_W56: 'error' } }, null, 2),
    );
    const escalated = avenx(['build']);
    assert.notStrictEqual(escalated.status, 0, '"error" fails the build');
    assert.ok(/AVX_W56/.test(escalated.output), 'and still reports the code');
    console.log('  ✅ honours "off" and "error" in avenx.config.json');
  }

  console.log('✅ AVX_W56 tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
