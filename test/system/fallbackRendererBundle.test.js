/**
 * A build that says a template fell back must ship a fallback that works.
 *
 * AVX_W47 tells a developer their component renders through the string
 * renderer and that "everything still works". The bundle has to earn that
 * sentence, and two properties are what earn it:
 *
 *   1. the fallback registry module is present exactly once, and
 *   2. something in the bundle actually fills it.
 *
 * Both mattered. The registry lives in module scope, so a build that emits it
 * twice -- which is what a symlinked package used to produce -- has two
 * registries: the install writes one, `AvenxComponent` reads the other, and a
 * component with an IR-refused template throws where nothing was watching.
 *
 * These tests drive the real CLI against real projects, because module
 * identity is a property of resolution and bundling and cannot be observed
 * from inside the test process.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing fallback renderer bundling...');

/**
 * Runs the Avenx CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function avenx(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * Creates a project whose single component uses a construct the IR refuses.
 * @param {string} construct - The template body to place in the component.
 * @returns {string} The project root.
 */
function scaffoldFallbackProject(construct) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-fallback-')));
  avenx(['init'], dir);

  const componentDir = path.join(dir, 'src', 'components', 'probe');
  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    path.join(componentDir, 'probe.component.js'),
    `<state label="'probe'" />\n\n${construct}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';
import Probe from './components/probe/probe.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Probe', Probe);
app.mount('Probe');
`,
  );
  return dir;
}

/**
 * Creates a project that reaches avenx-core through a symlink.
 *
 * This is what `npm link`, a `file:` dependency, a pnpm store and a workspace
 * all produce, and it is the arrangement every contributor to this repository
 * works in. The package is reachable by two paths -- through the link and
 * through its real location -- and a resolver that keeps the path it walked
 * turns one file into two modules.
 * @param {string} construct - The template body to place in the component.
 * @returns {string} The project root.
 */
function scaffoldLinkedProject(construct) {
  const dir = scaffoldFallbackProject(construct);
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  const link = path.join(modules, 'avenx-core');
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(repoRoot, link, 'dir');
  return dir;
}

/** Constructs the IR refuses, each of which forces the fallback path. */
const REFUSED = {
  suspense: `<div>
  <p data-testid="outside">outside {{ label }}</p>
  <@suspense>
    <@fallback><em>pending</em></@fallback>
    <span data-testid="inside">inside {{ label }}</span>
  </@suspense>
</div>`,
  errorBoundary: `<div>
  <p data-testid="outside">outside {{ label }}</p>
  <@errorBoundary>
    <@fallback as="err"><b>caught {{ err.message }}</b></@fallback>
    <span data-testid="inside">inside {{ label }}</span>
  </@errorBoundary>
</div>`,
  deadlock: `<div>
  <p data-testid="outside">outside {{ label }}</p>
  <@deadlock name="probe-boundary">
    <span data-testid="inside">inside {{ label }}</span>
    <@fallback as="err"><i>{{ err.message }}</i></@fallback>
  </@deadlock>
</div>`,
};

const projects = [];

