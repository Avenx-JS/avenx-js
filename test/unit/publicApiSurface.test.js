import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as runtime from '../../lib/core/index.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxRouter } from '../../lib/core/runtime/AvenxRouter.js';

/**
 * Guards the published type definitions against drift.
 *
 * lib/core/index.d.ts is hand-written alongside the implementation and nothing
 * validated the two against each other, so newly added public API (`$inspect`,
 * `$tripDeadlockBoundary`, `RouteMatcher` and others) shipped undeclared. This
 * test fails when a public export or a public class member has no declaration,
 * so the gap has to be closed in the same change that opens it.
 */

const __filename = fileURLToPath(import.meta.url);
const dtsPath = path.resolve(path.dirname(__filename), '../../lib/core/index.d.ts');
const dts = fs.readFileSync(dtsPath, 'utf-8');

/**
 * Collects the public instance members of a class prototype.
 *
 * Private fields are already invisible here; `_`-prefixed members are internal
 * by convention and `__`-prefixed members are framework-internal plumbing.
 * @param {Function} ctor - The class to inspect.
 * @returns {string[]} Public member names.
 */
function publicMembersOf(ctor) {
  return Object.getOwnPropertyNames(ctor.prototype).filter(
    (name) => name !== 'constructor' && !name.startsWith('_'),
  );
}

/**
 * Every runtime export must be declared.
 */
function testAllRuntimeExportsAreDeclared() {
  console.log('🧪 Testing every runtime export is declared in index.d.ts...');

  const exported = Object.keys(runtime);
  const missing = exported.filter((name) => !dts.includes(name));

  assert.deepStrictEqual(
    missing,
    [],
    `these exports of lib/core/index.js have no declaration in lib/core/index.d.ts: ${missing.join(', ')}`,
  );
  assert.ok(exported.length > 50, 'the runtime should expose a substantial public surface');

  console.log(`  ✅ All ${exported.length} runtime exports declared.`);
}

/**
 * Every public member of the core runtime classes must be declared.
 */
function testPublicClassMembersAreDeclared() {
  console.log('🧪 Testing public class members are declared...');

  const classes = [
    ['AvenxComponent', AvenxComponent],
    ['AvenxApp', AvenxApp],
    ['AvenxRouter', AvenxRouter],
  ];

  for (const [name, ctor] of classes) {
    const members = publicMembersOf(ctor);
    const missing = members.filter((member) => !dts.includes(member));

    assert.deepStrictEqual(
      missing,
      [],
      `these public members of ${name} have no declaration in lib/core/index.d.ts: ${missing.join(', ')}`,
    );
  }

  console.log('  ✅ Public members of the core runtime classes are declared.');
}

/**
 * Every value the type definitions declare exists at runtime.
 *
 * `testAllRuntimeExportsAreDeclared` covers one direction. This is the other:
 * an `export class`/`function`/`const` in index.d.ts is a promise that the
 * binding exists on the barrel, and a type-only declaration is invisible to
 * the check above. `Resource` shipped declared but undefined because nothing
 * asserted this half.
 */
function testAllDeclaredValuesAreExported() {
  console.log('🧪 Testing every declared value is exported from index.js...');

  const declared = [
    ...dts.matchAll(/^export\s+(?:declare\s+)?(?:class|function|const|let|var)\s+([A-Za-z0-9_$]+)/gm),
  ].map((match) => match[1]);
  const unique = [...new Set(declared)];
  const missing = unique.filter((name) => !(name in runtime));

  const detail =
    'these values are declared in lib/core/index.d.ts but exported by nothing in ' +
    `lib/core/index.js: ${missing.join(', ')}`;

  assert.deepStrictEqual(missing, [], detail);
  assert.ok(unique.length > 90, 'the runtime declaration file should declare a substantial public surface');

  console.log(`  ✅ All ${unique.length} declared values exported.`);
}

/**
 * The package's declared entry points must exist on disk.
 */
function testPackageTypeEntryPointsExist() {
  console.log('🧪 Testing package type entry points resolve...');

  const pkgPath = path.resolve(path.dirname(__filename), '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const rootDir = path.dirname(pkgPath);

  for (const [subpath, entry] of Object.entries(pkg.exports || {})) {
    if (!entry || typeof entry !== 'object' || !entry.types) continue;
    const typesPath = path.resolve(rootDir, entry.types);
    assert.ok(fs.existsSync(typesPath), `types entry for "${subpath}" does not exist: ${entry.types}`);
  }

  console.log('  ✅ Declared type entry points exist.');
}

try {
  testAllRuntimeExportsAreDeclared();
  testAllDeclaredValuesAreExported();
  testPublicClassMembersAreDeclared();
  testPackageTypeEntryPointsExist();
  console.log('🎉 All public API surface tests passed successfully!');
} catch (err) {
  console.error('❌ Public API surface test failed:', err);
  process.exit(1);
}
