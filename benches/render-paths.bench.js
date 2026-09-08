/**
 * @file render-paths.bench.js
 * @description The compiled renderer against the string renderer, directly.
 *
 * `render-scenarios.bench.js` measures whatever path a component actually
 * takes, which is what a user experiences. This one measures both paths for the
 * very same component, which is what an architecture decision has to be judged
 * on -- including the parts where the new one is worse.
 *
 * The same trick the parity tests use: the compiler emits the program as a
 * class static, and deleting it before construction sends the component down
 * the string path. So both columns are the same compiled class, the same
 * template and the same state.
 *
 * Fine-grained rendering has an obvious place to be worse: it creates one
 * reactive effect per binding at mount, where the string renderer creates one
 * per component, and it holds a node reference per binding for the life of the
 * instance. Mount cost and retained memory are therefore measured next to the
 * update numbers rather than assumed in a footnote, and the summary below is
 * computed from what ran rather than written in advance.
 */
import './support/dom.js';
import { measure, report } from './support/harness.js';
import { compileComponent, cleanup } from './support/compileFixture.js';
import * as S from './support/scenarios.js';

/**
 * Mounts a compiled class on the chosen path.
 * @param {Function} ComponentClass - The compiled class.
 * @param {boolean} compiled - Whether to keep the render program.
 * @returns {{component: object, host: Element}} The mount.
 */