try {
  for (const [name, construct] of Object.entries(REFUSED)) {
    for (const mode of ['production', 'development']) {
      const dir = scaffoldFallbackProject(construct);
      projects.push(dir);

      const args = mode === 'development' ? ['build', '--dev'] : ['build'];
      const result = avenx(args, dir);
      const output = `${result.stdout}${result.stderr}`;

      assert.strictEqual(result.status, 0, `${name} (${mode}) should build:\n${output}`);
      assert.ok(
        output.includes('AVX_W47'),
        `${name} (${mode}) should report the fallback through AVX_W47:\n${output}`,
      );

      const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');

      // One module, one registry. Counting the declaration is the cheapest
      // observation that distinguishes a single module from a duplicated one.
      const registries = bundle.match(/let installed = null/g) || [];
      assert.strictEqual(
        registries.length,
        1,
        `${name} (${mode}) should contain exactly one string-renderer registry, found ${registries.length}. ` +
          'More than one means the same module was emitted under two ids, and the install and the read land on different copies.',
      );

      // ...and something has to fill it.
      assert.ok(
        /installStringRenderer\(\s*\{/.test(bundle),
        `${name} (${mode}) should install the string renderer it says it needs`,
      );
    }
  }
  console.log('  ✅ every refused construct ships exactly one installed string renderer');

  // The same contract, reached through a symlinked install. The bundle must
  // still hold one registry: a linked checkout is not a different application.
  for (const [name, construct] of Object.entries(REFUSED)) {
    const dir = scaffoldLinkedProject(construct);
    projects.push(dir);

    const result = avenx(['build'], dir);
    const output = `${result.stdout}${result.stderr}`;
    assert.strictEqual(result.status, 0, `${name} (linked) should build:\n${output}`);

    const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');
    const registries = bundle.match(/let installed = null/g) || [];
    assert.strictEqual(
      registries.length,
      1,
      `${name} (linked) should contain exactly one string-renderer registry, found ${registries.length}. ` +
        'A symlinked package must resolve to the same module ids as the real path, or every module holding ' +
        'state is duplicated and the install and the read land on different copies.',
    );
  }
  console.log('  ✅ a symlinked install produces the same single registry');

  // A symlink chain, which is what a pnpm store produces: the application links
  // to a store entry that itself links to the package. Canonicalisation has to
  // follow the whole chain, not one hop.
  const chainRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-chain-')));
  projects.push(chainRoot);
  const store = path.join(chainRoot, 'store');
  fs.mkdirSync(store, { recursive: true });
  fs.symlinkSync(repoRoot, path.join(store, 'avenx-core'), 'dir');

  const chained = scaffoldFallbackProject(REFUSED.suspense);
  projects.push(chained);
  fs.mkdirSync(path.join(chained, 'node_modules'), { recursive: true });
  fs.rmSync(path.join(chained, 'node_modules', 'avenx-core'), { recursive: true, force: true });
  fs.symlinkSync(path.join(store, 'avenx-core'), path.join(chained, 'node_modules', 'avenx-core'), 'dir');

  const chainBuild = avenx(['build'], chained);
  assert.strictEqual(
    chainBuild.status,
    0,
    `a symlink chain should build:\n${chainBuild.stdout}${chainBuild.stderr}`,
  );
  const chainBundle = fs.readFileSync(path.join(chained, 'dist', 'bundle.js'), 'utf-8');
  assert.strictEqual(
    (chainBundle.match(/let installed = null/g) || []).length,
    1,
    'a link to a link must resolve to the same module ids as the real path',
  );
  console.log('  ✅ a symlink chain resolves to the same single registry');

  // The other half of the contract: a build where nothing fell back must not
  // carry the renderer at all. A fix for the above must not be "include it
  // always".
  const clean = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-nofallback-')));
  projects.push(clean);
  avenx(['init'], clean);
  const compiled = path.join(clean, 'src', 'components', 'plain');
  fs.mkdirSync(compiled, { recursive: true });
  fs.writeFileSync(
    path.join(compiled, 'plain.component.js'),
    `<state label="'plain'" />\n\n<div><p>{{ label }}</p><@if (label)><span>yes</span></@if></div>\n`,
  );
  fs.writeFileSync(
    path.join(clean, 'src', 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';
import Plain from './components/plain/plain.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Plain', Plain);
app.mount('Plain');
`,
  );

  const cleanBuild = avenx(['build'], clean);
  assert.strictEqual(cleanBuild.status, 0, `clean project should build:\n${cleanBuild.stdout}${cleanBuild.stderr}`);
  assert.ok(
    !`${cleanBuild.stdout}${cleanBuild.stderr}`.includes('AVX_W47'),
    'a project whose every template compiles should not report a fallback',
  );

  const cleanBundle = fs.readFileSync(path.join(clean, 'dist', 'bundle.js'), 'utf-8');
  assert.ok(
    !cleanBundle.includes('class TemplateRenderer'),
    'a fully compiled application must not carry the string renderer',
  );
  assert.ok(
    !cleanBundle.includes('class DomPatcher'),
    'a fully compiled application must not carry the DOM patcher',
  );
  console.log('  ✅ a fully compiled application still leaves the string renderer out');


  // What needing the fallback renderer costs, asserted rather than assumed.
  //
  // The ceiling is a regression guard on two different things. Too high and a
  // fix that pulls unrelated modules into every fallback build goes unnoticed;
  // too low and it fires on the renderer's honest weight. The number below sits
  // just above what the fallback build measures today.
  //
  // It also guards against the wrong fix. "Link the string renderer always"
  // would make every assertion above pass, and would show up here as the
  // compiled-only build gaining the same 50 KB -- which the clean-build check
  // further down would then catch as well.
  //
  // Raised from 95 to 100 KB as base runtime grew with route-level code splitting (#132),
  // AVX_R37 (#1617), nested component mounting under app.mount() (#1641), and DeferManager
  // unmount teardown (#1642), taking the fallback bundle from ~92 KB to 97.1 KB gzipped.
  //
  // Raised from 100 to 105 KB: render diagnostics with component name and
  // template position (#1178) had taken the fallback bundle to 100.2 KB, over
  // the ceiling already, and typed `data-ax-bind` write-back (#1724) adds the
  // per-option value sync for a multiple select, measured at 100.5 KB. 105
  // restores headroom inside the kilobytes an unrelated module costs.
  const FALLBACK_GZIP_CEILING_KB = 105;
  const FALLBACK_OVERHEAD_CEILING_KB = 70;

  const cleanBundleBytes = Buffer.byteLength(cleanBundle);
  const cleanGzipKb = zlib.gzipSync(cleanBundle).length / 1024;

  const fallbackProject = scaffoldFallbackProject(REFUSED.suspense);
  projects.push(fallbackProject);
  const sized = avenx(['build'], fallbackProject);
  assert.strictEqual(sized.status, 0, `sizing build should succeed:\n${sized.stdout}${sized.stderr}`);
  const fallbackBundle = fs.readFileSync(path.join(fallbackProject, 'dist', 'bundle.js'), 'utf-8');
  const fallbackGzipKb = zlib.gzipSync(fallbackBundle).length / 1024;
  const overheadKb = (Buffer.byteLength(fallbackBundle) - cleanBundleBytes) / 1024;

  assert.ok(
    fallbackGzipKb < FALLBACK_GZIP_CEILING_KB,
    `a fallback build should stay under ${FALLBACK_GZIP_CEILING_KB} KB gzipped, measured ${fallbackGzipKb.toFixed(2)} KB`,
  );
  assert.ok(
    overheadKb > 0 && overheadKb < FALLBACK_OVERHEAD_CEILING_KB,
    `needing the string renderer should cost between 0 and ${FALLBACK_OVERHEAD_CEILING_KB} KB raw, measured ${overheadKb.toFixed(2)} KB. ` +
      'Zero or less would mean the compiled-only build is carrying it too.',
  );
  console.log(
    `  ✅ fallback build costs ${overheadKb.toFixed(2)} KB raw over compiled-only ` +
      `(${cleanGzipKb.toFixed(2)} -> ${fallbackGzipKb.toFixed(2)} KB gzipped)`,
  );

  console.log('✅ All fallback renderer bundling tests passed!');
} finally {
  for (const dir of projects) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
