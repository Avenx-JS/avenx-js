/**
 * @file packageIntegrity.test.js
 * @description What `npm publish` would ship must be able to run.
 *
 * The published package and the repository had drifted badly: npm carried
 * 0.4.3 from June while the repository moved on by thousands of commits, and
 * nothing checked that a tarball built from the current tree even contains the
 * files the CLI and runtime import at run time. These assertions run against
 * `npm pack --dry-run`, so they describe the actual artefact.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

/**
 * Lists the files `npm publish` would include.
 * @param {string} [cwd] - Package directory.
 * @returns {string[]} Package-relative paths.
 */
function packedFiles(cwd = rootDir) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd,
    encoding: 'utf8',
    shell: true,
  });
  assert.strictEqual(result.status, 0, `npm pack failed:\n${result.stderr}`);
  // A plugin's `prepare` build runs during the pack and prints to stdout ahead
  // of the report, so read from the report's opening bracket.
  const start = result.stdout.search(/^\[/m);
  const report = JSON.parse(result.stdout.slice(Math.max(start, 0)));

  const pkgData = Array.isArray(report) ? report[0] : Object.values(report)[0];
  return pkgData.files.map((entry) => entry.path);
}

/**
 * The official plugins `npm-publish.yml` publishes, by directory.
 * Kept in step with `scripts/sync-plugin-versions.js`, which is asserted below.
 */
const PLUGINS = {
  'plugins/avenx-i18n': '@avenx/i18n',
  'plugins/avenx-persistence': '@avenx/persistence',
  'plugins/avenx-charts': '@avenx/charts',
  'plugins/avenx-vite': '@avenx/vite',
};

/**
 * Collects every string target of an `exports`/`main`/`types` value, with the
 * export subpath it belongs to and the condition it sits under.
 * @param {unknown} value - An exports value.
 * @param {string} subpath - The subpath being walked.
 * @param {Array<{subpath: string, condition: string, target: string}>} out - Accumulator.
 * @param {string} [condition] - The enclosing condition.
 * @returns {Array<{subpath: string, condition: string, target: string}>} `out`.
 */
function exportTargets(value, subpath, out, condition = 'default') {
  if (typeof value === 'string') {
    out.push({ subpath, condition, target: value.replace(/^\.\//, '') });
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key.startsWith('.')) exportTargets(inner, key, out);
      else exportTargets(inner, subpath, out, key);
    }
  }
  return out;
}

/**
 * The module specifiers a JavaScript source imports or re-exports statically,
 * plus literal dynamic imports. Comments are dropped first, so a JSDoc
 * `import('…')` type does not count.
 * @param {string} source - Module source.
 * @returns {string[]} Specifiers.
 */
function importSpecifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/**
 * Asserts that every module reachable from a plugin's entry points resolves
 * inside the tarball or to a declared dependency.
 *
 * This is the check that would have caught the plugins importing
 * `../../../lib/...`: the path resolved in a checkout, so every test passed,
 * and pointed outside `node_modules` in an installed package.
 * @param {string} dir - Plugin directory.
 * @param {object} manifest - Its package.json.
 * @param {Set<string>} files - Package-relative paths in the tarball.
 * @param {string[]} entries - Package-relative entry modules.
 */
function assertImportGraph(dir, manifest, files, entries) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.peerDependencies || {}),
  ]);
  const coreSubpaths = new Set(Object.keys(pkg.exports).map((key) => key.replace(/^\.\/?/, '')));
  const seen = new Set();
  const queue = entries.filter((entry) => entry.endsWith('.js'));

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(path.join(rootDir, dir, file), 'utf8');

    for (const specifier of importSpecifiers(source)) {
      const where = `${manifest.name}: ${file} imports '${specifier}'`;
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        assert.ok(!target.startsWith('..'), `${where}, which is outside the package`);
        assert.ok(files.has(target), `${where}, which is not in the tarball`);
        if (target.endsWith('.js')) queue.push(target);
      } else if (specifier.startsWith('node:') || builtinModules.includes(specifier)) {
        continue;
      } else {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        assert.ok(declared.has(name), `${where}, but ${name} is not a dependency or peer dependency`);
        if (name === 'avenx-core') {
          const subpath = specifier.slice(name.length + 1);
          assert.ok(coreSubpaths.has(subpath), `${where}, which avenx-core does not export`);
        }
      }
    }
  }
}

/**
 * Checks each official plugin the way the root package is checked above,
 * against its own `npm pack --dry-run` -- which runs its `prepare` build, as
 * `npm publish` does.
 */
