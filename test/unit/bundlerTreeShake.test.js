/**
 * Tree shaking was not a missing feature of the old build; it was an
 * unaskable question. The runtime arrived as one pre-bundled blob, so "does
 * this application use the trace recorder?" had nowhere to be asked. These
 * tests are about the two halves of the answer now being right:
 *
 * - what is genuinely unreachable is dropped, including the trace recorder from
 *   a production application that never records;
 * - what is reachable is kept, including a module whose exports nobody wants
 *   but whose top-level code has to run. Dropping that one would be a silent
 *   behaviour change, which is the failure mode that makes shaking dangerous.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { Resolver } from '../../lib/bundler/resolve.js';
import { buildGraph } from '../../lib/bundler/graph.js';
import { shake, hasTopLevelEffects } from '../../lib/bundler/treeshake.js';
import { emitBundle } from '../../lib/bundler/emit.js';
import { minify } from '../../lib/bundler/minify.js';
import { bundle } from '../../lib/bundler/index.js';

console.log('🧪 Testing bundler tree shaking...');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-shake-'));

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
 * Shakes a fixture graph and reports which modules survived, by basename.
 * @param {string} entry - Absolute entry path.
 * @returns {{kept: string[], graph: object, order: string[], included: Set<string>}} The result.
 */
function shakeFixture(entry) {
  const resolver = new Resolver();
  const { graph, order } = buildGraph({ entries: [entry], resolver });
  const included = shake({ graph, order });
  return { kept: [...included].map((id) => path.basename(id)).sort(), graph, order, included };
}

