/**
 * @file routeParamValidation.test.js
 * @description Route parameters are declared state, and the validator knows it.
 *
 * `mountPage` assigns every entry of a route's `params` straight into the
 * page instance's state, so a page routed as `'/profile/:id'` genuinely has
 * `id` in scope. The template validator only ever read `<state>`, so `{{ id }}`
 * was reported as an undeclared reference (AVX_W03).
 *
 * That made the routing tutorial fail its own advice. The tutorial documents
 * route parameters, tells the reader to render `{{ id }}`, and the result --
 * which works perfectly in a browser -- produced three warnings and exited 1
 * from `avenx check`. Since the CLI reference recommends `check` for CI, the
 * documented feature failed the documented pipeline.
 *
 * The risk in fixing this is over-correction: a blanket exemption would stop
 * AVX_W03 catching real typos on every routed page. Most of this file is
 * therefore about what must still warn.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-route-params-'));

/**
 * Runs the CLI in the fixture project.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, output: string, codes: string[]}} The result.
 */
function avenx(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const output = (res.stdout || '') + (res.stderr || '');
  return { status: res.status, output, codes: output.match(/AVX_W03/g) || [] };
}

/**
 * Writes a page and blanks its stylesheet, so only the template is under test.
 * @param {string} name - Kebab-case page file name.
 * @param {string} template - The page source.
 * @returns {void}
 */
function page(name, template) {
  fs.writeFileSync(path.join(root, `src/pages/${name}.page.js`), template);
  fs.writeFileSync(path.join(root, `src/pages/${name}.page.css`), '');
}

/**
 * Returns the identifiers AVX_W03 named in the output.
 * @param {string} output - CLI output.
 * @returns {string[]} The identifiers, deduplicated and sorted.
 */
