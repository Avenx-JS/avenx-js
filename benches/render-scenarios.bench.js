/**
 * @file render-scenarios.bench.js
 * @description The renderer regression matrix.
 *
 * One benchmark per shape the rendering architecture has to handle, measured
 * through the real compiler and the real runtime. This exists to be run before
 * and after an architecture change and compared row by row, so every scenario
 * is deliberately narrow: a row that moves says which mechanism moved it.
 *
 * The row that matters most is **one binding changes in a large component**.
 * Under a render-to-string-and-reparse architecture its cost is proportional to
 * the whole template. Under a compiled fine-grained architecture it should be
 * proportional to the binding, and therefore flat as the component grows.
 *
 * happy-dom, not a browser. Absolute milliseconds are not production figures;
 * the shape of a column and the ratio between rows are properties of the
 * algorithm and do carry over.
 */
import './support/dom.js';
import { measure, measureAllocation, report, row, bytes } from './support/harness.js';
import { compileComponent, cleanup } from './support/compileFixture.js';
import * as S from './support/scenarios.js';

/**
 * Mounts a compiled component class into a detached host element.
 * @param {Function} ComponentClass - The compiled class.
 * @param {object} [props] - Component props.
 * @returns {Promise<{component: object, host: Element}>} The mounted instance.
 */
async function mount(ComponentClass, props = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const component = new ComponentClass({}, props);
  component.mount(host);
  await component.$nextTick();
  return { component, host };
}

/**
 * Tears a mounted component down.
 * @param {object} component - The instance.
 * @param {Element} host - Its host element.
 */
function unmount(component, host) {
  try {
    component.unmount();
  } catch {
    // A scenario that cannot unmount cleanly must not take the suite with it.
  }
  host.remove();
}

const results = [];
const allocations = [];

/**
 * Records and prints one scenario result.
 * @param {string} label - Scenario name.
 * @param {number} value - Milliseconds per operation.
 * @param {string} [note] - Trailing commentary.
 */
function record(label, value, note = '') {
  results.push({ label, value });
  row(label, value, note);
}

console.log('Running render-scenarios benchmark');
console.log('happy-dom, not a browser: read the shape and the ratios.\n');

// ── 1. One binding changes, as the component grows ───────────────────────────
console.log('One text binding changes (the architecture question):');
const oneBindingSizes = [10, 100, 500, 1500];
const oneBindingCosts = [];
for (const n of oneBindingSizes) {
  const { source } = S.manyTextBindings(n);
  const Klass = compileComponent(source, `Text${n}`);
  const { component, host } = await mount(Klass);

  const cost = await measure({
    warmup: 3,
    iterations: n > 500 ? 4 : 20,
    samples: n > 500 ? 3 : 5,
    body: async (i) => {
      component.state.v0 = i;
      await component.$nextTick();
    },
  });
  oneBindingCosts.push(cost);
  record(`  ${String(n).padStart(4)} bindings, change 1`, cost);
  unmount(component, host);
}

const growth = oneBindingCosts[oneBindingCosts.length - 1] / Math.max(oneBindingCosts[0], 1e-6);
console.log(
  `\n  → cost grows ${growth.toFixed(1)}x from ${oneBindingSizes[0]} to ` +
    `${oneBindingSizes[oneBindingSizes.length - 1]} bindings ` +
    '(1.0x would mean the update is proportional to the change, not the template)\n',
);

