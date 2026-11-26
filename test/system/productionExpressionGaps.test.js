/**
 * @file productionExpressionGaps.test.js
 * @description A production build refuses expressions it cannot execute.
 *
 * A production bundle links no expression interpreter. An expression the code
 * generator could not compile therefore throws AVX_R32 the first time it is
 * evaluated, yet the build only warned (AVX_W48, "will be interpreted at
 * runtime") and reported success. template-expressions.md promises the
 * opposite: "an unsupported expression is a build failure with a file, a line
 * and a reason — never a blank value discovered in production."
 *
 * A development build keeps the warning, so a template being edited keeps
 * rendering the parts that do compile.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(rootDir, 'bin', 'avenx.js');

/**
 * Creates a project whose one component carries two expressions that do not
 * compile and that no earlier build-time check rejects: an action body that is
 * not valid JavaScript, and a `<@defer>` with an incomplete condition
 * expression. (Interpolations and computed values with
 * unsupported syntax already fail every build with AVX_R32.)
 * @returns {string} The project root.
 */
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-expr-gap-'));
  const files = {
    'avenx.config.json': '{}',
    'src/components/list/list.component.js': [
      '<state count="0" />',
      '<action name="save">',
      '  if (count > ) { return; }',
      '</action>',
      '<div>',
      '  <button @click="save()">save</button>',
      '  <@defer when="count +"><p>{{ count }}</p></@defer>',
      '</div>',
      '',
    ].join('\n'),
    'src/main.app.js':
      "import { AvenxApp } from 'avenx-core/runtime';\nimport List from './components/list/list.component.js';\n\nconst app = new AvenxApp({ target: '#app' });\napp.register('List', List);\napp.mount('List');\n",
  };
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/**
 * Runs `avenx build` as a child process.
 * @param {string} cwd - The project root.
 * @param {string[]} [args] - Extra arguments.
 * @returns {{status: number, output: string}} The exit status and combined output.
 */
