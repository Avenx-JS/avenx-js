import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../../lib/compiler.js';
import { AvenxComponent } from '../../../lib/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const testDir = path.dirname(__filename);
const chartsPkgDir = path.resolve(testDir, '..');
const exampleDir = path.resolve(chartsPkgDir, 'example');
const chartsGlobalPath = path.resolve(chartsPkgDir, 'dist', 'avenx-charts.global.js');
const missingRuntimeMessage = '[avenx-charts] The Avenx runtime was not found on the page. '
  + 'Load the compiled Avenx application bundle alongside avenx-charts.global.js.';

console.log('🧪 Starting Avenx Charts Global Build Integration Tests...');

/**
 * Reads the standalone charts bundle produced by the package build.
 * @returns {string} The bundle source.
 */
function readChartsGlobal() {
  assert.ok(fs.existsSync(chartsGlobalPath), 'charts global bundle was built');
  return fs.readFileSync(chartsGlobalPath, 'utf-8');
}

/**
 * Returns the placeholder prototype that the global chart classes extend.
 * @param {Function} ChartLine - Global ChartLine constructor.
 * @returns {object} Placeholder AvenxComponent prototype.
 */
function placeholderPrototypeOf(ChartLine) {
  const baseChartPrototype = Object.getPrototypeOf(ChartLine.prototype);
  return Object.getPrototypeOf(baseChartPrototype);
}

/**
 * 1. Test the compiled example against the real standalone charts bundle.
 * @returns {Promise<void>}
 */
async function testExampleAppGlobalIntegration() {
  console.log('  1. Testing example app rendering and reactive chart updates...');

  new AvenxCompiler({
    rootDir: exampleDir,
    srcDir: 'src',
    distDir: 'dist',
    mode: 'production',
  }).build();

  const bundlePath = path.resolve(exampleDir, 'dist', 'bundle.js');
  assert.ok(fs.existsSync(bundlePath), 'example app bundle was built');

  const chartsScript = readChartsGlobal();
  const bundleScript = fs.readFileSync(bundlePath, 'utf-8');
  const window = new Window();
  window.document.body.innerHTML = '<div id="app"></div>';

  window.eval(chartsScript);
  assert.ok(window.AvenxCharts, 'AvenxCharts is exposed on window');

  window.eval(bundleScript);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const appRoot = window.document.querySelector('#app');
  assert.ok(appRoot, 'application mount target exists');

  const svg = appRoot.querySelector('svg');
  assert.ok(svg, 'ChartLine rendered an SVG in #app');

  const initialLine = svg.querySelector('.ax-chart-line-path');
  assert.ok(initialLine, 'initial line path rendered');
  const initialPath = initialLine.getAttribute('d');
  assert.ok(initialPath, 'initial line path has geometry');
  assert.strictEqual(svg.querySelectorAll('.ax-chart-dots circle').length, 4, 'initial chart renders four dots');

  const hint = appRoot.querySelector('p');
  assert.ok(hint, 'point-count hint rendered');
  assert.strictEqual(hint.textContent.trim(), '4 points. Add one and watch the line redraw.');

  const addPointButton = Array.from(appRoot.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === 'Add a point',
  );
  assert.ok(addPointButton, 'Add a point button exists');

  addPointButton.click();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const updatedSvg = appRoot.querySelector('svg');
  assert.ok(updatedSvg, 'chart SVG remains mounted after the state update');
  assert.strictEqual(updatedSvg.querySelectorAll('.ax-chart-dots circle').length, 5, 'reactive chart renders five dots');
  assert.strictEqual(hint.textContent.trim(), '5 points. Add one and watch the line redraw.');

  const updatedLine = updatedSvg.querySelector('.ax-chart-line-path');
  assert.ok(updatedLine, 'updated line path rendered');
  assert.notStrictEqual(updatedLine.getAttribute('d'), initialPath, 'line geometry changes after adding a point');

  console.log('  ✅ Example app rendering and reactive chart updates passed!');
}

/**
 * 2. Test the exact diagnostic when the Avenx runtime is absent.
 */
function testMissingRuntimeDiagnostic() {
  console.log('  2. Testing missing runtime diagnostic...');

  const window = new Window();
  window.eval(readChartsGlobal());

  assert.throws(
    () => {
      new window.AvenxCharts.ChartLine({}, {});
    },
    { message: missingRuntimeMessage },
    'constructing a chart without Avenx throws the exact missing-runtime message',
  );

  console.log('  ✅ Missing runtime diagnostic passed!');
}

/**
 * 3. Test that plugin installation links the placeholder to the real runtime.
 */
function testPrototypeSplicing() {
  console.log('  3. Testing runtime prototype splicing...');

  const window = new Window();
  window.Avenx = { AvenxComponent };
  window.eval(readChartsGlobal());

  const { ChartLine, avenxCharts } = window.AvenxCharts;
  const placeholderPrototype = placeholderPrototypeOf(ChartLine);
  assert.strictEqual(ChartLine.prototype instanceof AvenxComponent, false, 'prototype starts unbound');
  assert.notStrictEqual(
    Object.getPrototypeOf(placeholderPrototype),
    AvenxComponent.prototype,
    'placeholder does not initially inherit from the real runtime component',
  );

  const components = new Map();
  const app = {
    components,
    register(name, ComponentClass) {
      components.set(name, ComponentClass);
    },
  };
  avenxCharts.install(app);

  assert.strictEqual(ChartLine.prototype instanceof AvenxComponent, true, 'ChartLine inherits from real runtime');
  assert.strictEqual(
    Object.getPrototypeOf(placeholderPrototype),
    AvenxComponent.prototype,
    'placeholder prototype links directly to the real runtime prototype',
  );
  assert.strictEqual(components.get('ChartLine'), ChartLine, 'install registers the linked ChartLine class');

  console.log('  ✅ Runtime prototype splicing passed!');
}

/**
 * 4. Test construction before plugin installation.
 */
function testConstructionBeforeInstall() {
  console.log('  4. Testing defensive construction before install...');

  const window = new Window();
  window.Avenx = { AvenxComponent };
  window.eval(readChartsGlobal());

  const { ChartLine } = window.AvenxCharts;
  const data = [
    { month: 'Jan', value: 120 },
    { month: 'Feb', value: 240 },
  ];
  const chart = new ChartLine({}, { data, x: 'month', y: 'value' });

  assert.ok(chart instanceof ChartLine, 'constructed object keeps the ChartLine prototype');
  assert.ok(chart instanceof AvenxComponent, 'constructed object is a real AvenxComponent instance');
  assert.strictEqual(typeof chart.mount, 'function', 'constructed chart inherits runtime component methods');
  assert.strictEqual(chart.getData().length, 2, 'constructed chart retains its chart props');
  assert.strictEqual(chart.getData()[1].month, 'Feb');

  console.log('  ✅ Defensive construction before install passed!');
}

/**
 * Runs the global build test suite.
 * @returns {Promise<void>}
 */
async function run() {
  await testExampleAppGlobalIntegration();
  testMissingRuntimeDiagnostic();
  testPrototypeSplicing();
  testConstructionBeforeInstall();
  console.log('\n🎉 ALL AVENX CHARTS GLOBAL BUILD TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((error) => {
  console.error('❌ Global build test failed:', error);
  process.exit(1);
});