function mount(ComponentClass, compiled) {
  const program = ComponentClass.__axProgram;
  if (!compiled) {
    delete ComponentClass.__axProgram;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const component = new ComponentClass({}, {});
  component.mount(host);
  ComponentClass.__axProgram = program;
  return { component, host };
}

/**
 * Tears a mount down.
 * @param {object} component - The instance.
 * @param {Element} host - Its host.
 */
function unmount(component, host) {
  try {
    component.unmount();
  } catch {
    // A path that cannot unmount cleanly must not take the run with it.
  }
  host.remove();
}

/**
 * Measures retained heap for a mounted component.
 * @param {Function} ComponentClass - The compiled class.
 * @param {boolean} compiled - Which path to measure.
 * @param {number} instances - How many to hold at once.
 * @returns {number} Bytes retained per instance, approximately.
 */
function retainedPerInstance(ComponentClass, compiled, instances) {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  const before = process.memoryUsage().heapUsed;

  const held = [];
  for (let i = 0; i < instances; i++) {
    held.push(mount(ComponentClass, compiled));
  }

  if (typeof globalThis.gc === 'function') globalThis.gc();
  const after = process.memoryUsage().heapUsed;

  for (const { component, host } of held) {
    unmount(component, host);
  }
  return Math.max(0, (after - before) / instances);
}

/**
 * Formats a byte count.
 * @param {number} value - Bytes.
 * @returns {string} A padded, human-readable size.
 */
function kb(value) {
  return `${(value / 1024).toFixed(1)} KB`.padStart(10);
}

console.log('Running render-paths benchmark');
console.log('Same component, both renderers. happy-dom: read the ratios.\n');

const SIZES = [50, 200, 800];
const results = [];

console.log('  size   update 1 binding            mount                    retained/instance');
console.log('  ' + '─'.repeat(82));

for (const n of SIZES) {
  const { source } = S.manyTextBindings(n);
  const ComponentClass = compileComponent(source, `Paths${n}`);

  /**
   * Times a single-binding update on one path.
   * @param {boolean} compiled - Which path.
   * @returns {Promise<number>} Milliseconds per update.
   */
  async function updateCost(compiled) {
    const { component, host } = mount(ComponentClass, compiled);
    const cost = await measure({
      warmup: 3,
      iterations: n > 400 ? 5 : 20,
      samples: 3,
      body: async (i) => {
        component.state.v0 = i;
        await component.$nextTick();
      },
    });
    unmount(component, host);
    return cost;
  }

  /**
   * Times a mount on one path.
   * @param {boolean} compiled - Which path.
   * @returns {Promise<number>} Milliseconds per mount.
   */
  async function mountCost(compiled) {
    return measure({
      // Enough warm-up to amortise the one-time skeleton parse. It happens on
      // the first mount of a class and never again, so folding it into a
      // per-mount average would report a cost no instance after the first pays.
      warmup: 6,
      iterations: 4,
      samples: 5,
      body: () => {
        const { component, host } = mount(ComponentClass, compiled);
        unmount(component, host);
      },
    });
  }

  const row = {
    n,
    updateCompiled: await updateCost(true),
    updateString: await updateCost(false),
    mountCompiled: await mountCost(true),
    mountString: await mountCost(false),
    heldCompiled: retainedPerInstance(ComponentClass, true, 5),
    heldString: retainedPerInstance(ComponentClass, false, 5),
  };
  results.push(row);

  console.log(
    `  ${String(n).padStart(4)}   ` +
      `${row.updateString.toFixed(3).padStart(9)} → ${row.updateCompiled.toFixed(3).padStart(8)} ms  ` +
      `(${(row.updateString / Math.max(row.updateCompiled, 1e-9)).toFixed(0).padStart(5)}x)   ` +
      `${row.mountString.toFixed(2).padStart(7)} → ${row.mountCompiled.toFixed(2).padStart(7)} ms   ` +
      `${kb(row.heldString)} → ${kb(row.heldCompiled)}`,
  );
}

console.log('  ' + '─'.repeat(82));
console.log('  Columns read "string renderer → compiled renderer".\n');

// Taken at the largest size rather than as a worst case across sizes. Mount
// cost is dominated by fixed per-instance overhead at small n, where a
// millisecond of scheduler noise moves the ratio by more than the mechanism
// does; the largest component is where the per-binding cost is actually visible.
const largest = results[results.length - 1];
const mountRatio = largest.mountCompiled / Math.max(largest.mountString, 1e-9);
const mountRange = results.map((r) => (r.mountCompiled / Math.max(r.mountString, 1e-9)).toFixed(2));
const heapRatio = results.reduce(
  (worst, r) => Math.max(worst, r.heldCompiled / Math.max(r.heldString, 1e-9)),
  0,
);
const updateRatio = results.reduce(
  (best, r) => Math.max(best, r.updateString / Math.max(r.updateCompiled, 1e-9)),
  0,
);

/**
 * Describes a ratio in the direction it actually went.
 * @param {number} ratio - compiled / string.
 * @param {string} noun - What is being described.
 * @returns {string} A sentence fragment.
 */
function describe(ratio, noun) {
  if (ratio > 1.02) {
    return `${noun} costs ${ratio.toFixed(2)}x as much`;
  }
  if (ratio < 0.98) {
    return `${noun} costs ${((1 - ratio) * 100).toFixed(0)}% less`;
  }
  return `${noun} is unchanged`;
}

console.log(
  '  What this run measured:\n' +
    `    · a single-binding update is up to ${updateRatio.toFixed(0)}x cheaper, and stops\n` +
    '      scaling with the size of the template\n' +
    `    · ${describe(mountRatio, `mount, at ${largest.n} bindings`)}` +
    ` (across sizes: ${mountRange.join(', ')})\n` +
    `    · ${describe(heapRatio, 'a mounted instance')} in retained heap\n`,
);

if (mountRatio <= 1.02) {
  console.log(
    '  Mount not being slower is worth a note, because the opposite was expected:\n' +
      '  one effect per binding is more allocation than one per component. It is\n' +
      '  paid for by what mount no longer does -- the skeleton is parsed once per\n' +
      '  component class rather than once per instance, and the first render is a\n' +
      '  clone plus direct writes rather than a serialise, a parse and a diff\n' +
      '  against an empty tree.\n',
  );
} else {
  console.log(
    '  Mount is the cost side of the trade: one reactive effect per binding\n' +
      '  instead of one per component. It happens once per instance, where an\n' +
      '  update happens whenever state changes.\n',
  );
}

cleanup();

const last = results[results.length - 1];
report({
  totalMs: results.reduce((sum, r) => sum + r.updateCompiled + r.updateString, 0),
  avgMs: last.updateCompiled,
  unit: 'update',
});

process.exit(0);
