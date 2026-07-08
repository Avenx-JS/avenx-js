const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Load the runtime by stripping imports/exports, matching compiler bundling.
const runtimeFiles = [
  'security/evaluator.js',
  'reactive/proxyHandler.js',
  'reactive/createState.js',
  'reactive/createComputed.js',
  'renderer/renderTemplate.js',
  'renderer/domPatch.js',
  'events/eventExecutor.js',
  'events/bindEvents.js',
  'runtime/lifecycle.js',
  'runtime/AvenxBridge.js',
  'runtime/AvenxComponent.js',
  'runtime/AvenxApp.js',
];

const componentCode = runtimeFiles
  .map((file) => fs.readFileSync(path.join(__dirname, '../lib/core', file), 'utf-8'))
  .map((source) => source.replace(/^import\s+.*?;\s*$/gm, '').replace(/export\s+/g, ''))
  .join('\n');

// Create a sandbox to "eval" the class into the current scope
const AvenxComponent = (function () {
  const exports = {};
  eval(componentCode + '\nexports.AvenxComponent = AvenxComponent;');
  return exports.AvenxComponent;
})();

/**
 *
 */
function benchmark() {
  const iterations = 10000;

  const template = `
    <div class="user-card">
        <h2>{{ name }}</h2>
        <p>Age: {{ age }}</p>
        <p>Status: {{ age >= 18 ? 'Adult' : 'Minor' }}</p>
        <p>Double Age: {{ age * 2 }}</p>
    </div>
    `;

  const initialState = { name: 'John Doe', age: 25 };
  const computed = {};

  const component = new AvenxComponent(initialState, computed, {}, template, {});

  console.log(`Running AvenxComponent.render() benchmark with ${iterations} iterations...`);

  // Warmup
  for (let i = 0; i < 100; i++) {
    component.render();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    component.render();
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per render: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
}

benchmark();
