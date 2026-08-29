import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import AvenxCompiler from '../lib/compiler.js';
import { clearAtlasCache } from '../lib/compiler/atlas/cache.js';

/**
 * Measures what retaining the semantic model costs a build.
 *
 * Three numbers, and they answer three different questions:
 *
 * 1. **Analysis, cold.** What a first build pays to produce the Atlas on top of
 *    the parse it was doing anyway.
 * 2. **Analysis, warm.** What `avenx serve` and `avenx watch` pay on a rebuild
 *    where most files are unchanged. The per-unit fragment cache should turn
 *    most of the analysis into a merge.
 * 3. **Scaling.** The same measurement at two project sizes, so a change that
 *    introduces quadratic behaviour shows up as a per-component cost that grows
 *    instead of holding steady.
 *
 * The third is the one worth watching. Atlas resolves cross-file relationships,
 * and the naive shapes of that work — rescanning a file per declared name,
 * re-masking a template per pass — are exactly the ones that look fine on a
 * fixture and fall over on a real application.
 */

/**
 * Writes a synthetic project of `count` components sharing one bridge.
 *
 * Every component reads bridge state directly and through a loop, declares
 * computed values that chain, and invokes a bridge action — so the generated
 * project exercises the cross-file resolution that dominates the cost, not just
 * the per-file parse.
 * @param {number} count - How many components to generate.
 * @returns {string} The project root.
 */
function generateProject(count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `avenx-atlas-bench-${count}-`));
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'bridges'), { recursive: true });
  fs.mkdirSync(path.join(src, 'pages'), { recursive: true });

  fs.writeFileSync(path.join(root, 'avenx.config.json'), JSON.stringify({ srcDir: 'src', distDir: 'dist' }));

  fs.writeFileSync(
    path.join(src, 'bridges', 'store.bridge.js'),
    `import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { items: [], total: 0 },
  get count() {
    return this.items.length;
  },
  get sum() {
    return this.items.reduce((acc, entry) => acc + entry.v, 0);
  },
  add(v) {
    this.items.push({ v });
    this.total = this.total + v;
    this.emit('added', v);
  },
});
`,
  );

  let tags = '';
  for (let i = 0; i < count; i++) {
    const dir = path.join(src, 'components', `comp-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `comp-${i}.component.js`),
      `import store from '../../bridges/store.bridge.js';

<state a="1" b="2" label="x" />

<computed name="doubled" value="a * b" />
<computed name="withCount" value="doubled + store.count" />

<action name="bump">
  state.a = state.a + 1;
  store.add(state.a);
</action>

<div>
  <span>{{ a }}</span>
  <span>{{ doubled }}</span>
  <span>{{ withCount }}</span>
  <span>{{ store.sum }}</span>
  <@for it in store.items>
    <p>{{ it.v }} {{ label }}</p>
  </@for>
  <button @click="bump()">go</button>
</div>
`,
    );
    tags += `  <Comp${i} />\n`;
  }

  fs.writeFileSync(path.join(src, 'pages', 'home.page.js'), `<div>\n${tags}</div>\n`);
  fs.writeFileSync(
    path.join(src, 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });
app.initRouter({ '': 'Home' });
`,
  );

  return root;
}

/**
 * Runs one analysis and returns how long it took.
 * @param {string} root - The project root.
 * @returns {{ms: number, model: object}} The timing and the model.
 */
function analyzeOnce(root) {
  const compiler = new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', logging: { silent: true } });
  const start = performance.now();
  const model = compiler.analyze();
  return { ms: performance.now() - start, model };
}

/**
 * Best of several runs, to take the scheduler out of the number.
 * @param {string} root - The project root.
 * @param {number} runs - How many times to measure.
 * @returns {number} The fastest run, in milliseconds.
 */
function best(root, runs) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const { ms } = analyzeOnce(root);
    if (ms < fastest) fastest = ms;
  }
  return fastest;
}

/**
 * Measures analysis at one project size.
 * @param {number} count - How many components.
 * @returns {object} The measurements.
 */
function measure(count) {
  const root = generateProject(count);
  try {
    clearAtlasCache();
    const { ms: cold, model } = analyzeOnce(root);
    const warm = best(root, 4);

    return {
      count,
      cold,
      warm,
      nodes: model.nodes.size,
      edges: model.edges.length,
      unresolved: model.unresolved.length,
      coldPerComponent: cold / count,
      warmPerComponent: warm / count,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Runs the benchmark.
 * @returns {void}
 */
function benchmark() {
  const sizes = [50, 300];
  console.log(`Running Atlas Build benchmark at ${sizes.join(' and ')} components...`);

  const results = sizes.map(measure);

  for (const result of results) {
    console.log(
      `\n  ${result.count} components — ${result.nodes} nodes, ${result.edges} edges, ${result.unresolved} unresolved`,
    );
    console.log(`    cold analysis: ${result.cold.toFixed(2)}ms  (${result.coldPerComponent.toFixed(3)}ms/component)`);
    console.log(`    warm analysis: ${result.warm.toFixed(2)}ms  (${result.warmPerComponent.toFixed(3)}ms/component)`);
    console.log(`    cache saving:  ${(((result.cold - result.warm) / result.cold) * 100).toFixed(0)}%`);
  }

  // Per-component cost should hold roughly steady as the project grows. A
  // sharp rise here is the signature of a resolution step that got quadratic.
  const [small, large] = results;
  const growth = large.coldPerComponent / small.coldPerComponent;
  console.log(
    `\n  Per-component cost from ${small.count} to ${large.count} components: ${growth.toFixed(2)}x` +
      `${growth > 2 ? '  ⚠️  superlinear — check for a per-file scan added to a per-declaration loop' : '  (linear)'}`,
  );

  const total = results.reduce((sum, result) => sum + result.cold, 0);
  console.log(`\nTotal time: ${total.toFixed(2)}ms`);
  console.log(`Average time per analysis: ${(total / results.length).toFixed(2)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / (total / results.length))}`);
}

benchmark();
