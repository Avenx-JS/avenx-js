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

  console.log('  ✅ Production expression gap tests passed!');
} catch (error) {
  console.error('❌ Production expression gap tests failed:', error);
  process.exitCode = 1;
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
