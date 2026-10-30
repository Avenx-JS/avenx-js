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
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

/**
 * Lists the files `npm publish` would include.
 * @returns {string[]} Package-relative paths.
 */
function packedFiles() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: true,
  });
  assert.strictEqual(result.status, 0, `npm pack failed:\n${result.stderr}`);
  const report = JSON.parse(result.stdout);

  const pkgData = Array.isArray(report) ? report[0] : Object.values(report)[0];
  return pkgData.files.map((entry) => entry.path);
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

  console.log('  ✅ Package integrity tests passed!');
} catch (error) {
  console.error('❌ Package integrity tests failed:', error);
  process.exitCode = 1;
}
