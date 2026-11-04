/**
 * `import.meta` cannot exist in a classic script, so a module that uses it has
 * to fail the build with AVX_C33, naming the file, rather than reach the bundle
 * and be reported as AVX_C15, a compiler defect the user is asked to file.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing the import.meta diagnostic...');

const projects = [];

/**
 * Runs the Avenx CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @param {object} [env] - Extra environment variables.
 * @returns {{status: number, output: string}} Exit status and combined output.
 */
function avenx(args, cwd, env = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

/**
 * Scaffolds a project, appends to its entry and writes the given files.
 * @param {string} main - Source appended to src/main.app.js.
 * @param {Record<string, string>} [files] - Files keyed by path relative to the root.
 * @returns {string} The project root.
 */
function project(main, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-import-meta-'));
  projects.push(root);
  avenx(['init'], root);
  fs.appendFileSync(path.join(root, 'src/main.app.js'), `\n${main}\n`);

  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/**
 * Asserts that a project fails to build with AVX_C33.
 * @param {string} root - Project root.
 * @param {string[]} mentions - Text the diagnostic must contain.
 * @returns {string} The build output.
 */
function assertRefused(root, mentions) {
  const { status, output } = avenx(['build'], root);
  assert.notStrictEqual(status, 0, `the build fails:\n${output}`);
  assert.ok(output.includes('AVX_C33'), `reported as AVX_C33:\n${output}`);
  assert.ok(!output.includes('AVX_C15'), `not reported as a compiler defect:\n${output}`);
  for (const text of mentions) {
    assert.ok(output.includes(text), `the diagnostic mentions ${text}:\n${output}`);
  }
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'bundle.js')), 'nothing is written');
  return output;
}

/**
 * Asserts that a project builds to a bundle that parses as a classic script.
 * @param {string} root - Project root.
 * @param {object} [env] - Extra environment variables.
 * @returns {{bundle: string, output: string}} The bundle and the build output.
 */
function assertBuilds(root, env) {
  const { status, output } = avenx(['build'], root, env);
  assert.strictEqual(status, 0, `the build succeeds:\n${output}`);
  const bundle = fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf-8');
  assert.doesNotThrow(() => new vm.Script(bundle), 'the bundle parses');
  return { bundle, output };
}

try {
  {
    const output = assertRefused(project('console.log(import.meta.url);'), [
      'src/main.app.js',
      'import.meta',
      'console.log(import.meta.url);',
    ]);
    assert.ok(!/main\.app\.js:\d/.test(output), `a generated module has no reliable line:\n${output}`);
    console.log('  ✅ import.meta.url in the entry is AVX_C33, naming the file');
  }

  {
    assertRefused(project('console.log(import.meta.env.AVX_PUBLIC_API_URL);'), [
      'src/main.app.js',
      'import.meta',
      'process.env.AVX_PUBLIC_*',
      'the entry, components, pages, bridges and guards, but not in other imported modules',
    ]);
    console.log('  ✅ import.meta.env points the reader at process.env.AVX_PUBLIC_*');
  }

  {
    const root = project("import { where } from './utils/where.js';\nconsole.log(where);", {
      'src/utils/where.js': 'export const where = `at ${import.meta.url}`;\n',
    });
    assertRefused(root, [`${path.join('src', 'utils', 'where.js')}:1`]);
    console.log('  ✅ import.meta in an imported module, inside a substitution, names that module');
  }

  {
    const root = project("import { where } from './utils/split.js';\nconsole.log(where);", {
      'src/utils/split.js': '// first\n\nexport const where = import\n  .meta.url;\n',
    });
    assertRefused(root, [`${path.join('src', 'utils', 'split.js')}:3`, 'export const where = import .meta.url;']);
    console.log('  ✅ An expression split across lines is quoted whole, at the line it starts on');
  }

  {
    const padding = 'x'.repeat(500);
    const root = project("import { read } from 'minified';\nconsole.log(read);", {
      'node_modules/minified/package.json': JSON.stringify({ name: 'minified', main: 'index.js', type: 'module' }),
      'node_modules/minified/index.js': `export const a="${padding}";export const read=import.meta.url;export const b="${padding}";\n`,
    });
    const output = assertRefused(root, ['index.js:1', 'export const read=import.meta.url;']);
    assert.ok(!output.includes(padding), `a minified line is not quoted whole:\n${output}`);
    console.log('  ✅ A long line is quoted around the occurrence, not from its start');
  }

  {
    const root = project(
      [
        "console.log('import.meta.url', \"import.meta.env\");",
        'console.log(`import.meta.url ${1 + 1}`);',
        'console.log(/import.meta/.test("x"));',
        '// import.meta.url',
        '/* import.meta.env.AVX_PUBLIC_API_URL */',
        'const config = { import: { meta: 1 } };',
        'console.log(config.import.meta);',
      ].join('\n'),
    );
    assertBuilds(root);
    console.log('  ✅ import.meta in strings, templates, regexes and comments is left alone');
  }

  {
    const root = project("import { read } from '@acme/meta-user';\nconsole.log(read);", {
      'node_modules/@acme/meta-user/package.json': JSON.stringify({ name: '@acme/meta-user', main: 'index.js', type: 'module' }),
      'node_modules/@acme/meta-user/index.js': 'export const read = import.meta.url;\n',
    });
    const output = assertRefused(root, ['"@acme/meta-user"']);
    assert.ok(!output.includes('AVX_PUBLIC'), `a dependency is not told to use env variables:\n${output}`);
    console.log('  ✅ import.meta in a dependency names the package instead of suggesting a fix');
  }

  {
    const root = project("import { safe } from 'dual-env';\nconsole.log(safe);", {
      'node_modules/dual-env/package.json': JSON.stringify({ name: 'dual-env', main: 'index.js', type: 'module', sideEffects: false }),
      'node_modules/dual-env/index.js': "export { safe } from './safe.js';\nexport { nodeOnly } from './node.js';\n",
      'node_modules/dual-env/safe.js': "export const safe = 'browser';\n",
      'node_modules/dual-env/node.js': 'export const nodeOnly = import.meta.url;\n',
    });
    assertBuilds(root);
    console.log('  ✅ A module tree shaking drops cannot fail the build');
  }

  {
    const root = project('console.log(process.env.AVX_PUBLIC_API_URL, process.env.AVX_PUBLIC_MISSING);');
    const { bundle, output } = assertBuilds(root, { AVX_PUBLIC_API_URL: 'https://api.example.test' });
    assert.ok(bundle.includes('"https://api.example.test"'), 'a set variable is inlined');
    assert.ok(output.includes('AVX_W60') && output.includes('AVX_PUBLIC_MISSING'), `an unset one warns:\n${output}`);
    console.log('  ✅ process.env.AVX_PUBLIC_* still inlines and still warns with AVX_W60');
  }

  {
    const { status, output } = avenx(['explain', 'AVX_C33'], repoRoot);
    assert.strictEqual(status, 0, output);
    assert.ok(output.includes('import.meta') && output.includes('not in other imported modules'), output);
    console.log('  ✅ avenx explain AVX_C33 describes it');
  }
} finally {
  for (const root of projects) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
