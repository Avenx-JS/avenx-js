/**
 * The module reader is the foundation the whole bundler stands on: an import it
 * misses becomes a module that never enters the graph, and an import it
 * hallucinates becomes a build failure on a dependency nobody declared. Both
 * failures are silent at the point they happen, so these cases are deliberately
 * adversarial about the places a naive regex gets it wrong — declarations
 * inside comments, inside strings, and inside template literals.
 *
 * The corpus check at the end is the one that matters most: the reader is run
 * over every module in `lib/`, which is several hundred real import and export
 * declarations written without this parser in mind.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseModule, declaredNames, ModuleParseError } from '../../lib/bundler/parseModule.js';
import { CodeMask, regexAllowedAfter } from '../../lib/bundler/scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const libDir = path.resolve(__dirname, '../../lib');

console.log('🧪 Testing the bundler module reader...');

/**
 * Parses a source with a throwaway file name.
 * @param {string} source - Module source.
 * @returns {object} The module record.
 */
const read = (source) => parseModule(source, 'test.js');

// ---------------------------------------------------------------- scanner ---
{
  const mask = new CodeMask(`const a = "im/port x"; // import y from 'z'\nconst r = /[/]import/g;\nconst t = \`\${1} import\`;`);
  const source = mask.source;
  assert.equal(mask.isCode(source.indexOf('const a')), true, 'code is code');
  assert.equal(mask.isCode(source.indexOf('im/port')), false, 'string contents are not code');
  assert.equal(mask.isCode(source.indexOf('import y')), false, 'line comments are not code');
  assert.equal(mask.isCode(source.indexOf('[/]')), false, 'regex literals are not code');
  assert.equal(mask.isCode(source.lastIndexOf('import')), false, 'template contents are not code');

  assert.equal(regexAllowedAfter('return /x/', 7), true, 'a regex may follow `return`');
  assert.equal(regexAllowedAfter('a / b', 2), false, 'a slash after an identifier is division');
  assert.equal(regexAllowedAfter('(1) / 2', 4), false, 'a slash after `)` is division');
  console.log('  ✅ Scanner distinguishes code from literals and comments');
}

// ---------------------------------------------------------------- imports ---
{
  const record = read(`
import 'side-effect.js';
import def from './a.js';
import * as ns from './b.js';
import { x, y as z } from './c.js';
import mixed, { q } from './d.js';
import other, * as space from './e.js';
`);

  assert.deepEqual(record.dependencies, ['side-effect.js', './a.js', './b.js', './c.js', './d.js', './e.js']);
  assert.equal(record.imports[0].sideEffectOnly, true);
  assert.equal(record.imports[1].defaultLocal, 'def');
  assert.equal(record.imports[2].namespace, 'ns');
  assert.deepEqual(record.imports[3].bindings, [
    { imported: 'x', local: 'x' },
    { imported: 'y', local: 'z' },
  ]);
  assert.equal(record.imports[4].defaultLocal, 'mixed');
  assert.deepEqual(record.imports[4].bindings, [{ imported: 'q', local: 'q' }]);
  assert.equal(record.imports[5].defaultLocal, 'other');
  assert.equal(record.imports[5].namespace, 'space');
  console.log('  ✅ Every import clause shape is read');
}

{
  // A dynamic import is an expression, not a declaration, and must not become a
  // static edge in the graph.
  const record = read(`const load = () => import('./lazy.js');\nconst url = import.meta.url;`);
  assert.deepEqual(record.dependencies, [], 'dynamic import is not a static dependency');
  console.log('  ✅ Dynamic import and import.meta are not static dependencies');
}

