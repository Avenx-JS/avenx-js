import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const testDir = path.dirname(__filename);
const persistencePkgDir = path.resolve(testDir, '..');
const exampleDir = path.resolve(persistencePkgDir, 'example');
const persistenceGlobalPath = path.resolve(persistencePkgDir, 'dist', 'avenx-persistence.global.js');

console.log('🧪 Starting Avenx Persistence Global Build Integration Tests...');

/**
 * 1. Test missing runtime error handling.
 */
function testMissingRuntimeDiagnostics() {
  console.log('  1. Testing missing runtime diagnostics...');

  const window = new Window();
  const persistenceScript = fs.readFileSync(persistenceGlobalPath, 'utf-8');
  window.eval(persistenceScript);

  // Without Avenx runtime:
  assert.throws(
    () => {
      window.AvenxPersistence.persist({ count: 0 }, { key: 'test' });
    },
    /\[avenx-persistence\] The Avenx runtime was not found on the page/,
    'throws helpful message when Avenx global is absent',
  );

  // With Avenx runtime missing required 'watchEffect' member:
  const window2 = new Window();
  window2.eval(persistenceScript);
  window2.Avenx = {};
  assert.throws(
    () => {
      window2.AvenxPersistence.persist({ count: 0 }, { key: 'test-missing' });
    },
    /\[avenx-persistence\] The Avenx runtime is missing required member\(s\): watchEffect\./,
    'names missing member rather than throwing bare TypeError',
  );

  console.log('  ✅ Missing runtime diagnostics passed!');
}

/**
 * 2. Test example app compilation and execution against global build.
 */
async function testExampleAppGlobalIntegration() {
  console.log('  2. Testing example app execution against global build...');

  // Build the example app bundle using the compiler
  new AvenxCompiler({
    rootDir: exampleDir,
    srcDir: 'src',
    distDir: 'dist',
    mode: 'production',
  }).build();

  const bundlePath = path.resolve(exampleDir, 'dist', 'bundle.js');
  assert.ok(fs.existsSync(bundlePath), 'example app bundle was built');

  const bundleScript = fs.readFileSync(bundlePath, 'utf-8');
  const persistenceScript = fs.readFileSync(persistenceGlobalPath, 'utf-8');

  const window = new Window();
  window.document.body.innerHTML = '<div id="app"></div>';

  // Load plugin global, then bundle script
  window.eval(persistenceScript);
  assert.ok(window.AvenxPersistence, 'AvenxPersistence is exposed on window');

  window.eval(bundleScript);

  // Give reactive ticks a moment to settle
  await new Promise((resolve) => setTimeout(resolve, 50));

  const hint = window.document.querySelector('p');
  assert.ok(hint, 'hint paragraph rendered');
  assert.strictEqual(
    hint.textContent.trim(),
    '0 left. Reload the page — the list is still here.',
    'renders initial state from persisted bridge',
  );

  console.log('  ✅ Example app global integration passed!');
}

/**
<<<<<<< HEAD
 * Runs the global build test suite.
 * @returns {Promise<void>}
=======
 *
>>>>>>> daf3b7db (test(e2e): add E2E coverage for declarative form validation (#1363))
 */
async function run() {
  testMissingRuntimeDiagnostics();
  await testExampleAppGlobalIntegration();
  console.log('\n🎉 ALL AVENX PERSISTENCE GLOBAL BUILD TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((error) => {
  console.error('❌ Global build test failed:', error);
  process.exit(1);
});
