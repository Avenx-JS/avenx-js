/**
 * The emitter is the only part of the bundler whose output is executed, so
 * these tests execute it. A bundle that parses is not evidence; a bundle that
 * produces the right values is.
 *
 * Three cases carry most of the weight, because each is a way a naive
 * concatenating emitter silently produces a working-looking bundle with wrong
 * semantics:
 *
 * - a live binding read across a module boundary (`export let activeWatcher` in
 *   the real runtime, read by AvenxComponent to decide whether it is inside its
 *   own render) — a copy at import time would capture the initial value forever;
 * - a cyclic import, where only function declarations are legal;
 * - CommonJS interop, where `default` means the whole `module.exports`.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { Resolver } from '../../lib/bundler/resolve.js';
import { buildGraph } from '../../lib/bundler/graph.js';
import { emitBundle, EmitError, mutableExports } from '../../lib/bundler/emit.js';

console.log('🧪 Testing the bundler emitter...');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-emit-'));

/**
 * Writes a fixture module.
 * @param {string} relative - Path relative to the fixture root.
 * @param {string} contents - Module source.
 * @returns {string} Absolute path.
 */
function write(relative, contents) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

/**
 * Bundles an entry and returns the emitted code.
 * @param {string} entry - Absolute entry path.
 * @param {object} [options] - Extra emit options.
 * @returns {{code: string, map: object|null, graph: object}} The bundle.
 */
function emit(entry, options = {}) {
  const resolver = new Resolver();
  const { graph, order } = buildGraph({ entries: [entry], resolver });
  const result = emitBundle({ graph, order, rootDir: root, ...options });
  return { ...result, graph };
}

/**
 * Runs an emitted bundle and returns what it put on the sandbox.
 * @param {string} code - The bundle source.
 * @returns {object} The sandbox after evaluation.
 */
function run(code) {
  const sandbox = { result: null, console, Object, Array, JSON, Error };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'bundle.js' });
  return sandbox;
}

