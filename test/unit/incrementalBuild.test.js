/**
 * An incremental rebuild must produce exactly what a cold build of the same
 * sources produces.
 *
 * This is the test the compilation cache is shipped behind. Reusing a previous
 * compilation is a bet that the cache key covers everything a unit was derived
 * from, and the failure mode when it does not is the worst kind: a bundle that
 * is subtly not the code on disk, for whichever files happened to hit. Speed is
 * easy to measure and easy to be wrong about safely; this is neither.
 *
 * So the assertion is byte equality over the whole output directory -- bundle,
 * stylesheet, source maps, trace sidecar and Atlas alike -- after a sequence of
 * edits that includes every shape of change a watch session sees: modifying a
 * component, modifying only a stylesheet, changing a bridge's surface, adding a
 * component, renaming one, and deleting one.
 *
 * Both halves run against the same project directory, so nothing differs
 * between them except whether the cache was allowed: an absolute path embedded
 * in a source map is then the same path on both sides, and a byte difference
 * means a real difference.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import AvenxCompiler from '../../lib/compiler.js';
import {
  clearIncrementalCache,
  incrementalCacheStats,
  createEnvironmentFingerprint,
  createUnitKey,
} from '../../lib/compiler/incrementalCache.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('🧪 Testing incremental rebuilds against cold builds...');

// `fileURLToPath` rather than `import.meta.dirname`: the package supports
// Node 18, where the latter does not exist.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/atlas-app');
const roots = [];

/**
 * Copies the Atlas fixture app into a fresh temporary directory.
 * @returns {string} The project root.
 */
function createProject() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-incremental-')));
  roots.push(root);
  fs.cpSync(FIXTURE, root, { recursive: true });

  // The fixture is extended with a built-in component tag, because referencing
  // one is how a build decides to link `VirtualList` at all. That decision is
  // made from a set the parser fills while compiling, so a cache that failed to
  // replay it would drop the built-in from the bundle -- and nothing else in
  // this project would notice.
  const list = path.join(root, 'src/components/cart-list/cart-list.component.js');
  fs.writeFileSync(
    list,
    fs.readFileSync(list, 'utf-8').replace('  <CartItem />', '  <VirtualList items="cart.items" item-height="20" />\n  <CartItem />'),
  );

  return root;
}

/**
 * Builds the project, with or without the compilation cache.
 * @param {string} root - The project root.
 * @param {boolean} watch - True to allow the cache, as a watch cycle does.
 * @param {object} [overrides] - Extra compiler options, merged last.
 * @returns {void}
 */
function build(root, watch, overrides = {}) {
  new AvenxCompiler({
    rootDir: root,
    srcDir: 'src',
    distDir: 'dist',
    incremental: true,
    watch,
    logging: { silent: true },
    ...overrides,
  }).build();
}

/**
 * Blanks the wall-clock stamps two builds are supposed to disagree about.
 *
 * The Atlas sidecar and the trace sidecar each record when they were generated.
 * `atlas/emit.js` names `generatedAt` as the only field that differs between two
 * builds of unchanged sources, which is exactly the claim this test would
 * otherwise fail on, for a reason that has nothing to do with the cache.
 * Everything else stays byte-for-byte.
 * @param {string} contents - A file's contents.
 * @returns {string} The contents with any generation stamp blanked.
 */
function normalise(contents) {
  return contents.replace(/("generatedAt":\s*)"[^"]*"/g, '$1"<stamp>"');
}

/**
 * Reads every emitted file, so nothing the build writes escapes comparison.
 * @param {string} root - The project root.
 * @returns {Map<string, string>} Contents by path relative to `dist/`.
 */
function snapshot(root) {
  const dist = path.join(root, 'dist');
  const files = new Map();

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.set(path.relative(dist, full), normalise(fs.readFileSync(full, 'utf-8')));
      }
    }
  };

  walk(dist);
  return files;
}

/**
 * Asserts two snapshots are byte-identical, naming the first file that differs.
 * @param {Map<string, string>} incremental - The incrementally built output.
 * @param {Map<string, string>} cold - The cold-built output.
 * @param {string} label - What produced them, for the failure message.
 * @returns {void}
 */
