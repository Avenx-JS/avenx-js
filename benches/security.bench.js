import { performance } from 'perf_hooks';
import '../test/helpers/register-happy-dom.js';
import { DynamicEvaluator } from '../lib/core/security/evaluator.js';
import { Sanitizer } from '../lib/core/security/sanitize.js';

/**
 * Runs benchmarks on the security modules (expression evaluator, sanitizer).
 */
function benchmark() {
  const evaluatorIterations = 10000;
  const sanitizerIterations = 1000;

  const evaluator = new DynamicEvaluator();
  const sanitizer = new Sanitizer();

  console.log(`Running Security benchmark with ${evaluatorIterations} evaluator and ${sanitizerIterations} sanitizer iterations...`);

  // 1. Dynamic Evaluator Expression Evaluation
  const scope = {
    x: 10,
    y: 20,
    user: {
      name: 'John',
      age: 25,
      isAdmin: false,
    },
  };

  const startEval = performance.now();
  for (let i = 0; i < evaluatorIterations; i++) {
    evaluator.evaluateExpression('x + y * 2', scope);
    evaluator.evaluateExpression("user.age >= 18 ? 'Adult' : 'Minor'", scope);
    evaluator.evaluateExpression("user.name + ' (' + user.age + ')'", scope);
  }
  const endEval = performance.now();
  const evalTime = endEval - startEval;

  // 2. Sanitizer HTML Sanitization
  const safeHtml = `
    <div class="card" id="user-1">
      <h3>John Doe</h3>
      <p>This is a <strong>safe</strong> paragraph with <a href="https://example.com" target="_blank">a link</a>.</p>
      <img src="https://example.com/avatar.png" alt="Avatar" width="100" />
    </div>
  `;

  const dangerousHtml = `
    <div onclick="alert(1)">
      <h3>Hacker</h3>
      <script>alert('xss')</script>
      <iframe src="javascript:alert(1)"></iframe>
      <img src="javascript:alert(1)" onerror="alert(1)" />
      <a href="javascript:void(0)">Click here</a>
      <invalidtag>Some text</invalidtag>
    </div>
  `;

  // Mute console.warn during benchmark to avoid excessive stdout logs
  const originalWarn = console.warn;
  console.warn = () => {};

  const startSanitize = performance.now();
  for (let i = 0; i < sanitizerIterations; i++) {
    sanitizer.sanitize(safeHtml);
    sanitizer.sanitize(dangerousHtml);
  }
  const endSanitize = performance.now();
  const sanitizeTime = endSanitize - startSanitize;

  // Restore console.warn
  console.warn = originalWarn;

  const totalOps = evaluatorIterations * 3 + sanitizerIterations * 2;
  const totalTime = evalTime + sanitizeTime;
  const avgTime = totalTime / totalOps;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per operation: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
  console.log(`  - Sandbox Evaluator: ${evalTime.toFixed(2)}ms`);
  console.log(`  - HTML Sanitizer: ${sanitizeTime.toFixed(2)}ms`);
}

benchmark();
