/**
 * @file noRuntimeDependencies.test.js
 * @description Installing Avenx installs nothing but Avenx.
 *
 * This was nearly true for a long time: the runtime had no third-party code in
 * it, but the compiler parsed JavaScript with `acorn`, so `npm install
 * avenx-core` pulled a parser down with it and `"dependencies"` was not empty.
 * The compiler now parses with `lib/compiler/parser/js`, which the project
 * owns, and acorn is a development dependency used as the differential-testing
 * oracle in `test/unit/jsParserDifferential.test.js`.
 *
 * A property that was restored once by hand will be lost again by the next
 * convenient `npm install --save`, so it is asserted here rather than written
 * down somewhere. Four things are checked, because each can break on its own:
 *
 * 1. `package.json` declares no runtime, peer, optional or bundled dependency.
 * 2. `package-lock.json` resolves nothing that is not development-only, which
 *    is what catches a transitive dependency arriving through a direct one.
 * 3. No file that ships -- everything under the `files` entries -- imports a
 *    bare specifier that is not a Node builtin. This is the check that would
 *    fail first, because an import is what a dependency is *for*; the manifest
 *    only records it afterwards.
 * 4. acorn is still installed for development, so the oracle cannot quietly
 *    disappear and leave the parser's differential test passing by vacuum.
 */
// @avenx-no-dev-runtime
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import module from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from '../../lib/compiler/parser/js/parser.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

console.log('\n📦 Runtime dependency guard\n');

// ---------------------------------------------------------------------------
// 1. The manifest.
// ---------------------------------------------------------------------------

assert.deepStrictEqual(
  pkg.dependencies,
  {},
  `package.json must declare no runtime dependencies, found ${JSON.stringify(pkg.dependencies)}`,
);
for (const field of ['peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
  const value = pkg[field];
  const empty = value === undefined || (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);
  assert.ok(empty, `package.json must declare no ${field}, found ${JSON.stringify(value)}`);
}
console.log('  ✅ package.json declares an empty dependency set.');

// ---------------------------------------------------------------------------
// 2. The lockfile, which is where a transitive dependency would show up.
// ---------------------------------------------------------------------------

const lockPath = path.join(rootDir, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const root = lock.packages && lock.packages[''];
  assert.ok(root, 'package-lock.json should describe the root package');
  const rootDependencies = root.dependencies || {};
  assert.deepStrictEqual(
    rootDependencies,
    {},
    `the lockfile's root entry must have no dependencies, found ${JSON.stringify(rootDependencies)}`,
  );

  const production = Object.entries(lock.packages || {})
    .filter(([name, entry]) => name !== '' && entry.dev !== true && entry.devOptional !== true)
    .map(([name]) => name);
  assert.deepStrictEqual(
    production,
    [],
    `the lockfile must resolve nothing outside devDependencies, found ${production.join(', ')}`,
  );
  console.log('  ✅ package-lock.json resolves nothing that is not development-only.');
} else {
  console.log('  ⚠️  no package-lock.json to check.');
}

// ---------------------------------------------------------------------------
// 3. What the shipped files import.
// ---------------------------------------------------------------------------

/**
 * The one bare specifier a shipped file may import.
 *
 * `lib/core/tooling/prettierPlugin.js` is a Prettier plugin: Prettier loads
 * it, so Prettier is already in the process by definition and the import can
 * never be unsatisfied. It is on no build path, which is why it is not a
 * dependency and never was. Anything else arriving in this list is a new
 * runtime dependency being introduced by an import.
 * @type {(specifier: string) => boolean}
 */
const isAllowedHostImport = (specifier) => specifier === 'prettier' || specifier.startsWith('prettier/');

/**
 * Node's own builtin module names, with and without the `node:` prefix.
 * @type {Set<string>}
 */
const BUILTINS = new Set([
  ...module.builtinModules,
  ...module.builtinModules.map((name) => `node:${name}`),
]);

/**
 * Lists the JavaScript files beneath a path named in `package.json`'s `files`.
 * @param {string} entry - A `files` entry.
 * @returns {string[]} Absolute paths.
 */
function shippedJsFiles(entry) {
  const full = path.join(rootDir, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return full.endsWith('.js') ? [full] : [];
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue;
      const next = path.join(dir, item.name);
      if (item.isDirectory()) walk(next);
      else if (item.name.endsWith('.js') || item.name.endsWith('.mjs')) out.push(next);
    }
  };
  walk(full);
  return out;
}

/**
 * Collects every module specifier a source imports, statically or dynamically.
 *
 * Read with the compiler's own parser, which is the point: the check that the
 * package has no parser dependency is itself performed by the parser that
 * replaced it.
 * @param {object} node - An ESTree node.
 * @param {string[]} into - Where to collect specifiers.
 */
function collectSpecifiers(node, into) {
  if (!node || typeof node.type !== 'string') return;
  if (
    (node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration') &&
    node.source
  ) {
    into.push(node.source.value);
  }
  if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') {
    into.push(node.source.value);
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) collectSpecifiers(child, into);
    } else if (value && typeof value.type === 'string') {
      collectSpecifiers(value, into);
    }
  }
}

const shipped = (pkg.files || []).flatMap(shippedJsFiles);
assert.ok(shipped.length > 100, `the shipped file set should be substantial, found ${shipped.length}`);

/** @type {Map<string, string[]>} */
const offenders = new Map();
for (const file of shipped) {
  const source = fs.readFileSync(file, 'utf8');
  /** @type {string[]} */
  const specifiers = [];
  collectSpecifiers(parse(source, { sourceType: 'module', allowHashBang: true }), specifiers);
  for (const specifier of specifiers) {
    if (typeof specifier !== 'string') continue;
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) continue;
    if (BUILTINS.has(specifier)) continue;
    if (isAllowedHostImport(specifier)) continue;
    const list = offenders.get(specifier) || [];
    list.push(path.relative(rootDir, file));
    offenders.set(specifier, list);
  }
}
assert.strictEqual(
  offenders.size,
  0,
  `shipped files import third-party modules: ${[...offenders]
    .map(([specifier, files]) => `${specifier} (${files.join(', ')})`)
    .join('; ')}`,
);
console.log(`  ✅ ${shipped.length} shipped files import only Node builtins and relative paths.`);

// ---------------------------------------------------------------------------
// 4. The oracle has to stay installed.
// ---------------------------------------------------------------------------

assert.ok(
  pkg.devDependencies && pkg.devDependencies.acorn,
  'acorn must stay a devDependency: it is the oracle the parser is tested against',
);
console.log('  ✅ acorn is still available for development, as the parser oracle.');

console.log('\n✅ runtime dependency guard passed');