function checkPlugins() {
  console.log('🧪 Every official plugin ships what it declares and runs once installed');

  const syncSource = fs.readFileSync(path.join(rootDir, 'scripts/sync-plugin-versions.js'), 'utf8');
  for (const dir of Object.keys(PLUGINS)) {
    assert.ok(syncSource.includes(`'${dir}'`), `scripts/sync-plugin-versions.js must keep ${dir} in step`);
  }

  for (const [dir, name] of Object.entries(PLUGINS)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, dir, 'package.json'), 'utf8'));
    assert.strictEqual(manifest.name, name, `${dir} publishes as ${name}`);

    // Lockstep versioning; see scripts/sync-plugin-versions.js.
    assert.strictEqual(manifest.version, pkg.version, `${name} carries the core version (run node scripts/sync-plugin-versions.js)`);
    assert.strictEqual(
      manifest.peerDependencies?.['avenx-core'],
      `^${pkg.version}`,
      `${name} requires the core it was built against`,
    );
    assert.strictEqual(manifest.publishConfig?.access, 'public', `${name} is scoped, so a first publish needs public access`);

    const files = new Set(packedFiles(path.join(rootDir, dir)));
    assert.ok(files.has('package.json') && files.has('README.md'), `${name} ships its manifest and README`);

    const targets = exportTargets(manifest.exports, '.', []);
    if (manifest.main) targets.push({ subpath: '.', condition: 'main', target: manifest.main.replace(/^\.\//, '') });
    for (const { target } of targets) {
      assert.ok(files.has(target), `${name} points at ${target}, which is not in the tarball`);
    }

    // A TypeScript consumer gets declarations for every subpath, not some.
    for (const subpath of Object.keys(manifest.exports)) {
      assert.ok(
        targets.some((entry) => entry.subpath === subpath && entry.condition === 'types'),
        `${name} export '${subpath}' has no types condition`,
      );
    }

    if ((manifest.files || []).some((entry) => entry.replace(/\/$/, '') === 'dist')) {
      assert.ok(
        [...files].some((file) => file.startsWith('dist/') && file.endsWith('.js')),
        `${name} lists dist/ in files, so the tarball must contain its built bundles`,
      );
    }

    for (const excluded of ['test/', 'example/', 'node_modules/', 'scripts/']) {
      const leaked = [...files].filter((file) => file.startsWith(excluded));
      assert.deepStrictEqual(leaked, [], `${name}: ${excluded} must not ship: ${leaked.slice(0, 5).join(', ')}`);
    }

    const entries = targets.filter((entry) => entry.condition !== 'types').map((entry) => entry.target);
    assertImportGraph(dir, manifest, files, entries);
  }
}

try {
  console.log('🧪 The package ships everything its entry points import');

  const files = packedFiles();
  const has = (file) => files.includes(file);

  // Every entry point declared in package.json must actually be in the tarball.
  const entryPoints = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      entryPoints.add(value.replace(/^\.\//, ''));
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  collect(pkg.exports);
  collect(pkg.main);
  collect(pkg.bin);

  for (const entry of entryPoints) {
    // Wildcard subpaths (./tooling/*) cannot be checked as a literal file.
    if (entry.includes('*')) continue;
    assert.ok(has(entry), `package.json points at ${entry}, which is not in the tarball`);
  }

  console.log('🧪 The runtime, compiler, CLI and templates are all present');
  for (const required of [
    'lib/compiler.js',
    'lib/core/index.js',
    'lib/core/index.d.ts',
    'bin/avenx.js',
    'README.md',
    'LICENSE',
  ]) {
    assert.ok(has(required), `${required} must ship`);
  }

  // The scaffolder copies these; a package without them produces a broken project.
  assert.ok(
    files.some((file) => file.startsWith('templates/')),
    'the project templates must ship',
  );
  // The compiler reaches its own submodules at run time.
  assert.ok(files.some((file) => file.startsWith('lib/compiler/')), 'compiler modules must ship');
  assert.ok(files.some((file) => file.startsWith('lib/core/')), 'runtime modules must ship');
  assert.ok(files.some((file) => file.startsWith('lib/bundler/')), 'bundler modules must ship');

  console.log('🧪 Development-only material is not shipped');
  for (const excluded of ['test/', 'docs/', 'benches/', 'plugins/', 'dev-docs/', 'coverage/']) {
    const leaked = files.filter((file) => file.startsWith(excluded));
    assert.deepStrictEqual(leaked, [], `${excluded} must not ship: ${leaked.slice(0, 5).join(', ')}`);
  }

  console.log('🧪 The scaffolded project depends on this version');
  // `avenx init` writes the dependency from package.json, so a release cannot
  // scaffold a project pinned to a version that was never published.
  const initSource = fs.readFileSync(path.join(rootDir, 'bin/commands/init.js'), 'utf8');
  assert.match(
    initSource,
    /'avenx-core':\s*`\^\$\{packageJson\.version\}`/,
    'init must derive the dependency from the package version rather than hardcoding one',
  );
  assert.match(pkg.version, /^\d+\.\d+\.\d+/, 'the package version is a release version');

  checkPlugins();

  console.log('  ✅ Package integrity tests passed!');
} catch (error) {
  console.error('❌ Package integrity tests failed:', error);
  process.exitCode = 1;
}
