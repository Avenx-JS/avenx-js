/**
 * @file dataPropsContract.test.js
 * @description `data-props-<name>="<expression>"` — the documented prop form.
 *
 * This is public API. The templates guide gives it a section of its own
 * ("Passing Props to Child Components (`data-props-*`)"), and both the React
 * and Vue migration guides teach it as *the* way to pass props, with an
 * explicit contract: "The parser evaluates the attribute's value as an
 * expression in the parent's scope."
 *
 * The string renderer always implemented that contract. The compiled render
 * program never learned it, so the attribute fell through to the generic
 * static-attribute path and both halves came out wrong:
 *
 *   <Probe data-props-user="state.currentUser" />
 *     -> prop named `data-props-user`, not `user`
 *     -> carrying the source text "state.currentUser", not the value
 *
 * The child read `props.user` and got undefined. Every documented example --
 * three guides -- silently passed nothing, with a clean build, a passing
 * `avenx check`, and an empty browser console.
 *
 * A second defect sat beside it: the shared template walk never collected these
 * attributes, so a typo in a prop expression was never reported and state read
 * only by one was reported as "read nowhere in the application".
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-data-props-'));

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
 * Compiles a page and returns the prop ops and expressions for its program.
 * @param {string} template - The page template.
 * @returns {{ops: object[], exprs: string[], output: string}} The compiled program.
 */
function compile(template) {
  fs.writeFileSync(path.join(root, 'src/pages/home.page.js'), template);
  const build = avenx(['build']);
  assert.strictEqual(build.status, 0, `build failed:\n${build.output}`);

  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8');
  const program = bundle.match(/Home\.__axProgram = (\{[\s\S]*?\});/);
  assert.ok(program, 'the page should compile to a render program');
  const parsed = JSON.parse(program[1]);

  const table = bundle.match(/Home\.__axProgramExprs = \[([\s\S]*?)\n\];/);
  const exprs = table ? table[1].split('\n').filter((line) => line.trim()) : [];

  return {
    ops: (parsed.ops || []).filter((op) => op.k === 'prop'),
    exprs,
    output: build.output,
  };
}

try {
  console.log('🧪 Testing the data-props-* contract...');

  assert.strictEqual(avenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'Home']).status, 0, 'generate page should succeed');
  assert.strictEqual(avenx(['generate', 'component', 'Probe']).status, 0, 'generate component should succeed');

  fs.writeFileSync(path.join(root, 'src/components/probe/probe.component.js'), '<span>{{ props.a }}</span>');
  fs.writeFileSync(path.join(root, 'src/components/probe/probe.component.css'), '');
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

  // --- the prop is named without the prefix ------------------------------
  {
    const { ops } = compile('<state title="\'Ada\'" />\n<Probe data-props-user="title" />');
    assert.strictEqual(ops.length, 1, 'one prop op');
    assert.strictEqual(
      ops[0].n,
      'user',
      `the child receives "user", not "data-props-user" (got "${ops[0].n}")`,
    );
    console.log('  ✅ the prefix is stripped from the prop name');
  }

  // --- the value is evaluated as an expression ---------------------------
  {
    const { ops, exprs } = compile('<state title="\'Ada\'" />\n<Probe data-props-user="title" />');
    const source = exprs[ops[0].x] || '';
    assert.ok(
      /axGet\(\$s, "title"\)/.test(source),
      `the value must compile to a read of state, not to the literal string ` +
        `"title". Got: ${source}`,
    );
    console.log('  ✅ the value compiles to an expression, not a literal');
  }

  // --- the documented state. prefix works --------------------------------
  {
    const { ops, exprs } = compile(
      '<state title="\'Ada\'" user="{ name: \'Grace\' }" />\n' +
        '<Probe data-props-a="state.title" data-props-b="state.user.name" />',
    );
    assert.deepStrictEqual(ops.map((op) => op.n).sort(), ['a', 'b'], 'both props are named');
    assert.ok(
      ops.every((op) => !/^"/.test(exprs[op.x] || '')),
      'the guide writes state.currentUser; that form must evaluate',
    );
    console.log('  ✅ the documented "state." prefix evaluates');
  }

  // --- a quoted literal stays a string -----------------------------------
  {
    const { ops, exprs } = compile('<Probe data-props-title="\'Account Overview\'" />');
    assert.strictEqual(ops[0].n, 'title');
    assert.ok(
      /Account Overview/.test(exprs[ops[0].x] || ''),
      'a quoted literal passes the string, as the migration guide states',
    );
    console.log('  ✅ a quoted literal passes the string');
  }

  // --- an interpolated value is accepted rather than silently wrong ------
  {
    const { ops, exprs } = compile('<state title="\'Ada\'" />\n<Probe data-props-user="{{ title }}" />');
    assert.strictEqual(ops[0].n, 'user', 'mixing the two prop forms still names the prop');
    assert.ok(
      /axGet\(\$s, "title"\)/.test(exprs[ops[0].x] || ''),
      'and still reads the state it names',
    );
    console.log('  ✅ an interpolated value is read, not passed as braces');
  }

  // --- an empty attribute does not compile a syntax error ----------------
  {
    const { ops } = compile('<Probe data-props-user="" />');
    assert.strictEqual(ops[0].n, 'user', 'the prop is still named');
    console.log('  ✅ an empty attribute compiles without error');
  }

  // --- the plain attribute form is unchanged -----------------------------
  {
    const { ops, exprs } = compile('<state title="\'Ada\'" />\n<Probe a="{{ title }}" b="lit" />');
    assert.deepStrictEqual(ops.map((op) => op.n).sort(), ['a', 'b'], 'plain attributes still pass props');
    const bOp = ops.find((op) => op.n === 'b');
    assert.ok(/"lit"|'lit'/.test(exprs[bOp.x] || ''), 'a plain literal attribute is still a string');
    console.log('  ✅ the plain attribute form is unchanged');
  }

  // --- state read only by a prop expression is not "read nowhere" --------
  {
    const { output } = compile('<state title="\'Ada\'" />\n<Probe data-props-user="title" />');
    assert.ok(
      !/AVX_W40/.test(output),
      `a prop expression is a read. Reporting the state as read nowhere would ` +
        `tell the developer to delete state a child depends on.\n${output}`,
    );
    console.log('  ✅ state read by a prop expression is not reported as unread');
  }

  // --- a typo in a prop expression is reported ---------------------------
  {
    const { output } = compile('<state title="\'Ada\'" />\n<Probe data-props-user="tytle" a="{{ title }}" />');
    assert.ok(
      /AVX_W03/.test(output) && /tytle/.test(output),
      `a typo in a prop expression must be reported, as it is in an ` +
        `interpolation.\n${output}`,
    );
    console.log('  ✅ a typo in a prop expression is reported');
  }

  // --- special characters survive ----------------------------------------
  {
    const { output } = compile(
      '<state gt="\'a > b\'" url="\'https://e.com/?a=1&b=2#f\'" n="5" />\n' +
        '<Probe data-props-a="gt" data-props-b="url" data-props-c="n > 3 ? \'big\' : \'small\'" />',
    );
    assert.ok(!/AVX_W/.test(output), `special characters must compile cleanly:\n${output}`);
    console.log('  ✅ values with > < URLs and a ternary compile cleanly');
  }

  console.log('✅ data-props-* contract tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
