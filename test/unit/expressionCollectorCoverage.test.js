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
import { processDefer } from '../../lib/compiler/parser/directives/defer.js';
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
  const quotedDynamic = parser.processComponentTags(
    '<Component :is=\'{{ flag ? "Red" : "Blue" }}\' :label=\'flag ? "Yes" : "No"\' />',
  );
  const transition = processTransitionTags(
    '<transition name="fade"><div data-ax-show="open">panel</div></transition>',
    'Demo.component.js',
  );
  const customDirective = '<div data-ax-tooltip="hintText" data-ax-show="visible">tip</div>';

  const cases = [
    { label: '<Component :is>', template: dynamic, expression: 'currentView' },
    { label: '<Component :is> quoted ternary', template: quotedDynamic, expression: 'flag ? "Red" : "Blue"' },
    { label: '<Component :is> quoted prop', template: quotedDynamic, expression: 'flag ? "Yes" : "No"' },
    { label: '<transition name>', template: transition, expression: "'fade'" },
    { label: 'custom data-ax-* directive', template: customDirective, expression: 'hintText' },
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

  // Non-expression <@defer> triggers must not be collected as JS expressions,
  // or a fallback template carrying them would fail production builds with AVX_C27.
  const deferTemplate = processDefer(
    '<@defer when="500ms"><p>a</p></@defer><@defer when="visible; interaction"><p>b</p></@defer>',
  );
  const deferCollected = collectExpressions({ template: deferTemplate });
  assert.ok(!deferCollected.expressions.includes('500ms'), 'duration trigger must not be collected');
  assert.ok(
    !deferCollected.expressions.includes('visible; interaction'),
    'multi-trigger subscription must not be collected',
  );
  const deferTable = buildExpressionTable('Demo', deferCollected);
  assert.deepStrictEqual(deferTable.gaps, [], 'subscription defer triggers must not produce expression gaps');
  console.log('  ✅ non-expression <@defer> subscription triggers are skipped without false AVX_C27/AVX_W48');

  console.log('Expression collector coverage tests passed!');
} catch (error) {
  console.error('Expression collector coverage tests failed!');
  console.error(error);
  process.exit(1);
}
