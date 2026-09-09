/**
 * @file render-phases.bench.js
 * @description Where the time actually goes inside one update.
 *
 * "The renderer is slow" is not an actionable finding. This decomposes a single
 * component update into the stages the architecture is built from, so a change
 * can be aimed at the stage that costs something rather than at the one that is
 * easiest to see.
 *
 * The stages of the string-rendering pipeline, in order:
 *
 * ```text
 *   interpolate template  →  HTML string  →  DOMParser  →  tree diff  →  DOM writes
 * ```
 *
 * Each is measured in isolation against the same component, plus the two costs
 * that sit underneath all of them: building an evaluation scope, and evaluating
 * one expression.
 */
import './support/dom.js';
import { measure, report } from './support/harness.js';
import { compileComponent, cleanup } from './support/compileFixture.js';
import * as S from './support/scenarios.js';
import { TemplateRenderer } from '../lib/core/renderer/renderTemplate.js';
import { DomPatcher } from '../lib/core/renderer/domPatch.js';

const SIZE = 400;

const { source } = S.manyTextBindings(SIZE);
const Klass = compileComponent(source, `Phases${SIZE}`);

const host = document.createElement('div');
document.body.appendChild(host);
const component = new Klass({}, {});
component.mount(host);
await component.$nextTick();

// The pieces the component uses internally, reached the same way it reaches
// them, so the numbers describe the shipping path rather than a reconstruction.
const renderer = new TemplateRenderer(500);
const patcher = new DomPatcher();

/**
 * The component's own expression resolution, via its internal seam.
 * @param {string} expression - The expression source.
 * @returns {any} The value.
 */
const resolve = (expression) => component.__evaluate(expression);

const tpl = component.__getTemplate();

console.log('Running render-phases benchmark');
console.log(`One update of a ${SIZE}-binding component, decomposed.\n`);

const phases = [];

/**
 * Times one phase and records it.
 * @param {string} label - Phase name.
 * @param {function(): (void|Promise<void>)} body - The phase.
 * @param {number} [iterations] - Iterations per sample.
 */
async function phase(label, body, iterations = 20) {
  const value = await measure({ warmup: 3, iterations, samples: 5, body });
  phases.push({ label, value });
  return value;
}

// 1. Interpolate the template to an HTML string.
await phase('render to HTML string', () => {
  renderer.render(tpl, resolve);
});

const html = renderer.render(tpl, resolve);

// 2. Parse that string back into a DOM tree.
const parser = new DOMParser();
await phase('parse the HTML string', () => {
  parser.parseFromString(html, 'text/html');
});

// 3. Diff the parsed tree against the live DOM.
await phase('diff + patch against live DOM', () => {
  patcher.patch(host, html, resolve, null);
});

// 4. Build one evaluation scope.
await phase(
  'build one evaluation scope',
  () => {
    component.__buildScope();
  },
  200,
);

// 5. Evaluate one already-parsed expression.
await phase(
  'evaluate one expression (cached AST)',
  () => {
    resolve('v0');
  },
  200,
);

// 6. The whole update, for reference.
const whole = await phase(
  'whole update() cycle',
  async (i) => {
    component.state.v0 = i;
    await component.$nextTick();
  },
  10,
);

const pipeline = phases.slice(0, 3).reduce((sum, p) => sum + p.value, 0);

console.log('  Stage                                   ms/op     share of update');
console.log('  ' + '─'.repeat(66));
for (const p of phases) {
  const share = p.label === 'whole update() cycle' ? '' : `${((p.value / whole) * 100).toFixed(1)}%`;
  console.log(`  ${p.label.padEnd(38)} ${p.value.toFixed(4).padStart(9)}  ${share.padStart(8)}`);
}
console.log('  ' + '─'.repeat(66));

const perExpression = phases.find((p) => p.label.startsWith('evaluate one expression')).value;
console.log(
  `\n  string + parse + diff, measured separately: ${pipeline.toFixed(4)} ms.\n` +
    '  Each stage is timed on its own, so the three do not sum to the whole-update\n' +
    '  figure -- they overlap and each carries its own call overhead. The shares are\n' +
    '  a decomposition, not a partition.\n',
);
console.log(
  `  What the whole-update figure is made of, at ${SIZE} bindings:\n` +
    `    · ${SIZE} expression evaluations   ≈ ${(perExpression * SIZE).toFixed(3)} ms\n` +
    `    · one HTML parse                 ≈ ${phases[1].value.toFixed(3)} ms\n` +
    `    · one full-tree diff             ≈ ${phases[2].value.toFixed(3)} ms\n` +
    '\n' +
    '  All three scale with the size of the template rather than the size of the\n' +
    `  change. A fine-grained architecture would pay one evaluation (${perExpression.toFixed(4)} ms)\n` +
    '  and one DOM write, and neither parse nor diff at all.\n',
);

component.unmount();
host.remove();
cleanup();

report({
  totalMs: phases.reduce((s, p) => s + p.value, 0),
  avgMs: whole,
  unit: 'update',
});

process.exit(0);
