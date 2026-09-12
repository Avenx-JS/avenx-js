/**
 * @file list-rendering.bench.js
 * @description What a keyed list costs, on each of the two rendering paths.
 *
 * ## Why this benchmark exists
 *
 * `<@for>` used to put a component on the string renderer unconditionally. The
 * IR lowers it, so a list now runs as a compiled block with one effect per
 * binding and a keyed reconciler. This is the measurement of that change, and
 * it is written to make the comparison honest rather than favourable:
 *
 * - One component source, compiled once by the real compiler.
 * - Mounted twice. The second mount has `__axProgram` deleted, which is the
 *   real fallback the compiler produces for a template it cannot lower -- not
 *   a simulation of one. The same technique the render-path parity test uses.
 * - The same interactions driven against both.
 *
 * ## Read the ratios, not the milliseconds
 *
 * happy-dom is not a browser: it has no layout, no style resolution and no
 * paint, so an absolute number here says nothing about a real page. What
 * survives the difference is the shape -- how each column grows with the size
 * of the list, and how the two columns compare at the same size.
 */
import './support/dom.js';

import { compileComponent, cleanup } from './support/compileFixture.js';

const SIZES = [20, 100, 500];
const ITERATIONS = 20;

const SOURCE = `
<state rows='[]' />

<div>
  <ul>
    <@for row in rows key="row.id">
      <li data-id="{{ row.id }}">{{ row.label }}</li>
    </@for>
  </ul>
</div>
`;

const ComponentClass = compileComponent(SOURCE, 'BenchList');

if (!ComponentClass.__axProgram) {
  throw new Error(
    'the list component did not compile to a render program, so this benchmark would compare the string renderer with itself.',
  );
}

const PROGRAM = ComponentClass.__axProgram;
const PROGRAM_EXPRS = ComponentClass.__axProgramExprs;

/**
 * Builds `size` rows.
 * @param {number} size - How many rows.
 * @returns {Array<{id: number, label: string}>} The rows.
 */
function makeRows(size) {
  return Array.from({ length: size }, (_, i) => ({ id: i, label: `row ${i}` }));
}

/**
 * Mounts the component on one of the two paths.
 * @param {number} size - How many rows to start with.
 * @param {boolean} compiled - Whether to keep the render program.
 * @returns {Promise<{component: object, el: Element}>} The mount.
 */
async function mount(size, compiled) {
  // Deleting the static is what makes the constructor see no program, so the
  // instance takes the string path exactly as an uncompilable template would.
  if (compiled) {
    ComponentClass.__axProgram = PROGRAM;
    ComponentClass.__axProgramExprs = PROGRAM_EXPRS;
  } else {
    delete ComponentClass.__axProgram;
  }

  const el = document.createElement('div');
  document.body.appendChild(el);
  const component = new ComponentClass({}, {});
  component.mount(el);
  component.state.rows = makeRows(size);
  await component.$nextTick();

  // A benchmark measuring a render that did not happen reports a near-zero and
  // reads as an improvement, which is the worst way for one to fail.
  if (el.querySelectorAll('li').length !== size) {
    throw new Error(
      `expected ${size} rows on the ${compiled ? 'compiled' : 'string'} path, got ${el.querySelectorAll('li').length}`,
    );
  }

  return { component, el };
}

/**
 * Times one scenario.
 * @param {number} size - List size.
 * @param {boolean} compiled - Which path.
 * @param {function(object): void} mutate - The mutation to time.
 * @returns {Promise<number>} Average milliseconds per update.
 */
async function time(size, compiled, mutate) {
  const { component, el } = await mount(size, compiled);

  // Warm-up, so the first measured pass is not paying for lazy construction.
  mutate(component);
  await component.$nextTick();

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    mutate(component);
    await component.$nextTick();
  }
  const elapsed = performance.now() - start;

  component.unmount();
  el.remove();
  return elapsed / ITERATIONS;
}

/**
 * Renames one row: the smallest change a list can undergo.
 * @param {object} component - The mounted component.
 */
let renameCounter = 0;
function renameOneRow(component) {
  component.state.rows[0].label = `renamed ${renameCounter++}`;
}

/**
 * Moves the last row to the front, which a keyed reconciler should handle by
 * moving one node.
 * @param {object} component - The mounted component.
 */
function reorder(component) {
  const rows = component.state.rows.slice();
  rows.unshift(rows.pop());
  component.state.rows = rows;
}

/**
 * Appends a row.
 * @param {object} component - The mounted component.
 */
let appendCounter = 100000;
function append(component) {
  component.state.rows.push({ id: appendCounter++, label: 'appended' });
}

const SCENARIOS = [
  ['one row renamed', renameOneRow],
  ['last row moved first', reorder],
  ['one row appended', append],
];

console.log('Running list-rendering benchmark');
console.log('happy-dom, not a browser: read the ratios, not the absolute numbers.\n');

let totalTime = 0;
let samples = 0;

for (const [label, mutate] of SCENARIOS) {
  console.log(`${label}:`);
  for (const size of SIZES) {
    const compiled = await time(size, true, mutate);
    const string = await time(size, false, mutate);
    totalTime += compiled + string;
    samples += 2;

    const ratio = compiled > 0 ? (string / compiled).toFixed(1) : 'n/a';
    console.log(
      `  rows=${String(size).padStart(4)}   compiled: ${compiled.toFixed(3).padStart(8)} ms` +
        `   string: ${string.toFixed(3).padStart(8)} ms   ${ratio}x`,
    );
  }
  console.log('');
}

console.log(
  'The compiled column should stay close to flat as rows grow: a keyed block updates\n' +
    'the bindings whose dependencies changed. The string column grows with the list,\n' +
    'because it re-renders the whole template and diffs the result.\n',
);

console.log(`Total time: ${totalTime.toFixed(2)}ms`);
console.log(`Average time per update: ${(totalTime / samples).toFixed(4)}ms`);
console.log(`Ops/sec: ${Math.round(1000 / (totalTime / samples))}`);

cleanup();
