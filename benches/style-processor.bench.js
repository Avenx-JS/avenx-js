import { performance } from 'perf_hooks';
import StyleProcessor from '../lib/compiler/StyleProcessor.js';

/**
 *
 */
function benchmark() {
  const iterations = 5000;
  const styleProcessor = new StyleProcessor();

  const html = `
    <div @css container>
        <h1 @css title>Hello World</h1>
        <p @css text>This is a benchmark.</p>
        <button @css btn-primary>Click me</button>
        <div <@css box /> >Nested style</div>
    </div>
    `;

  const desBlocks = {
    container: 'padding: 20px; background: @bg;',
    title: 'font-size: 24px; color: @primary;',
    text: 'font-size: 16px; color: @secondary;',
    'btn-primary': 'background: @primary; color: white; &:hover { background: @primary-dark; }',
    box: 'border: 1px solid black;',
  };

  // `reset()` clears variables along with the accumulated styles, so they are
  // registered again after every reset. Registering them once, before the
  // loop, left every iteration resolving nothing: the benchmark measured the
  // unresolved-variable diagnostic, and its megabytes of warnings overflowed
  // the runner's output buffer and killed the process.
  const resetWithVariables = () => {
    styleProcessor.reset();
    styleProcessor.addVariable('bg', '#f0f0f0');
    styleProcessor.addVariable('primary', '#007bff');
    styleProcessor.addVariable('primary-dark', '#0056b3');
    styleProcessor.addVariable('secondary', '#6c757d');
  };

  console.log(`Running StyleProcessor benchmark with ${iterations} iterations...`);

  // Warmup
  for (let i = 0; i < 100; i++) {
    resetWithVariables();
    styleProcessor.process(html, desBlocks, 'BenchmarkComponent');
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    resetWithVariables();
    styleProcessor.process(html, desBlocks, 'BenchmarkComponent');
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per process: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
}

benchmark();