function build(cwd, args = []) {
  const result = spawnSync(process.execPath, [BIN, 'build', ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

/**
 * Runs `avenx check` as a child process.
 * @param {string} cwd - The project root.
 * @param {string[]} [args] - Extra arguments.
 * @returns {{status: number, stdout: string, output: string}} The exit status, stdout, and combined output.
 */
function check(cwd, args = []) {
  const result = spawnSync(process.execPath, [BIN, 'check', ...args], { cwd, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/**
 * Creates a temp project with arbitrary file entries.
 * @param {Object<string, string>} files - Relative path to contents.
 * @returns {string} The project root.
 */
function makeCustomProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-expr-gap-'));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

const roots = [];
try {
  console.log('🧪 Production build refuses an expression it cannot execute');
  const production = makeProject();
  roots.push(production);
  const refused = build(production);
  assert.notStrictEqual(refused.status, 0, `the build must fail:\n${refused.output}`);
  assert.match(refused.output, /AVX_C27/, refused.output);
  assert.match(refused.output, /2 expression\(s\) cannot be compiled/, refused.output);
  assert.match(refused.output, /if \(count > \) \{ return; \}/, 'the message names the action body');
  assert.match(refused.output, /count \+/, 'the message names the defer condition');
  assert.match(refused.output, /<List>/, 'the message names the component');
  assert.match(refused.output, /list\.component\.js:3 /, 'the message names the file and line of the action body');
  assert.match(refused.output, /list\.component\.js:7 /, 'the message names the file and line of the trigger');
  assert.ok(!fs.existsSync(path.join(production, 'dist', 'bundle.js')), 'nothing is written');

  console.log('🧪 Development build warns and succeeds');
  const development = makeProject();
  roots.push(development);
  const warned = build(development, ['--dev']);
  assert.strictEqual(warned.status, 0, `the development build must succeed:\n${warned.output}`);
  assert.match(warned.output, /AVX_W48/, warned.output);
  assert.match(warned.output, /list\.component\.js:7 /);
  assert.doesNotMatch(warned.output, /will be interpreted at runtime/, 'the warning must not promise interpretation');
  assert.ok(fs.existsSync(path.join(development, 'dist', 'bundle.js')));

  console.log('🧪 avenx check and check --json emit AVX_W48 for uncompilable expressions including <Component :is>');
  const checkedProject = makeCustomProject({
    'avenx.config.json': '{}',
    'src/components/card-a/card-a.component.js': '<div>A</div>\n',
    'src/pages/home.page.js': [
      '<state count="0" view="\'CardA\'" />',
      '<div>',
      '  <@defer when="count +"><p>{{ count }}</p></@defer>',
      '  <Component :is="{{ view + }}" />',
      '</div>',
      '',
    ].join('\n'),
    'src/main.app.js':
      "import { AvenxApp } from 'avenx-core/runtime';\nconst app = new AvenxApp({ target: '#app' });\napp.initRouter({ '/': 'Home' });\n",
  });
  roots.push(checkedProject);

  const plainCheck = check(checkedProject);
  assert.notStrictEqual(plainCheck.status, 0, `avenx check must fail on AVX_W48:\n${plainCheck.output}`);
  assert.match(plainCheck.output, /AVX_W48/, plainCheck.output);
  assert.match(plainCheck.output, /count \+/, plainCheck.output);
  assert.match(plainCheck.output, /view \+/, plainCheck.output);

  const jsonCheck = check(checkedProject, ['--json']);
  assert.notStrictEqual(jsonCheck.status, 0, 'avenx check --json must exit non-zero on AVX_W48');
  const report = JSON.parse(jsonCheck.stdout);
  assert.strictEqual(report.valid, false);
  const w48 = report.diagnostics.find((d) => d.code === 'AVX_W48');
  assert.ok(w48, `expected AVX_W48 in diagnostics: ${jsonCheck.stdout}`);
  assert.strictEqual(w48.severity, 'warning');
  assert.ok(w48.file && w48.file.includes('home.page.js'), `expected file metadata, got ${w48.file}`);
  assert.strictEqual(typeof w48.line, 'number', 'expected line metadata');

  const prodRefusedDynamic = build(checkedProject);
  assert.notStrictEqual(prodRefusedDynamic.status, 0, 'production build must refuse uncompilable <Component :is>');
  assert.match(prodRefusedDynamic.output, /AVX_C27/, prodRefusedDynamic.output);

  const devWarnedDynamic = build(checkedProject, ['--dev']);
  assert.strictEqual(devWarnedDynamic.status, 0, 'dev build must warn and succeed on <Component :is> gap');
  assert.match(devWarnedDynamic.output, /AVX_W48/, devWarnedDynamic.output);

  fs.writeFileSync(path.join(checkedProject, 'avenx.config.json'), JSON.stringify({ warnings: { AVX_W48: 'off' } }));
  const silencedCheck = check(checkedProject, ['--json']);
  assert.strictEqual(silencedCheck.status, 0, `warnings.AVX_W48: "off" must silence check:\n${silencedCheck.output}`);
  const silencedReport = JSON.parse(silencedCheck.stdout);
  assert.strictEqual(
    silencedReport.diagnostics.some((d) => d.code === 'AVX_W48'),
    false,
  );

  console.log('🧪 Valid <Component :is> and quoted ternary :is build cleanly in production');
  const validDynamicProject = makeCustomProject({
    'avenx.config.json': '{}',
    'src/components/card-a/card-a.component.js': '<div>A {{ props.label }}</div>\n',
    'src/components/card-b/card-b.component.js': '<div>B {{ props.label }}</div>\n',
    'src/pages/home.page.js': [
      '<state currentView="\'CardA\'" flag="true" />',
      '<div>',
      '  <Component :is="{{ currentView }}" />',
      '  <Component :is=\'{{ flag ? "CardA" : "CardB" }}\' :label=\'flag ? "One" : "Two"\' />',
      '</div>',
      '',
    ].join('\n'),
    'src/main.app.js':
      "import { AvenxApp } from 'avenx-core/runtime';\nimport CardA from './components/card-a/card-a.component.js';\nimport CardB from './components/card-b/card-b.component.js';\nconst app = new AvenxApp({ target: '#app' });\napp.register('CardA', CardA);\napp.register('CardB', CardB);\napp.initRouter({ '/': 'Home' });\n",
  });
  roots.push(validDynamicProject);

  const validProd = build(validDynamicProject);
  assert.strictEqual(validProd.status, 0, `valid <Component :is> must build in production:\n${validProd.output}`);
  assert.doesNotMatch(validProd.output, /AVX_W48|AVX_C27/, validProd.output);
  const validBundle = fs.readFileSync(path.join(validDynamicProject, 'dist', 'bundle.js'), 'utf8');
  const exprTable = (validBundle.match(/Home\.__axExprs\s*=\s*\{[\s\S]*?\n?\};/) || [''])[0];
  assert.ok(exprTable, 'Home.__axExprs must be emitted in production bundle');
  assert.ok(exprTable.includes(JSON.stringify('flag ? "CardA" : "CardB"')), 'decoded ternary :is must be in __axExprs');
  assert.ok(exprTable.includes(JSON.stringify('flag ? "One" : "Two"')), 'decoded ternary prop must be in __axExprs');
  assert.ok(!exprTable.includes('&quot;CardA&quot;'), 'raw HTML entity must not be used as __axExprs key');

  console.log('  ✅ Production expression gap tests passed!');
} catch (error) {
  console.error('❌ Production expression gap tests failed:', error);
  process.exitCode = 1;
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