function assertIdentical(incremental, cold, label) {
  assert.deepStrictEqual(
    [...incremental.keys()].sort(),
    [...cold.keys()].sort(),
    `${label}: the two builds emitted different files`,
  );

  for (const [file, coldContents] of cold) {
    const builtContents = incremental.get(file);
    if (builtContents === coldContents) continue;

    // Name the first differing line rather than printing two bundles.
    const builtLines = builtContents.split('\n');
    const coldLines = coldContents.split('\n');
    let line = 0;
    while (line < coldLines.length && builtLines[line] === coldLines[line]) line += 1;

    assert.fail(
      `${label}: ${file} differs from a cold build at line ${line + 1}\n` +
        `  incremental: ${JSON.stringify((builtLines[line] || '').slice(0, 200))}\n` +
        `  cold:        ${JSON.stringify((coldLines[line] || '').slice(0, 200))}`,
    );
  }
}

/**
 * The edit sequence a watch session has to survive.
 *
 * Each entry mutates the project and is followed by a rebuild, so the cache is
 * carried across all of them rather than exercised once.
 * @type {Array<{what: string, apply: (root: string) => void}>}
 */
const EDITS = [
  {
    what: 'modify a component template',
    apply: (root) => {
      const file = path.join(root, 'src/components/cart-item/cart-item.component.js');
      fs.writeFileSync(
        file,
        fs.readFileSync(file, 'utf-8').replace('<span @css label>{{ label }}</span>', '<span @css label>{{ label }}!</span>'),
      );
    },
  },
  {
    what: 'modify only a stylesheet',
    apply: (root) => {
      const file = path.join(root, 'src/components/cart-item/cart-item.component.css');
      fs.appendFileSync(file, '\n');
      const contents = fs.readFileSync(file, 'utf-8');
      fs.writeFileSync(file, contents.replace(/<\/ ?@css>/i, (close) => `  row { outline: 1px solid red; }\n${close}`));
    },
  },
  {
    what: "change a bridge's declared surface",
    apply: (root) => {
      const file = path.join(root, 'src/bridges/cart.bridge.js');
      fs.writeFileSync(file, `${fs.readFileSync(file, 'utf-8')}\n// surface touched\n`);
    },
  },
  {
    what: 'add a component',
    apply: (root) => {
      const dir = path.join(root, 'src/components/cart-note');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'cart-note.component.js'), '<div @css note>A note</div>\n');
      fs.writeFileSync(path.join(dir, 'cart-note.component.css'), '<@css>\nnote {\n  color: grey;\n}\n</@css>\n');
    },
  },
  {
    what: 'rename a component',
    apply: (root) => {
      const from = path.join(root, 'src/components/cart-note');
      const to = path.join(root, 'src/components/cart-hint');
      fs.renameSync(from, to);
      fs.renameSync(path.join(to, 'cart-note.component.js'), path.join(to, 'cart-hint.component.js'));
      fs.renameSync(path.join(to, 'cart-note.component.css'), path.join(to, 'cart-hint.component.css'));
    },
  },
  {
    what: 'delete a component',
    apply: (root) => {
      fs.rmSync(path.join(root, 'src/components/cart-hint'), { recursive: true, force: true });
    },
  },
];

/**
 * Empties both compilation caches, so a build that follows is genuinely cold.
 * @returns {void}
 */
function clearCaches() {
  clearIncrementalCache();
  clearAtlasCache();
}

// --- 1. The sequence, incrementally, then the same sources cold ---------------