try {
  // --------------------------------------------------------- barrel elision ---
  {
    const entry = write('barrel/entry.js', "import { wanted } from './barrel.js';\nglobalThis.result = wanted;");
    write('barrel/barrel.js', [
      "export { wanted } from './wanted.js';",
      "export { unwanted } from './unwanted.js';",
      "export * from './stars.js';",
    ].join('\n'));
    write('barrel/wanted.js', "export const wanted = 'yes';");
    write('barrel/unwanted.js', "export const unwanted = 'no';");
    write('barrel/stars.js', "export const starred = 'also no';");

    const { kept, graph, order, included } = shakeFixture(entry);
    assert.deepEqual(kept, ['barrel.js', 'entry.js', 'wanted.js'], 'only the route that was asked for is followed');
    assert.ok(!kept.includes('unwanted.js'));
    assert.ok(!kept.includes('stars.js'));

    const { code } = emitBundle({ graph, order, included, rootDir: root });
    const sandbox = { result: null, Object };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'bundle.js' });
    assert.equal(sandbox.result, 'yes', 'and the shaken bundle still produces the right value');
    console.log('  ✅ A barrel is followed only for the names something asked for');
  }

  // ------------------------------------------- plain imports always execute ---
  {
    const entry = write('effects/entry.js', "import './register.js';\nimport { used } from './lib.js';\nglobalThis.result = used;");
    write('effects/register.js', 'globalThis.registered = true;');
    write('effects/lib.js', 'export const used = 1;\nexport const unused = 2;');

    const { kept } = shakeFixture(entry);
    assert.ok(kept.includes('register.js'), 'a side-effect-only import is never dropped');
    console.log('  ✅ A plain import always executes its target, as the language requires');
  }

  {
    // The runtime relies on this: reactive/proxyHandler.js calls
    // setPathResolver() at its top level and that call has to happen.
    const entry = write('keep/entry.js', "import { thing } from './barrel.js';\nglobalThis.result = thing;");
    write('keep/barrel.js', "export { thing } from './thing.js';\nexport { other } from './effectful.js';");
    write('keep/thing.js', 'export const thing = 1;');
    write('keep/effectful.js', 'export const other = 2;\nglobalThis.sideEffectRan = true;');

    const { kept, graph } = shakeFixture(entry);
    assert.ok(hasTopLevelEffects(graph.modules.get(path.join(root, 'keep/effectful.js'))), 'the effect is recognised');
    assert.ok(kept.includes('effectful.js'), 'a re-export target with top-level effects is kept anyway');
    console.log('  ✅ A re-export target that runs code at its top level is kept');
  }

  {
    const entry = write('pure/entry.js', "import { thing } from './node_modules/pure/barrel.js';\nglobalThis.result = thing;");
    write('pure/node_modules/pure/package.json', JSON.stringify({ name: 'pure', sideEffects: false }));
    write('pure/node_modules/pure/barrel.js', "export { thing } from './thing.js';\nexport { other } from './effectful.js';");
    write('pure/node_modules/pure/thing.js', 'export const thing = 1;');
    write('pure/node_modules/pure/effectful.js', 'export const other = 2;\nglobalThis.ran = true;');

    const { kept } = shakeFixture(entry);
    assert.ok(!kept.includes('effectful.js'), 'a package declaring sideEffects:false is taken at its word');
    console.log('  ✅ A package declaring `sideEffects: false` is taken at its word');
  }

  {
    // `entryNeeds` is the counterpart to the emitter publishing `__avx_entry`:
    // a footer that reads the entry's namespace needs those exports kept, and
    // nothing else in the graph asks for them. Without it a footer would
    // compile against exports that had been shaken away.
    const entry = write('needs/entry.js', "export { wanted } from './lib.js';\nexport { spare } from './lib.js';");
    write('needs/lib.js', 'export const wanted = 1;\nexport const spare = 2;\nexport const never = 3;');

    const resolver = new Resolver();
    const { graph, order } = buildGraph({ entries: [entry], resolver });

    const bare = shake({ graph, order });
    assert.ok(!bare.has(path.join(root, 'needs/lib.js')), 'nothing asks for the entry exports, so the route is not followed');

    const asked = shake({ graph, order, entryNeeds: new Map([[entry, ['wanted']]]) });
    assert.ok(asked.has(path.join(root, 'needs/lib.js')), 'declaring what the consumer needs keeps the route');

    console.log('  ✅ An entry export a consumer declares it needs is kept');
  }

  // ------------------------------------------------ the runtime, measurably ---
  {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const appId = path.join(repoRoot, '__shake_probe__.js');
    const app = new Map([
      [
        appId,
        [
          "import { AvenxApp, AvenxComponent } from 'avenx-core/runtime';",
          "const app = new AvenxApp({ target: '#app' });",
          'void app; void AvenxComponent;',
        ].join('\n'),
      ],
    ]);

    const whole = bundle({ entries: [appId], virtualModules: new Map(app), rootDir: repoRoot, treeShake: false });
    const shaken = bundle({ entries: [appId], virtualModules: new Map(app), rootDir: repoRoot, treeShake: true });

    assert.ok(
      shaken.stats.modulesEmitted < whole.stats.modulesEmitted,
      `shaking must remove something: ${shaken.stats.modulesEmitted} vs ${whole.stats.modulesEmitted}`,
    );

    const dropped = [...whole.graph.modules.keys()]
      .filter((id) => !shaken.included.has(id))
      .map((id) => path.basename(id));

    // The recorder is the point: an application that never calls
    // installTraceRecorder() should not carry the machinery that records.
    for (const name of ['recorder.js', 'capture.js', 'redact.js', 'devtools.js']) {
      assert.ok(dropped.includes(name), `trace/${name} should not ship to an application that never records`);
    }
    assert.ok(shaken.stats.bytes < whole.stats.bytes, 'and the bundle is smaller for it');
    console.log(
      `  ✅ The trace recorder is shaken out of a production application ` +
        `(${whole.stats.modulesEmitted} → ${shaken.stats.modulesEmitted} modules)`,
    );
  }

  // ------------------------------------------------------------- minifying ---
  {
    const source = [
      '/**',
      ' * A documented function.',
      ' */',
      '    function documented() {',
      '      return `keep   this    spacing`;   // trailing comment',
      '    }',
      'globalThis.result = documented();',
    ].join('\n');

    const minified = minify(source);
    assert.equal(
      minified.split('\n').length,
      source.split('\n').length,
      'line count is preserved, so a source map stays valid across minification',
    );
    assert.ok(!minified.includes('A documented function'), 'comments are gone');
    assert.ok(!minified.includes('trailing comment'), 'line comments are gone');
    assert.ok(minified.includes('keep   this    spacing'), 'template literal contents are untouched');
    assert.ok(/^function documented/m.test(minified), 'indentation is gone');

    const sandbox = { result: null };
    vm.createContext(sandbox);
    vm.runInContext(minified, sandbox, { filename: 'min.js' });
    assert.equal(sandbox.result, 'keep   this    spacing', 'and the program still means the same thing');
    console.log('  ✅ Minification removes comments and margins, and preserves line count');
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('✅ All bundler tree shaking tests passed!');
