/**
 * @file update-scaling.bench.js
 * @description How update cost scales with component size and change size.
 *
 * This is the benchmark the architecture work was aimed at, so it measures the
 * thing that was wrong rather than a number that flatters the framework.
 *
 * The finding it exists to track: a single-cell update used to cost time
 * proportional to the *whole component*, because building the evaluation scope
 * read every state key, so every component depended on all of its state and
 * re-rendered in full for any write. Fine-grained dependency tracking removes
 * the re-render for a write nothing reads; it does not remove the cost of a
 * render that does happen, which still renders the component to a string,
 * parses it and diffs it.
 *
 * Both are measured, because reporting only the first would be misleading.
 *
 * Numbers here are happy-dom, not a browser: the absolute milliseconds are not
 * production figures and are not comparable across machines. What is meaningful
 * is the *shape* -- how a column grows down the rows, and the ratio between the
 * "reads it" and "does not read it" columns, both of which are properties of
 * the algorithm rather than of the DOM implementation.
 */
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost' });
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.DOMParser = window.DOMParser;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { AvenxComponent } = await import('../lib/core/index.js');

const SIZES = [50, 200, 1000, 4000];
const ITERATIONS = 20;

/**
 * Builds a component with `size` interpolated cells over one state array.
 * @param {number} size - How many cells the template renders.
 * @returns {Promise<{component: AvenxComponent, el: Element}>} The mounted component.
 */
async function mount(size) {
  const rows = Array.from({ length: size }, (_, i) => ({ id: i, label: `row ${i}` }));
  const cells = rows.map((_, i) => `<span>{{ items[${i}].label }}</span>`).join('');

  /**
   * A component whose template interpolates every element of one state array.
   */
  class Bench extends AvenxComponent {
    /**
     * Builds the benchmark component.
     */
    constructor() {
      super({ items: rows, unrelated: 0 }, {}, {}, `<div>${cells}</div>`, {}, {}, {}, {});
    }
  }

  const el = document.createElement('div');
  document.body.appendChild(el);
  const component = new Bench();
  component.mount(el);
  await component.$nextTick();

  // A benchmark that measures a binding which throws reports a near-zero and
  // looks like an improvement, which is the worst way for one to fail. This
  // costs one string compare per mount and makes that impossible: if the render
  // did not produce the value, the benchmark stops instead of reporting.
  if (!el.textContent.includes('row 0')) {
    throw new Error(
      'the component did not render its first row, so nothing below would be measuring a render. ' +
        'Run this through benches/run.js, which installs the expression interpreter a benchmark needs.',
    );
  }

  return { component, el };
}

/**
 * Times a repeated operation.
 * @param {number} iterations - How many times to run it.
 * @param {function(number): Promise<void>} body - The operation.
 * @returns {Promise<number>} Milliseconds per iteration.
 */
async function time(iterations, body) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await body(i);
  }
  return (performance.now() - start) / iterations;
}

console.log('Running update-scaling benchmark');
console.log('happy-dom, not a browser: read the shape, not the absolute numbers.\n');

/** @type {Array<object>} */
const results = [];

for (const size of SIZES) {
  const { component, el } = await mount(size);

  // A write to a key the template reads: the component must re-render.
  const readMs = await time(ITERATIONS, async (i) => {
    component.state.items[0].label = `x${i}`;
    await component.$nextTick();
  });

  // A write to a key nothing reads. Before fine-grained tracking this cost the
  // same as the line above, because every write scheduled a full re-render.
  const unreadMs = await time(ITERATIONS, async (i) => {
    component.state.unrelated = i;
    await component.$nextTick();
  });

  results.push({ size, readMs, unreadMs });
  console.log(
    `nodes=${String(size).padStart(5)}   ` +
      `read-key update: ${readMs.toFixed(3).padStart(9)} ms   ` +
      `unread-key update: ${unreadMs.toFixed(3).padStart(9)} ms   ` +
      `ratio: ${(readMs / Math.max(unreadMs, 0.0001)).toFixed(0).padStart(5)}x`,
  );

  el.remove();
}

const first = results[0];
const last = results[results.length - 1];

console.log('');
console.log(
  `Read-key update grows ${(last.readMs / first.readMs).toFixed(0)}x from ${first.size} to ${last.size} nodes ` +
    '(the render-to-string, parse and diff path still scales with component size).',
);
console.log(
  `Unread-key update grows ${(last.unreadMs / Math.max(first.unreadMs, 0.0001)).toFixed(1)}x over the same range ` +
    '(it does no render at all, so it should stay flat).',
);
console.log(`\nTotal time: ${(results.reduce((a, r) => a + r.readMs + r.unreadMs, 0) * ITERATIONS).toFixed(2)}ms`);
console.log(`Average time per update: ${((last.readMs + last.unreadMs) / 2).toFixed(4)}ms`);
console.log(`Ops/sec: ${Math.round(1000 / Math.max(last.readMs, 0.0001))}`);

process.exit(0);
