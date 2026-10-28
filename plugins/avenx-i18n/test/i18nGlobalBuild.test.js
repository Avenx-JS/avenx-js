import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const testDir = path.dirname(__filename);
const i18nPkgDir = path.resolve(testDir, '..');
const exampleDir = path.resolve(i18nPkgDir, 'example');
const i18nGlobalPath = path.resolve(i18nPkgDir, 'dist', 'avenx-i18n.global.js');

console.log('🧪 Starting Avenx i18n Global Build Integration Tests...');

/**
 * 1. Test missing runtime error handling.
 */
function testMissingRuntimeDiagnostics() {
  console.log('  1. Testing missing runtime diagnostics...');

  const window = new Window();
  const i18nScript = fs.readFileSync(i18nGlobalPath, 'utf-8');
  window.eval(i18nScript);

  // Without Avenx runtime:
  assert.throws(
    () => {
      window.AvenxI18n.createI18n({ locale: 'en', messages: { en: {} } });
    },
    /\[avenx-i18n\] The Avenx runtime was not found on the page/,
    'throws helpful message when Avenx global is absent',
  );

  // With Avenx runtime missing required 'bridge' member:
  window.Avenx = {};
  assert.throws(
    () => {
      window.AvenxI18n.createI18n({ locale: 'en', messages: { en: {} } });
    },
    /\[avenx-i18n\] The Avenx runtime is missing required member\(s\): bridge\./,
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
  const i18nScript = fs.readFileSync(i18nGlobalPath, 'utf-8');

  const window = new Window();
  window.document.body.innerHTML = '<div id="app"></div>';

  // Load plugin global, then bundle script
  window.eval(i18nScript);
  assert.ok(window.AvenxI18n, 'AvenxI18n is exposed on window');

  // Evaluating bundle mounts the app
  window.eval(bundleScript);

  // Give router and reactive ticks a moment to settle
  await new Promise((resolve) => setTimeout(resolve, 50));

  const h1 = window.document.querySelector('h1');
  assert.ok(h1, 'h1 rendered in the DOM');
  // Initial locale is de-CH which translates title to "Avenx Warehuus"
  assert.strictEqual(h1.textContent.trim(), 'Avenx Warehuus', 'rendered translation in de-CH locale');

  // Verify rich markup (tHtml) rendered as a real link, not escaped plain text
  const termsLink = window.document.querySelector('a[href="#terms"]');
  assert.ok(termsLink, 'tHtml rendered a live anchor element');
  assert.strictEqual(termsLink.textContent.trim(), 'Verkaufsbedingungen');

  // Switch locale to English ('en')
  const buttons = Array.from(window.document.querySelectorAll('button'));
  const enButton = buttons.find((btn) => btn.textContent.trim() === 'en');
  assert.ok(enButton, 'English locale switcher button exists');

  enButton.click();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(h1.textContent.trim(), 'Avenx Storefront', 'switched locale to English');

  console.log('  ✅ Example app global integration and locale switching passed!');
}

async function run() {
  testMissingRuntimeDiagnostics();
  await testExampleAppGlobalIntegration();
  console.log('\n🎉 ALL AVENX I18N GLOBAL BUILD TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((error) => {
  console.error('❌ Global build test failed:', error);
  process.exit(1);
});