// ---------------------------------------------------------------- exports ---
{
  const record = read(`
export const a = 1, b = 2;
export let c;
export function d() {}
export async function e() {}
export function* f() {}
export class G {}
const h = 1;
export { h, h as i };
export { j, k as l } from './m.js';
export * from './n.js';
export * as o from './p.js';
export default class Q {}
`);

  const names = record.exports.map((entry) => entry.exported);
  assert.deepEqual(names, ['a', 'b', 'c', 'd', 'e', 'f', 'G', 'h', 'i', 'default']);
  assert.deepEqual(
    record.reExports.map((entry) => `${entry.imported}->${entry.exported}@${entry.specifier}`),
    ['j->j@./m.js', 'k->l@./m.js', '*->o@./p.js'],
  );
  assert.deepEqual(record.starReExports, [{ specifier: './n.js' }]);
  assert.equal(record.exports.find((entry) => entry.exported === 'default').local, 'Q');
  console.log('  ✅ Every export declaration shape is read');
}

{
  const record = read(`export default { a: 1, b: 2 };\n`);
  const entry = record.exports[0];
  assert.equal(entry.exported, 'default');
  assert.equal(entry.kind, 'expression', 'an object literal default has no local name');
  console.log('  ✅ An expression default export is distinguished from a declaration');
}

// ------------------------------------------------------- declared bindings ---
{
  assert.deepEqual(declaredNames('const a = 1;'), ['a']);
  assert.deepEqual(declaredNames('let a, b = 2, c;'), ['a', 'b', 'c']);
  assert.deepEqual(declaredNames('const { a, b: c } = obj;'), ['a', 'c']);
  assert.deepEqual(declaredNames('const [x, , y] = arr;'), ['x', 'y']);
  assert.deepEqual(declaredNames('function foo() { const inner = 1; }'), ['foo'], 'inner scopes are not top-level bindings');
  assert.deepEqual(declaredNames('class Bar extends Baz {}'), ['Bar']);
  assert.deepEqual(declaredNames('doSomething();'), []);
  console.log('  ✅ Top-level declarations report exactly the names they bind');
}

// --------------------------------------------------------- false positives ---
{
  const record = read(`
/**
 * Documentation that mentions an import:
 *   import { logger } from 'avenx-core/runtime';
 * and a re-export: export * from 'nowhere';
 */
// import fromAComment from './comment.js';
const template = \`import fake from './template.js';\`;
const literal = "import fake from './string.js';";
import { real } from './real.js';
`);

  assert.deepEqual(record.dependencies, ['./real.js'], 'only the real declaration is a dependency');
  console.log('  ✅ Declarations inside comments, strings and templates are ignored');
}

// ------------------------------------------------------------ malformed ---
{
  assert.throws(
    () => read(`export * ;`),
    (error) => error instanceof ModuleParseError && /needs a `from` clause/.test(error.message),
    'an `export *` with no source is reported, not guessed at',
  );
  console.log('  ✅ A malformed declaration fails loudly with a location');
}

// -------------------------------------------------------------- corpus ---
{
  /**
   * Every `.js` module under a directory.
   * @param {string} dir - Directory to walk.
   * @param {string[]} out - Accumulator.
   * @returns {string[]} Absolute paths.
   */
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
  };

  const files = walk(libDir);
  assert.ok(files.length > 100, 'the corpus should be the whole library');

  let totalImports = 0;
  let totalExports = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    const record = parseModule(source, file);
    totalImports += record.imports.length;
    totalExports += record.exports.length + record.reExports.length;

    for (const specifier of record.dependencies) {
      assert.ok(
        specifier.length > 0 && !/\s/.test(specifier),
        `${path.relative(libDir, file)} produced an implausible specifier ${JSON.stringify(specifier)}`,
      );
    }
  }

  assert.ok(totalImports > 200, `expected a substantial corpus of imports, saw ${totalImports}`);
  assert.ok(totalExports > 200, `expected a substantial corpus of exports, saw ${totalExports}`);
  console.log(`  ✅ Read every module in lib/ (${files.length} files, ${totalImports} imports, ${totalExports} exports)`);
}

console.log('✅ All bundler module reader tests passed!');