try {
  // ------------------------------------------------------------- the basics ---
  {
    const entry = write('basic/entry.js', [
      "import greet, { NAME, upper as loud } from './lib.js';",
      'globalThis.result = greet(loud(NAME));',
    ].join('\n'));
    write('basic/lib.js', [
      "export const NAME = 'avenx';",
      'export function upper(value) { return value.toUpperCase(); }',
      'export default function greet(who) { return `hello ${who}`; }',
    ].join('\n'));

    const { code } = emit(entry);
    assert.equal(run(code).result, 'hello AVENX', 'named, aliased and default imports all bind correctly');
    console.log('  ✅ Named, aliased and default imports evaluate to the right values');
  }

  // ---------------------------------------------------------- live bindings ---
  {
    const entry = write('live/entry.js', [
      "import { current, activate } from './state.js';",
      'const before = current;',
      'activate(42);',
      'globalThis.result = { before, after: current };',
    ].join('\n'));
    write('live/state.js', [
      'export let current = 0;',
      'export function activate(value) { current = value; }',
    ].join('\n'));

    const { code, graph } = emit(entry);
    assert.deepEqual([...mutableExports(graph.modules.get(path.join(root, 'live/state.js')))], ['current']);
    assert.ok(/^var current;$/m.test(code), 'the mutable export is hoisted to bundle scope');

    const { result } = run(code);
    assert.equal(result.before, 0);
    assert.equal(result.after, 42, 'the importer sees the reassignment, not a copy of the initial value');
    console.log('  ✅ A mutable export stays live across the module boundary');
  }

  {
    // The alias case cannot be made live without rewriting references, so it is
    // refused rather than silently frozen.
    const entry = write('live2/entry.js', "import { current as now } from './state.js';\nglobalThis.result = now;");
    write('live2/state.js', 'export let current = 0;\nexport function set(v) { current = v; }');
    assert.throws(() => emit(entry), EmitError, 'aliasing a live binding is reported, not silently frozen');
    console.log('  ✅ Aliasing a live binding is refused rather than silently frozen');
  }

  // ---------------------------------------------------------------- cycles ---
  {
    const entry = write('cyc/a.js', [
      "import { fromB } from './b.js';",
      'export function fromA() { return 1; }',
      'globalThis.result = fromB();',
    ].join('\n'));
    write('cyc/b.js', [
      "import { fromA } from './a.js';",
      'export function fromB() { return fromA() + 1; }',
    ].join('\n'));

    const { code } = emit(entry);
    assert.equal(run(code).result, 2, 'a function imported across a cycle resolves when called');
    console.log('  ✅ A function imported across a cycle works, as it does in real ES modules');
  }

  {
    const entry = write('cyc2/a.js', "import { VALUE } from './b.js';\nexport const OTHER = 1;\nglobalThis.result = VALUE;");
    write('cyc2/b.js', "import { OTHER } from './a.js';\nexport const VALUE = OTHER;");
    assert.throws(
      () => emit(entry),
      (error) => error instanceof EmitError && /temporal dead zone/.test(error.message),
      'a const imported across a cycle is a TDZ in a browser too, and is reported as one',
    );
    console.log('  ✅ A non-function imported across a cycle is refused, as the language refuses it');
  }

  // -------------------------------------------------------------- CommonJS ---
  {
    const entry = write('cjs/entry.js', [
      "import legacy, { helper } from './legacy.cjs';",
      'globalThis.result = { whole: legacy.value, named: helper() };',
    ].join('\n'));
    write('cjs/legacy.cjs', [
      "const dep = require('./dep.cjs');",
      'module.exports = { value: dep + 1, helper: function () { return dep; } };',
    ].join('\n'));
    write('cjs/dep.cjs', 'module.exports = 41;');

    const { code } = emit(entry);
    const { result } = run(code);
    assert.equal(result.whole, 42, 'the default import is the whole module.exports');
    assert.equal(result.named, 41, 'named imports read properties of module.exports');
    console.log('  ✅ CommonJS interop: default is module.exports, named imports are its properties');
  }

  // ------------------------------------------------------------ re-exports ---
  {
    const entry = write('barrel/entry.js', [
      "import { alpha, beta, renamed } from './barrel.js';",
      'globalThis.result = [alpha, beta(), renamed];',
    ].join('\n'));
    write('barrel/barrel.js', [
      "export * from './one.js';",
      "export { gamma as renamed } from './two.js';",
    ].join('\n'));
    write('barrel/one.js', "export const alpha = 'a';\nexport function beta() { return 'b'; }");
    write('barrel/two.js', "export const gamma = 'c';");

    const { code } = emit(entry);
    assert.deepEqual(run(code).result, ['a', 'b', 'c'], 'star and renamed re-exports both resolve');
    console.log('  ✅ `export *` and renamed re-exports resolve through a barrel');
  }

  // ------------------------------------------------------------ entry access ---
  {
    const entry = write('expose/entry.js', "export const value = 7;");
    const { code } = emit(entry, { footer: 'globalThis.result = __avx_entry.value;' });
    assert.equal(run(code).result, 7, 'a footer can read the entry exports through __avx_entry');
    console.log('  ✅ A footer can publish the entry namespace');
  }

  // ------------------------------------------------------------ source maps ---
  {
    const entry = write('map/entry.js', [
      "import { marker } from './dep.js';",
      '',
      'globalThis.result = marker;',
    ].join('\n'));
    write('map/dep.js', ['// line 1', '// line 2', "export const marker = 'found';"].join('\n'));

    const { code, map } = emit(entry, { sourceMap: true, file: 'bundle.js' });
    assert.equal(map.version, 3);
    assert.ok(map.sources.some((source) => source.endsWith('map/dep.js')), 'sources name the real modules');
    assert.equal(map.sources.length, map.sourcesContent.length, 'every source carries its content');

    // The import declaration is rewritten to one line and padded, so a module's
    // body keeps a 1:1 line correspondence with its source.
    const outputLines = code.split('\n');
    const markerLine = outputLines.findIndex((line) => line.includes("marker = 'found'"));
    const bodyStart = outputLines.findIndex((line) => line.includes('// line 1'));
    assert.equal(markerLine - bodyStart, 2, 'the module body keeps its own line offsets');

    const mappingLines = map.mappings.split(';');
    assert.ok(mappingLines[markerLine], 'the line that matters has a mapping');
    console.log('  ✅ Source maps name real files and keep module line offsets intact');
  }

  // ------------------------------------------------------- the real runtime ---
  {
    const resolver = new Resolver();
    const runtimeEntry = resolver.resolve('avenx-core/runtime', path.join(root, 'app.js'));
    const { graph, order } = buildGraph({ entries: [runtimeEntry], resolver });
    const { code, modules } = emitBundle({ graph, order, rootDir: path.dirname(runtimeEntry) });

    assert.ok(modules > 50, `the whole runtime is emitted, saw ${modules} modules`);
    assert.doesNotThrow(() => new vm.Script(code, { filename: 'runtime.js' }), 'the emitted runtime parses');
    assert.ok(code.includes('var activeWatcher;'), "the runtime's own live binding is hoisted");
    console.log(`  ✅ The real runtime emits and parses (${modules} modules)`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('✅ All bundler emitter tests passed!');