function undeclared(output) {
  const names = [...output.matchAll(/Undeclared variable or method "([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

try {
  console.log('🧪 Testing route parameter validation...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  for (const name of ['home', 'profile']) {
    assert.strictEqual(avenx(['generate', 'page', name]).status, 0, `generate ${name} should succeed`);
  }
  fs.writeFileSync(
    path.join(root, 'src/main.app.js'),
    [
      "import { AvenxApp } from 'avenx-core/runtime';",
      "const app = new AvenxApp({ target: '#app' });",
      'app.initRouter({',
      "  '/': 'Home',",
      "  '/profile/:id': 'Profile',",
      '});',
      '',
    ].join('\n'),
  );

  // --- a route parameter is not undeclared -------------------------------
  {
    page('home', '<state title="Home" />\n<h1>{{ title }}</h1>');
    page('profile', '<state activeTab="\'overview\'" />\n<h1>User {{ id }}</h1>\n<p>{{ activeTab }}</p>');

    const check = avenx(['check']);
    assert.deepStrictEqual(
      undeclared(check.output),
      [],
      `a documented route parameter must not be reported as undeclared:\n${check.output}`,
    );
    assert.strictEqual(check.status, 0, 'and the project must pass check');
    console.log('  ✅ a route parameter is not reported as undeclared');
  }

  // --- query is available on a routed page -------------------------------
  {
    page('profile', '<state a="1" />\n<p>{{ query }}</p>');
    assert.deepStrictEqual(
      undeclared(avenx(['check']).output),
      [],
      'any route can be visited with a query string, so `query` is in scope',
    );
    console.log('  ✅ `query` is in scope on a routed page');
  }

  // --- a wildcard route puts `wildcard` in scope --------------------------
  {
    fs.writeFileSync(
      path.join(root, 'src/main.app.js'),
      [
        "import { AvenxApp } from 'avenx-core/runtime';",
        "const app = new AvenxApp({ target: '#app' });",
        'app.initRouter({',
        "  '': { page: 'Home', title: 'Home' },",
        "  '/docs/*': { page: 'Docs', title: 'Docs' },",
        "  '/profile/:id': { page: 'Profile', title: 'Profile' },",
        "  '*': { page: 'Home', title: 'Home' },",
        '});',
        '',
      ].join('\n'),
    );
    assert.strictEqual(avenx(['generate', 'page', 'docs']).status, 0, 'generate docs should succeed');
    page('docs', '<state a="1" />\n<h1>DOCS wildcard={{ wildcard }}</h1>');

    const check = avenx(['check']);
    assert.deepStrictEqual(
      undeclared(check.output),
      [],
      `the routing guide's wildcard example must not be reported as undeclared:\n${check.output}`,
    );
    assert.strictEqual(check.status, 0, 'and the project must pass check');
    console.log('  ✅ `wildcard` is in scope on a wildcard-routed page');
  }

  // --- wildcard stays scoped to the pages its routes name -----------------
  {
    page('profile', '<state a="1" />\n<p>{{ wildcard }} {{ notAThing }}</p>');
    const output = avenx(['check']).output;
    assert.deepStrictEqual(
      undeclared(output),
      ['notAThing', 'wildcard'],
      'Profile is not routed with a wildcard, so `wildcard` is undeclared there; ' +
        'the real mistake is reported beside it',
    );
    console.log('  ✅ `wildcard` stays scoped and real typos still warn');
    // The remaining blocks assume the fixture's original two-page project.
    fs.rmSync(path.join(root, 'src/pages/docs.page.js'), { force: true });
    fs.rmSync(path.join(root, 'src/pages/docs.page.css'), { force: true });
  }

  // --- a genuine typo on the same page still warns -----------------------
  {
    page('profile', '<state a="1" />\n<p>{{ id }} {{ notAThing }}</p>');
    const output = avenx(['check']).output;
    assert.deepStrictEqual(
      undeclared(output),
      ['notAThing'],
      `only the real mistake may be reported, not the route parameter:\n${output}`,
    );
    console.log('  ✅ a real typo beside a route parameter is still reported');
  }

  // --- the parameter is scoped to the page its route names ---------------
  {
    page('profile', '<state a="1" />\n<p>{{ id }}</p>');
    page('home', '<state a="1" />\n<p>{{ id }}</p>');
    const output = avenx(['check']).output;
    assert.deepStrictEqual(
      undeclared(output),
      ['id'],
      'Home is not routed with :id, so `id` is undeclared there and declared on ' +
        `Profile. Exactly one report expected:\n${output}`,
    );
    // Only the AVX_W03 lines: the rest of the output carries "[Compiling Page]"
    // progress naming every page, profile included.
    const reported = output.split('\n').filter((line) => line.includes('AVX_W03')).join('\n');
    assert.ok(/home\.page\.js/.test(reported), `the warning must name home.page.js:\n${reported}`);
    assert.ok(!/profile\.page\.js/.test(reported), `and not profile.page.js:\n${reported}`);
    console.log('  ✅ a parameter is scoped to the page its route names');
  }

  // --- a component is unaffected -----------------------------------------
  {
    page('home', '<state a="1" />\n<p>{{ a }}</p>');
    page('profile', '<state a="1" />\n<p>{{ id }}</p>');
    assert.strictEqual(avenx(['generate', 'component', 'Widget']).status, 0);
    const dir = path.join(root, 'src/components/widget');
    fs.writeFileSync(path.join(dir, 'widget.component.js'), '<state a="1" />\n<p>{{ id }}</p>');
    fs.writeFileSync(path.join(dir, 'widget.component.css'), '');

    const output = avenx(['check']).output;
    assert.deepStrictEqual(
      undeclared(output),
      ['id'],
      'a component is never routed, so nothing declares `id` there',
    );
    const reportedComponent = output.split('\n').filter((line) => line.includes('AVX_W03')).join('\n');
    assert.ok(
      /widget\.component\.js/.test(reportedComponent),
      `the warning must name the component:\n${reportedComponent}`,
    );
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  ✅ a component gets no route-parameter exemption');
  }

  // --- a project with no route table is unchanged ------------------------
  {
    fs.writeFileSync(
      path.join(root, 'src/main.app.js'),
      "import { AvenxApp } from 'avenx-core/runtime';\nconst app = new AvenxApp({ target: '#app' });\n",
    );
    page('profile', '<state a="1" />\n<p>{{ id }}</p>');
    assert.deepStrictEqual(
      undeclared(avenx(['check']).output),
      ['id'],
      'with nothing routed, no parameter is in scope and the warning stands',
    );
    console.log('  ✅ a project with no route table keeps the previous behaviour');
  }

  console.log('✅ Route parameter validation tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