console.log('  Testing byte equality after modify/add/rename/delete...');
{
  const root = createProject();
  clearCaches();

  build(root, true);
  for (const edit of EDITS) {
    edit.apply(root);
    build(root, true);
  }

  const incremental = snapshot(root);
  const afterSequence = incrementalCacheStats();

  // The cache has to have been doing something, or every assertion below holds
  // trivially. The sequence rebuilds seven times over four units and changes
  // the environment fingerprint only on add, rename and delete, so hits are
  // expected in the dozens rather than merely above zero.
  assert.ok(
    afterSequence.hits > 5,
    `expected the cache to be hit across the sequence, got ${afterSequence.hits} hits / ${afterSequence.misses} misses`,
  );

  clearCaches();
  build(root, false);
  const cold = snapshot(root);

  assert.strictEqual(
    incrementalCacheStats().hits + incrementalCacheStats().misses,
    0,
    'a cold build must not consult the compilation cache at all',
  );

  assertIdentical(incremental, cold, 'after the full edit sequence');
}

// --- 2. Every intermediate state, not just the last one -----------------------

// A sequence that ends correctly can still have been wrong in the middle, and a
// watch session is judged on every rebuild rather than on its last one. So each
// step is compared against a cold build of exactly that state.
console.log('  Testing byte equality at every step of the sequence...');
{
  const root = createProject();
  clearCaches();
  build(root, true);

  for (const edit of EDITS) {
    edit.apply(root);

    build(root, true);
    const incremental = snapshot(root);

    clearCaches();
    build(root, false);
    const cold = snapshot(root);
    assertIdentical(incremental, cold, `after "${edit.what}"`);

    // Re-seed the cache from this state so the next step starts from a warm
    // cache, which is the situation a watch session is actually in.
    clearCaches();
    build(root, true);
  }
}

// --- 3. A cache hit must reuse the unit, and a miss must be forced -----------

console.log('  Testing that an edit invalidates only what it has to...');
{
  const root = createProject();
  clearCaches();
  build(root, true);

  const seeded = incrementalCacheStats();
  assert.strictEqual(seeded.hits, 0, 'the first build of a session cannot hit');
  assert.ok(seeded.misses > 0, 'the first build of a session must populate the cache');
  const unitCount = seeded.misses;

  // Nothing changed: every unit must come from the cache.
  clearAtlasCache();
  build(root, true);
  let stats = incrementalCacheStats();
  assert.strictEqual(stats.misses, unitCount, 'an unchanged rebuild must not miss');
  assert.strictEqual(stats.hits, unitCount, 'an unchanged rebuild must hit for every unit');

  // One component changed: exactly one unit must be recompiled.
  EDITS[0].apply(root);
  build(root, true);
  stats = incrementalCacheStats();
  assert.strictEqual(
    stats.misses,
    unitCount + 1,
    `a one-file edit must miss exactly once, saw ${stats.misses - unitCount} misses`,
  );
  assert.strictEqual(stats.hits, unitCount * 2 - 1, 'the untouched units must still hit');
}

// --- 4. Config and compiler identity are part of the key ---------------------

console.log('  Testing that config and compiler changes invalidate the cache...');
{
  const root = createProject();
  clearCaches();
  build(root, true);
  const before = incrementalCacheStats().misses;

  // A changed avenx.config.json must not be answered from the cache, even
  // though no source file was touched.
  fs.writeFileSync(
    path.join(root, 'avenx.config.json'),
    JSON.stringify({ srcDir: 'src', distDir: 'dist', outputName: 'app' }),
  );
  build(root, true);

  const after = incrementalCacheStats();
  assert.strictEqual(after.hits, 0, 'a changed configuration must invalidate every unit');
  assert.strictEqual(after.misses, before * 2, 'a changed configuration must recompile every unit');
}

// --- 5. Warnings survive a cache hit -----------------------------------------

