/**
 * @file forNumericRange.test.js
 * @description A numeric-range `<@for n in 5>` must render `0` through `4` on
 * the compiled path.
 *
 * The compiled path's `normaliseList()` knew arrays, maps, sets and plain
 * objects, and rendered anything else as an empty list -- so a positive integer,
 * the numeric range the templates documentation promises, rendered nothing with
 * no diagnostic, while the fallback renderer's list manager accepted the same
 * source. A literal bound and a state key holding a number took the same path,
 * so both produced an empty list.
 *
 * The fix makes a positive integer a range of indices, matching the fallback
 * path; a non-integer, zero or negative bound still renders nothing.
 */
import assert from 'assert';
import { TemplateInstance } from '../../lib/core/renderer/program/TemplateInstance.js';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';

/**
 * Compiles a template and mounts it against a plain reactive state object.
 * The evaluate mock stands in for the runtime evaluator: it resolves dotted
 * paths against the loop locals first, then the reactive state, and evaluates
 * a bare numeric literal to its number.
 * @param {string} template - Template source.
 * @param {object} state - Initial state.
 * @returns {{host: Element, state: object}} The mount.
 */
function mount(template, state = {}) {
  const built = buildTemplateIR(template, {});
  assert.strictEqual(built.refusal, null, `template did not compile: ${built.refusal && built.refusal.detail}`);
  const lowered = lowerToProgram(built.ir, {});
  assert.strictEqual(lowered.refusal, null, `template did not lower: ${lowered.refusal && lowered.refusal.detail}`);

  const reactive = new StateFactory().create(state);
  const host = document.createElement('div');
  document.body.appendChild(host);

  const instance = new TemplateInstance(lowered.program, {
    program: lowered.program,
    evaluate: (index, locals) => {
      const source = lowered.expressions[index].trim();
      if (/^\d+$/.test(source)) return Number(source);
      const path = source.split('.');
      let value = locals && path[0] in locals ? locals : reactive;
      for (const part of path) {
        if (value === null || value === undefined) return undefined;
        value = value[part];
      }
      return value;
    },
    runStatement: () => {},
    jobId: 1,
  });

  host.appendChild(instance.create());
  return { host, state: reactive };
}

/**
 * Reads the rendered row texts.
 * @param {Element} host - The mount point.
 * @returns {string[]} One entry per rendered row.
 */
const rows = (host) => [...host.querySelectorAll('li')].map((li) => li.textContent.trim());

try {
  console.log('🧪 Testing numeric-range <@for> sources...');

  // 1. The documented example: a literal bound iterates 0 through N-1.
  {
    const { host } = mount('<ul><@for n in 5 key="n"><li>#{{ n }}</li></@for></ul>');
    assert.deepStrictEqual(
      rows(host),
      ['#0', '#1', '#2', '#3', '#4'],
      'a literal numeric bound renders 0 through N-1',
    );
    console.log('  ✅ a literal bound renders the range');
  }

  // 2. A state key holding a number behaves the same way, and re-renders when
  //    the number changes.
  {
    const { host, state } = mount('<ul><@for i in count key="i"><li>{{ i }}</li></@for></ul>', { count: 3 });
    assert.deepStrictEqual(rows(host), ['0', '1', '2'], 'a numeric state key renders the range');

    state.count = 2;
    await nextTick();
    assert.deepStrictEqual(rows(host), ['0', '1'], 'shrinking the bound removes the extra rows');

    state.count = 0;
    await nextTick();
    assert.deepStrictEqual(rows(host), [], 'a zero bound renders nothing');
    console.log('  ✅ a state key bound renders the range and keeps updating');
  }

  // 3. A bound that cannot be a range renders nothing, exactly as the fallback
  //    path has always done.
  {
    for (const bound of [-1, 2.5]) {
      const { host } = mount(`<ul><@for n in ${bound} key="n"><li>{{ n }}</li></@for></ul>`);
      assert.deepStrictEqual(rows(host), [], `a bound of ${bound} renders nothing`);
    }
    console.log('  ✅ non-range numbers render nothing on both bound shapes');
  }

  console.log('Numeric range tests passed!');
} catch (error) {
  console.error('Numeric range tests failed!');
  console.error(error);
  process.exit(1);
}
