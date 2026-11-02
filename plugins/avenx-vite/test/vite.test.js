/**
 * @file vite.test.js
 * @description Unit tests for the @avenx/vite plugin. The plugin object is
 * called directly, so no Vite install or dev server is needed.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AvenxCompiler from '../../../lib/compiler.js';
import { avenxPlugin } from '../src/index.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-vite-test-'));
let dirCounter = 0;

const COMPONENT = `<state count="0" />

<div>
  <@css card />
  <p @css label>Count: {{ count }}</p>
  <button @click="count++">Add</button>
</div>
`;

const COMPONENT_CSS = `<@css>
  card { padding: 1rem; }
  label { color: red; }
</@css>
`;

const PAGE = `<state title="Home" />

<div>
  <h1>{{ title }}</h1>
</div>
`;

/**
 * Writes fixture files into a fresh directory. The plugin compiles from disk,
 * so every fixture has to exist as a real file.
 * @param {Record<string, string>} files - File name to contents.
 * @returns {string} The directory the files were written to.
 */
function writeFixture(files) {
  dirCounter += 1;
  const dir = path.join(workDir, String(dirCounter));
  fs.mkdirSync(dir);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

/**
 * Reads the render program the compiler embedded in a module.
 * @param {string} code - Compiled module source.
 * @returns {object|null} The parsed `__axProgram`, or null when absent.
 */
function readProgram(code) {
  const match = code.match(/\.__axProgram = (\{.*\});\n/);
  return match ? JSON.parse(match[1]) : null;
}

/**
 * A component compiles to a module carrying the render program tables.
 * @returns {Promise<void>}
 */
async function testComponentTransform() {
  console.log('  1. Testing component transform...');
  const dir = writeFixture({
    'Counter.component.js': COMPONENT,
    'Counter.component.css': COMPONENT_CSS,
  });
  const id = path.join(dir, 'Counter.component.js');

  const result = avenxPlugin().transform(COMPONENT, id);

  assert.ok(result, 'a .component.js file should be transformed');
  assert.match(result.code, /\.__axProgram = \{/, 'output carries __axProgram');
  assert.match(result.code, /\.__axProgramExprs = /, 'output carries __axProgramExprs');
  assert.match(result.code, /export default Counter;/, 'output default-exports the component class');
  assert.match(result.code, /AvenxComponent/, 'output imports AvenxComponent');
  assert.ok(result.map, 'a source map is returned');
  console.log('  ✅ Component transform passed!');
}

/**
 * A page goes through wrapPage and imports AvenxPage instead.
 * @returns {Promise<void>}
 */
async function testPageTransform() {
  console.log('  2. Testing page transform...');
  const dir = writeFixture({ 'Home.page.js': PAGE });
  const id = path.join(dir, 'Home.page.js');

  const result = avenxPlugin().transform(PAGE, id);

  assert.ok(result, 'a .page.js file should be transformed');
  assert.match(result.code, /AvenxPage/, 'pages import AvenxPage');
  assert.doesNotMatch(result.code, /AvenxComponent/, 'pages do not import AvenxComponent');
  assert.match(result.code, /export default Home;/, 'output default-exports the page class');
  assert.match(result.code, /\.__axProgram = \{/, 'output carries __axProgram');
  console.log('  ✅ Page transform passed!');
}

/**
 * A co-located stylesheet is imported, and loads as scoped CSS.
 * @returns {Promise<void>}
 */
async function testCssExtraction() {
  console.log('  3. Testing CSS extraction...');
  const dir = writeFixture({
    'Counter.component.js': COMPONENT,
    'Counter.component.css': COMPONENT_CSS,
  });
  const id = path.join(dir, 'Counter.component.js');
  const cssId = path.join(dir, 'Counter.component.css');
  const plugin = avenxPlugin();

  const { code } = plugin.transform(COMPONENT, id);
  assert.ok(
    code.includes(`import ${JSON.stringify(cssId)};`),
    'the co-located stylesheet becomes a side-effect import',
  );
  assert.doesNotMatch(code, /<@css>/, 'no @css block is left in the module');

  const css = plugin.load(cssId);
  assert.equal(typeof css, 'string', 'the stylesheet loads as CSS');
  assert.doesNotMatch(css, /<\/?@css>/, 'block markers are stripped');
  assert.doesNotMatch(css, /(^|\s)card\s*\{/m, 'block names are rewritten into scoped classes');
  assert.match(css, /padding: 1rem/, 'declarations are kept');
  console.log('  ✅ CSS extraction passed!');
}

/**
 * Files the plugin does not own are not transformed or loaded.
 * @returns {Promise<void>}
 */
async function testPassThrough() {
  console.log('  4. Testing pass-through for files the plugin does not own...');
  const plugin = avenxPlugin();

  for (const id of ['/src/main.js', '/src/style.css', '/index.html', '/src/util.ts']) {
    assert.equal(plugin.transform('export const x = 1;\n', id), null, `${id} is left alone`);
  }
  assert.equal(plugin.load('/src/main.js'), null, 'plain modules are not loaded by the plugin');
  console.log('  ✅ Pass-through passed!');
}

/**
 * A template error keeps the file and position for the dev server overlay.
 * @returns {Promise<void>}
 */
async function testCompileErrorNamesTheFile() {
  console.log('  5. Testing compile errors...');
  const source = '<state count="0" />\n\n<div>\n  <p>{{ count + }}</p>\n</div>\n';
  const dir = writeFixture({ 'Broken.component.js': source });
  const id = path.join(dir, 'Broken.component.js');

  assert.throws(
    () => avenxPlugin().transform(source, id),
    (err) => err instanceof Error &&
      err.code === 'AVX_R32' &&
      err.filename.endsWith('Broken.component.js') &&
      err.line === 4 &&
      typeof err.column === 'number' &&
      err.message.includes('{{ count + }}'),
    'a template error carries the file, line, column and a code frame',
  );
  console.log('  ✅ Compile errors passed!');
}

/**
 * The plugin and lib/compiler.js emit the same program for one fixture.
 * @returns {Promise<void>}
 */
async function testParityWithCliCompiler() {
  console.log('  6. Testing parity with lib/compiler.js...');
  const dir = writeFixture({
    'Counter.component.js': COMPONENT,
    'Counter.component.css': COMPONENT_CSS,
  });
  const id = path.join(dir, 'Counter.component.js');

  const viaPlugin = readProgram(avenxPlugin().transform(COMPONENT, id).code);
  const viaCli = readProgram(new AvenxCompiler({ rootDir: dir }).compileComponent(id));

  assert.ok(viaPlugin, 'the plugin output has a program');
  assert.deepStrictEqual(viaPlugin, viaCli, 'the plugin and the CLI compiler emit the same program');
  console.log('  ✅ Parity with lib/compiler.js passed!');
}

/**
 * Runs every case in order and cleans up the fixture directory.
 * @returns {Promise<void>}
 */
async function runTests() {
  console.log('Running @avenx/vite plugin tests...');
  try {
    await testComponentTransform();
    await testPageTransform();
    await testCssExtraction();
    await testPassThrough();
    await testCompileErrorNamesTheFile();
    await testParityWithCliCompiler();
    console.log('All @avenx/vite tests passed!');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