// ── 2. Many bindings change at once ──────────────────────────────────────────
console.log('Many bindings change at once:');
{
  const n = 500;
  const { source } = S.manyTextBindings(n);
  const Klass = compileComponent(source, `TextAll${n}`);
  const { component, host } = await mount(Klass);
  record(
    `  ${n} bindings, change all`,
    await measure({
      iterations: 10,
      body: async (i) => {
        for (let k = 0; k < n; k++) component.state[`v${k}`] = i + k;
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 3. A write nothing renders ───────────────────────────────────────────────
console.log('\nA write no binding reads (should be ~free):');
{
  const { source } = S.manyTextBindings(1500);
  const Klass = compileComponent(source, 'Unread1500');
  const { component, host } = await mount(Klass);
  record(
    '  1500 bindings, change an unread key',
    await measure({
      iterations: 20,
      body: async (i) => {
        component.state.unrelated = i;
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 4. Large static subtree ──────────────────────────────────────────────────
console.log('\nLarge static subtree, one live binding:');
for (const n of [200, 800]) {
  const { source } = S.largeStaticSubtree(n);
  const Klass = compileComponent(source, `Static${n}`);
  const { component, host } = await mount(Klass);
  const step = async (i) => {
    component.state.counter = i;
    await component.$nextTick();
  };
  record(
    `  ${String(n).padStart(4)} static rows, change the live value`,
    await measure({ warmup: 3, iterations: n > 400 ? 4 : 20, samples: 3, body: step }),
  );
  const alloc = await measureAllocation({ iterations: 5, body: step });
  console.log(`  ${''.padEnd(38)} ${bytes(alloc)}  allocated per update`);
  allocations.push({ label: `${n} static rows`, value: alloc });
  unmount(component, host);
}

// ── 5. Attribute bindings ────────────────────────────────────────────────────
console.log('\nAttribute bindings:');
{
  const { source } = S.manyAttributeBindings(500);
  const Klass = compileComponent(source, 'Attr500');
  const { component, host } = await mount(Klass);
  record(
    '  500 attribute bindings, change 1',
    await measure({
      iterations: 20,
      body: async (i) => {
        component.state.t0 = `title ${i}`;
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 6. Computed fan-out ──────────────────────────────────────────────────────
console.log('\nComputed values:');
{
  const { source } = S.computedFanOut(300);
  const Klass = compileComponent(source, 'Computed300');
  const { component, host } = await mount(Klass);
  record(
    '  300 bindings on 1 computed, change its input',
    await measure({
      iterations: 20,
      body: async (i) => {
        component.state.base = i;
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 7. Lists ─────────────────────────────────────────────────────────────────
console.log('\nKeyed lists:');
{
  const { source, rows } = S.keyedList(200);
  const Klass = compileComponent(source, 'List200');
  const { component, host } = await mount(Klass);
  component.state.rows = rows;
  await component.$nextTick();

  record(
    '  200 rows, change 1 row label',
    await measure({
      iterations: 10,
      body: async (i) => {
        component.state.rows[0].label = `row ${i}`;
        await component.$nextTick();
      },
    }),
  );
  record(
    '  200 rows, prepend + remove',
    await measure({
      iterations: 10,
      body: async (i) => {
        component.state.rows.unshift({ id: 10000 + i, label: `new ${i}` });
        component.state.rows.pop();
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 8. Conditional rendering ─────────────────────────────────────────────────
console.log('\nConditional rendering:');
{
  const { source } = S.conditionalBranch(300);
  const Klass = compileComponent(source, 'Cond300');
  const { component, host } = await mount(Klass);
  record(
    '  toggle a 300-node branch',
    await measure({
      iterations: 10,
      body: async (i) => {
        component.state.open = i % 2 === 0;
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 9. Event-driven updates ──────────────────────────────────────────────────
console.log('\nEvent-driven updates:');
{
  const { source } = S.manyEventHandlers(200);
  const Klass = compileComponent(source, 'Events200');
  const { component, host } = await mount(Klass);
  const button = host.querySelector('button');
  record(
    '  200 handlers bound, dispatch 1 click',
    await measure({
      iterations: 20,
      body: async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await component.$nextTick();
      },
    }),
  );
  unmount(component, host);
}

// ── 10. Mount cost ───────────────────────────────────────────────────────────
console.log('\nMount cost (create path, not update path):');
for (const n of [50, 300]) {
  const { source } = S.mixedComponent(n);
  const Klass = compileComponent(source, `Mixed${n}`);
  record(
    `  ${String(n).padStart(4)}-block mixed component, mount`,
    await measure({
      warmup: 2,
      iterations: 3,
      samples: 3,
      body: async () => {
        const { component, host } = await mount(Klass);
        unmount(component, host);
      },
    }),
  );
}

cleanup();

const total = results.reduce((sum, r) => sum + r.value, 0);
report({ totalMs: total, avgMs: oneBindingCosts[oneBindingCosts.length - 1], unit: 'update' });

process.exit(0);
