/**
 * @file directivePipeline.test.js
 * @description The template desugaring passes run in the order the pipeline index states.
 *
 * The passes are order-dependent, and the order used to be implicit in the body
 * of `ComponentParser#extractTemplate`. It now lives in one list in
 * `lib/compiler/parser/directives/index.js`. This test pins that list, so a
 * reorder is a deliberate change to this file rather than a side effect, and
 * checks that the parser's own methods are still the same rewrites as the
 * modules they delegate to.
 */

import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import * as directives from '../../lib/compiler/parser/directives/index.js';

console.log('Testing the directive pipeline order...');

// --- the order is the one the compiler has always used -------------------
{
  assert.deepStrictEqual(
    directives.STRUCTURAL_DIRECTIVE_PASSES.map((pass) => pass.name),
    ['forLoops', 'suspense', 'errorBoundary', 'deadlock', 'defer', 'transitions', 'eventDelegation'],
    'the structural passes run in their documented order',
  );
  assert.ok(Object.isFrozen(directives.STRUCTURAL_DIRECTIVE_PASSES), 'the pipeline cannot be reordered at run time');
  console.log('  ✅ structural passes are listed in pipeline order');
}

// --- the runner is exactly the passes applied in sequence ----------------
{
  const template = [
    '<@for item in items key="item.id">',
    '  <@suspense><@fallback><p>{{ item }}</p></@fallback><span>{{ item.name }}</span></@suspense>',
    '</@for>',
    '<@errorBoundary><@fallback as="err"><p>{{ err.message }}</p></@fallback><p>ok</p></@errorBoundary>',
    '<@deadlock name="d" maxDepth="3"><p>guarded</p></@deadlock>',
    '<@defer when="visible"><p>{{ later }}</p></@defer>',
    '<transition name="fade"><div @click="go()">x</div></transition>',
  ].join('\n');
  const filePath = '/project/src/components/demo/demo.component.js';
  const context = { filePath, componentName: 'Demo', config: {}, customVoidTags: [] };

  let sequential = directives.processForLoops(template);
  sequential = directives.processSuspense(sequential);
  sequential = directives.processErrorBoundary(sequential);
  sequential = directives.processDeadlock(sequential, filePath, 'Demo', { config: {} });
  sequential = directives.processDefer(sequential);
  sequential = directives.processTransitionTags(sequential, filePath, { customVoidTags: [] });
  sequential = directives.processEventDelegation(sequential, filePath, { customVoidTags: [] });

  assert.strictEqual(directives.desugarStructuralDirectives(template, context), sequential);
  assert.ok(!/<@(for|suspense|errorBoundary|deadlock|defer)\b/.test(sequential), 'every structural directive is gone');
  console.log('  ✅ the runner applies each pass once, in order');
}

// --- ComponentParser's methods delegate to the modules -------------------
{
  const parser = new ComponentParser(new StyleProcessor());
  const slots = '<List><slot :item="row"></slot><template data-slot-props="row">{{ row.name }}</template></List>';
  assert.strictEqual(parser.processComponentTags(slots), directives.processComponentTags(slots));
  assert.strictEqual(parser.processSlotProps(slots), directives.processSlotProps(slots));
  assert.strictEqual(parser.escapeScopedSlots(slots), directives.escapeScopedSlots(slots));
  assert.strictEqual(
    parser.processBindDirectives('<input data-ax-bind="name">'),
    directives.processBindDirectives('<input data-ax-bind="name">'),
  );
  console.log('  ✅ the parser methods are the module passes');
}

console.log('✅ Directive pipeline tests passed!');
