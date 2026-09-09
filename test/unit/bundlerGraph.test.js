/**
 * The graph is where the old build's central defect is actually fixed, so
 * these tests are written as statements about the invariant rather than about
 * the implementation:
 *
 *   a graph is built  =>  every import resolved, and every imported name exists
 *
 * The concatenator could report success for an application that could not
 * start. Every failing case here is one that used to build green.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Resolver, ResolveError } from '../../lib/bundler/resolve.js';
import { buildGraph, detectFormat, BindingError } from '../../lib/bundler/graph.js';
import { parseModule } from '../../lib/bundler/parseModule.js';

console.log('🧪 Testing the bundler module graph...');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-graph-'));

/**
 * Writes a fixture file.
 * @param {string} relative - Path relative to the fixture root.
 * @param {string} contents - File contents.
 * @returns {string} Absolute path.
 */
function write(relative, contents) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

/**
 * Builds a graph rooted at a fixture file.
 * @param {string} entry - Absolute entry path.
 * @param {Map<string, string>} [virtualModules] - Generated modules.
 * @returns {{graph: object, order: string[]}} The graph and emission order.
 */
function build(entry, virtualModules = new Map()) {
  return buildGraph({ entries: [entry], resolver: new Resolver({ virtualModules }) });
}

try {
  // ----------------------------------------------------------- basic graph ---
  {
    const entry = write('a/entry.js', `import { b } from './b.js';\nimport c from '../c.js';\nexport const used = b + c;`);
    write('a/b.js', 'export const b = 1;');
    write('c.js', 'export default 2;');

    const { graph, order } = build(entry);
    assert.equal(graph.modules.size, 3, 'every reachable module is in the graph');
    assert.equal(order[order.length - 1], entry, 'the entry is emitted last');
    assert.ok(order.indexOf(path.join(root, 'a/b.js')) < order.indexOf(entry), 'dependencies come first');
    console.log('  ✅ A graph contains every reachable module, dependencies first');
  }

  // ------------------------------------------------- unresolvable imports ---
  {
    const entry = write('missing/entry.js', `import { x } from './gone.js';\nexport const y = x;`);
    assert.throws(
      () => build(entry),
      (error) => error instanceof ResolveError && error.specifier === './gone.js',
      'a local import of a file that does not exist fails the build',
    );
    console.log('  ✅ A missing local module fails the build instead of vanishing');
  }

  {
    const entry = write('pkg/entry.js', `import { format } from 'not-installed';\nexport const y = format;`);
    assert.throws(
      () => build(entry),
      (error) => error instanceof ResolveError && error.specifier === 'not-installed',
      'an uninstalled package fails the build',
    );
    console.log('  ✅ An uninstalled npm package fails the build instead of vanishing');
  }

  {
    const entry = write('node/entry.js', `import fs from 'fs';\nexport const y = fs;`);
    assert.throws(
      () => build(entry),
      (error) => error instanceof ResolveError && /Node\.js builtin/.test(error.message),
      'a Node builtin cannot reach a browser bundle',
    );
    console.log('  ✅ A Node builtin cannot leak into a browser bundle');
  }

  // ------------------------------------------------------------- bindings ---
  {
    const entry = write('bind/entry.js', `import { formt } from './format.js';\nexport const y = formt;`);
    write('bind/format.js', 'export const format = 1;\nexport const other = 2;');

    let caught = null;
    try {
      build(entry);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof BindingError, 'importing a name that is not exported fails');
    assert.equal(caught.missing, 'formt');
    assert.ok(/Did you mean "format"\?/.test(caught.message), 'the near miss is suggested');
    assert.ok(/It exports: format, other/.test(caught.message), 'and what is available is listed');
    console.log('  ✅ Importing a name a module does not export fails, with a suggestion');
  }

  {
    const entry = write('bind2/entry.js', `import def from './no-default.js';\nexport const y = def;`);
    write('bind2/no-default.js', 'export const named = 1;');
    assert.throws(() => build(entry), BindingError, 'a missing default export is caught too');
    console.log('  ✅ A missing default export is caught');
  }

  // ---------------------------------------------------------- re-exports ---
  {
    const entry = write('re/entry.js', `import { deep } from './barrel.js';\nexport const y = deep;`);
    write('re/barrel.js', `export * from './leaf.js';\nexport { other as renamed } from './leaf.js';`);
    write('re/leaf.js', 'export const deep = 1;\nexport const other = 2;');

    const { graph } = build(entry);
    const barrel = graph.modules.get(path.join(root, 're/barrel.js'));
    assert.deepEqual([...barrel.exportNames].sort(), ['deep', 'other', 'renamed'], 'star and named re-exports both count');
    console.log('  ✅ Export names follow `export *` and renamed re-exports');
  }

  // -------------------------------------------------------------- cycles ---
  {
    const entry = write('cyc/a.js', `import { fromB } from './b.js';\nexport function fromA() { return 1; }\nexport const value = fromB;`);
    write('cyc/b.js', `import { fromA } from './a.js';\nexport function fromB() { return fromA(); }`);

    const { graph } = build(entry);
    assert.equal(graph.cycles.length, 1, 'the cycle is detected, not rejected');
    assert.ok(graph.isCyclicEdge(path.join(root, 'cyc/b.js'), path.join(root, 'cyc/a.js')), 'and the closing edge is marked');
    console.log('  ✅ A module cycle is detected and its closing edge marked');
  }

  // ----------------------------------------------------------- CommonJS ---
  {
    const entry = write('cjs/entry.js', `import legacy from './legacy.cjs';\nexport const y = legacy;`);
    write('cjs/legacy.cjs', `const helper = require('./helper.cjs');\nmodule.exports = { helper };`);
    write('cjs/helper.cjs', 'module.exports = 1;');

    const { graph } = build(entry);
    assert.equal(graph.modules.get(path.join(root, 'cjs/legacy.cjs')).format, 'cjs');
    assert.ok(graph.modules.has(path.join(root, 'cjs/helper.cjs')), 'a static require() is a real graph edge');
    console.log('  ✅ CommonJS modules join the graph, including their require() edges');
  }

  {
    const record = parseModule('export const a = 1;', 'x.js');
    assert.equal(detectFormat(record, 'export const a = 1;', 'x.js'), 'esm');
    assert.equal(detectFormat(parseModule('module.exports = 1;', 'x.js'), 'module.exports = 1;', 'x.js'), 'cjs');
    assert.equal(detectFormat(parseModule('const a = 1;', 'x.mjs'), 'const a = 1;', 'x.mjs'), 'esm', '.mjs is always a module');
    console.log('  ✅ Module format detection prefers ES syntax over CommonJS markers');
  }

  // ------------------------------------------------- generated app modules ---
  {
    const generatedId = path.join(root, 'gen/pages/home.page.js');
    const entry = write('gen/main.js', `import Home from './pages/home.page.js';\nexport const page = Home;`);
    write('gen/pages/home.page.js', '<state title="Home" />\n<div>{{ title }}</div>');

    const virtual = new Map([[generatedId, `import { AvenxPage } from 'avenx-core/runtime';\nexport default class Home extends AvenxPage {}`]]);
    const { graph } = build(entry, virtual);

    assert.ok(graph.modules.get(generatedId).virtual, 'the compiled page is the module in the graph');
    assert.ok(
      [...graph.modules.keys()].some((id) => id.endsWith(path.join('lib', 'core', 'index.js'))),
      'and its runtime import pulls the runtime in as ordinary modules',
    );
    console.log('  ✅ Generated component modules enter the graph and pull the runtime with them');
  }

  // ------------------------------------------------- the real runtime graph ---
  {
    const resolver = new Resolver();
    const runtime = resolver.resolve('avenx-core/runtime', path.join(root, 'app.js'));
    const { graph, order } = buildGraph({ entries: [runtime], resolver });

    assert.ok(graph.modules.size > 50, `the runtime is a real graph, saw ${graph.modules.size} modules`);
    assert.equal(order.length, graph.modules.size, 'every module is ordered');
    assert.ok(graph.modules.get(runtime).exportNames.size > 50, 'the barrel re-exports the whole public surface');

    const positions = new Map(order.map((id, index) => [id, index]));
    for (const module of graph.modules.values()) {
      for (const target of module.resolved.values()) {
        if (graph.isCyclicEdge(module.id, target)) continue;
        assert.ok(
          positions.get(target) < positions.get(module.id),
          `${target} must be emitted before ${module.id}`,
        );
      }
    }
    console.log(`  ✅ The real runtime links cleanly (${graph.modules.size} modules, ${graph.cycles.length} cycle)`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('✅ All bundler module graph tests passed!');
