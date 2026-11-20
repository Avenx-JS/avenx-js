// @avenx-no-dev-runtime
//
// The marker above is read by test/run-tests.js, which runs this file without
// the expression interpreter, as a production bundle runs. It sits in a line
// comment because it is not a JSDoc tag.

/**
 * @file expressionCollectorCoverage.test.js
 * @description Constructs whose expression the runtime evaluates off the DOM
 * must reach the compiled expression table.
 *
 * The collector reads the finished template and takes every expression-bearing
 * attribute it knows about. One it does not know about fails in a way no build
 * reports: the expression is not in the table, so it is not a gap, so there is
 * no AVX_W48 -- and a development build interprets it and renders, while a
 * production bundle, which has no interpreter, throws AVX_R32 and the runtime
 * swallows it into a warning. Two constructs did exactly this until the E2E
 * construct-parity spec drove them against a production bundle:
 *
 * - `<Component :is="{{ name }}">`, which compiles to `data-avenx-comp-dynamic`.
 *   The mount point stayed empty.
 * - `<transition name="fade">`, which compiles to `data-ax-transition="'fade'"`.
 *   The patcher fell back to the raw text, so the classes came out as
 *   `'fade'-enter-active`.
 *
 * This file runs bare, so the last assertion -- that the compiled table
 * evaluates each one with no interpreter present -- is the production
 * arrangement, not a simulation of it.
 */
import assert from 'assert';
import { collectExpressions } from '../../lib/compiler/codegen/collect.js';
import { buildExpressionTable } from '../../lib/compiler/codegen/table.js';
import { processTransitionTags } from '../../lib/compiler/parser/directives/transitions.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { hasExpressionInterpreter } from '../../lib/core/expression/fallback.js';

try {
  console.log('🧪 Testing that DOM-read construct expressions reach the compiled table...');

  assert.strictEqual(
    hasExpressionInterpreter(),
    false,
    'this file declares @avenx-no-dev-runtime and must run without the interpreter installed',
  );

  const parser = new ComponentParser(new StyleProcessor());

  // The finished templates, produced by the same passes the compiler runs, so
  // a change to what a construct compiles to is a change this file sees.
  const dynamic = parser.processComponentTags('<Component :is="{{ currentView }}" />');
  const transition = processTransitionTags(
    '<transition name="fade"><div data-ax-show="open">panel</div></transition>',
    'Demo.component.js',
  );

  const cases = [
    { label: '<Component :is>', template: dynamic, expression: 'currentView' },
    { label: '<transition name>', template: transition, expression: "'fade'" },
  ];

  for (const { label, template, expression } of cases) {
    const collected = collectExpressions({ template });
    assert.ok(
      collected.expressions.includes(expression),
      `${label}: ${JSON.stringify(expression)} must be collected from ${template}; got ${JSON.stringify(collected.expressions)}`,
    );

    const table = buildExpressionTable('Demo', collected);
    assert.deepStrictEqual(table.gaps, [], `${label}: the expression compiles, so it is not a gap`);
    assert.ok(
      table.source.includes(JSON.stringify(expression)),
      `${label}: the compiled table must be keyed by ${JSON.stringify(expression)}`,
    );
    console.log(`  ✅ ${label} is compiled rather than left to an interpreter production does not have`);
  }

  console.log('Expression collector coverage tests passed!');
} catch (error) {
  console.error('Expression collector coverage tests failed!');
  console.error(error);
  process.exit(1);
}