// A warning is part of what compiling a unit produces, and it is the one part
// that never reaches `dist/`, so the comparison above cannot see it. It matters
// twice over: a warning that vanishes on the second save is misleading, and
// `check --watch` exits non-zero on a warning, so a pass that reports fewer than
// a cold one would disagree with itself.
console.log('  Testing that warnings are reported on a cache hit...');
{
  const root = createProject();

  // Three findings, reported through three different routes: a template tag
  // that resolves to no component in the project (AVX_W46), an interpolation
  // that is never closed (AVX_W54), and an action body the expression generator
  // cannot compile (AVX_W48). The last one matters most here: it is reported
  // after every unit has been parsed, from a list the parser filled while
  // parsing, so it is the one finding a cache could lose without the build
  // noticing. It only warns in a development build -- a production build
  // refuses it -- so this case runs in development mode.
  fs.writeFileSync(
    path.join(root, 'src/components/cart-item/cart-item.component.js'),
    [
      '<state count="0" />',
      '<action name="save">',
      '  if (count > ) { return; }',
      '</action>',
      '<div @css row>',
      '  <MissingThing />',
      '  <span @css label>{{ unclosed</span>',
      '  <button @css btn @click="save()">save</button>',
      '</div>',
      '',
    ].join('\n'),
  );

  /**
   * Builds once and returns every warning the build reported.
   * @param {boolean} watch - True to allow the cache.
   * @returns {string[]} The warnings, in order.
   */
  const warningsFrom = (watch) => {
    const seen = [];
    const previous = logger.config.transports;
    logger.configure({
      transports: [
        (level, formatted) => {
          if (level === 'warn') seen.push(Array.isArray(formatted) ? formatted.join(' ') : String(formatted));
        },
      ],
    });
    try {
      // Not silent: `shouldLog` gates on the level before any transport runs.
      build(root, watch, { logging: { level: 'warn' }, mode: 'development' });
    } finally {
      logger.configure({ transports: previous });
    }
    return seen;
  };

  clearCaches();
  const cold = warningsFrom(false);
  for (const code of ['AVX_W46', 'AVX_W48']) {
    assert.ok(
      cold.some((message) => message.includes(code)),
      `expected the cold build to report ${code}, saw: ${JSON.stringify(cold)}`,
    );
  }

  clearCaches();
  // First pass populates the cache, second pass must be served from it.
  warningsFrom(true);
  const seededHits = incrementalCacheStats().hits;
  const warm = warningsFrom(true);
  assert.ok(
    incrementalCacheStats().hits > seededHits,
    'the second warm build must have been served from the cache',
  );

  assert.deepStrictEqual(warm, cold, 'a cached unit must report the same warnings as a compiled one');
}

// --- 6. The key's own obligations, without a build ---------------------------

console.log('  Testing the unit key covers each of its inputs...');
{
  const base = {
    filePath: '/project/src/components/a/a.component.js',
    kind: 'component',
    source: '<div>a</div>',
    styleSource: 'a { color: red; }',
    sessionFingerprint: 'session-1',
    environmentFingerprint: 'env-1',
  };
  const key = createUnitKey(base);

  assert.strictEqual(createUnitKey({ ...base }), key, 'the same inputs must produce the same key');

  for (const field of Object.keys(base)) {
    const changed = createUnitKey({ ...base, [field]: `${base[field]}-changed` });
    assert.notStrictEqual(changed, key, `changing ${field} must change the key`);
  }

  // A unit with no stylesheet is not a unit with an empty one: adding an empty
  // `.component.css` changes what the style pipeline sees.
  assert.notStrictEqual(
    createUnitKey({ ...base, styleSource: null }),
    createUnitKey({ ...base, styleSource: '' }),
    'a missing stylesheet must key differently from an empty one',
  );

  // The environment fingerprint has to move when the project around a unit
  // moves, or a rename would be answered from the cache.
  const env = { componentNames: new Set(['A', 'B']), production: false, customVoidTags: [] };
  assert.strictEqual(
    createEnvironmentFingerprint(env),
    createEnvironmentFingerprint({ ...env, componentNames: new Set(['B', 'A']) }),
    'the fingerprint must not depend on the order names arrive in',
  );
  assert.notStrictEqual(
    createEnvironmentFingerprint(env),
    createEnvironmentFingerprint({ ...env, componentNames: new Set(['A', 'B', 'C']) }),
    'adding a component must change the fingerprint',
  );
  assert.notStrictEqual(
    createEnvironmentFingerprint(env),
    createEnvironmentFingerprint({ ...env, production: true }),
    'the build mode must change the fingerprint',
  );
}

for (const root of roots) {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('✅ Incremental rebuild tests passed successfully!');
