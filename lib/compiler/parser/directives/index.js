/**
 * @file index.js
 * @description The template desugaring pipeline: every directive pass, and the order they run in.
 *
 * Each pass is a self-contained rewrite -- template string in, template string
 * out, plus diagnostics -- and none of them reads parser state beyond what its
 * parameters name. They are **order-dependent**, so the order is written down
 * here, in one place, rather than left implicit in the parser's control flow.
 *
 * The complete order a component template goes through is:
 *
 * | # | Pass               | Module               | Runs from                                 |
 * |---|--------------------|----------------------|-------------------------------------------|
 * | 1 | `bindDirectives`   | `bindDirectives.js`  | `extractTemplate`, after scoped styles    |
 * | 2 | `forLoops`         | `forLoops.js`        | `extractTemplate`, structural passes      |
 * | 3 | `suspense`         | `suspense.js`        | ″                                         |
 * | 4 | `errorBoundary`    | `errorBoundary.js`   | ″                                         |
 * | 5 | `deadlock`         | `deadlock.js`        | ″                                         |
 * | 6 | `defer`            | `defer.js`           | ″                                         |
 * | 7 | `transitions`      | `transitions.js`     | ″                                         |
 * | 8 | `eventDelegation`  | `eventDelegation.js` | ″                                         |
 * | 9 | `componentTags`    | `componentTags.js`   | `compileUnit`, after `extractTemplate`    |
 *
 * - **Pass 1** runs before template validation and before the semantic
 *   template is recorded, so the validator and the IR both see the expanded
 *   two-way binding but no structural rewrite.
 * - **Passes 2-8** are {@link STRUCTURAL_DIRECTIVE_PASSES}, run as one block by
 *   {@link desugarStructuralDirectives}. They run after the semantic template
 *   (`ComponentParser#lastSemanticTemplate`) has been recorded, so the IR is
 *   built from the template as the author wrote it. Blank lines are dropped
 *   from the result afterwards.
 * - **Pass 9** runs after the structural directives. On every level of its
 *   recursion it first runs `slotProps` (`slotProps.js`) and then
 *   `scopedSlots` (`scopedSlots.js`), so a scoped slot's interpolations are
 *   escaped before the template is handed on.
 *
 * Static-subtree marking (`../staticSubtrees.js`) is an optimisation over the
 * result, not a desugaring pass, and is not part of this list.
 *
 * Adding a directive: write it as a module here exporting a pure function,
 * then add it to the pipeline at the position its semantics require and to the
 * table above. Do not reorder existing passes as part of the same change.
 */
import { processForLoops } from './forLoops.js';
import { processSuspense } from './suspense.js';
import { processErrorBoundary } from './errorBoundary.js';
import { processDeadlock } from './deadlock.js';
import { processDefer } from './defer.js';
import { processTransitionTags } from './transitions.js';
import { processEventDelegation } from './eventDelegation.js';

export { processBindDirectives } from './bindDirectives.js';
export { processForLoops } from './forLoops.js';
export { processSuspense } from './suspense.js';
export { processErrorBoundary } from './errorBoundary.js';
export { processDeadlock } from './deadlock.js';
export { processDefer } from './defer.js';
export { processTransitionTags, processTransitionTagsInTree } from './transitions.js';
export { processEventDelegation } from './eventDelegation.js';
export { processComponentTags } from './componentTags.js';
export { processSlotProps } from './slotProps.js';
export { escapeScopedSlots } from './scopedSlots.js';

/**
 * What a structural pass may read about the unit being compiled.
 * @typedef {object} DirectiveContext
 * @property {string} filePath - The component file path.
 * @property {string} componentName - The component class name, for diagnostics.
 * @property {object|null} config - The parser's explicit project configuration, or
 *   null to resolve it from `filePath`.
 * @property {string[]} customVoidTags - Void tags configured on the parser itself.
 */

/**
 * A single structural pass.
 * @typedef {object} DirectivePass
 * @property {string} name - The pass's name, matching its module.
 * @property {function(string, DirectiveContext): string} run - The rewrite.
 */

/**
 * The structural directive passes, in the order they run (passes 2-8 above).
 * @type {ReadonlyArray<DirectivePass>}
 */
export const STRUCTURAL_DIRECTIVE_PASSES = Object.freeze([
  Object.freeze({ name: 'forLoops', run: (template) => processForLoops(template) }),
  Object.freeze({ name: 'suspense', run: (template) => processSuspense(template) }),
  Object.freeze({ name: 'errorBoundary', run: (template) => processErrorBoundary(template) }),
  Object.freeze({
    name: 'deadlock',
    run: (template, context) =>
      processDeadlock(template, context.filePath, context.componentName, { config: context.config }),
  }),
  Object.freeze({ name: 'defer', run: (template) => processDefer(template) }),
  Object.freeze({
    name: 'transitions',
    run: (template, context) =>
      processTransitionTags(template, context.filePath, { customVoidTags: context.customVoidTags }),
  }),
  Object.freeze({
    name: 'eventDelegation',
    run: (template, context) =>
      processEventDelegation(template, context.filePath, { customVoidTags: context.customVoidTags }),
  }),
]);

/**
 * Runs every structural directive pass over a template, in pipeline order.
 * @param {string} template - The semantic template.
 * @param {DirectiveContext} context - The unit being compiled.
 * @returns {string} The desugared template.
 */
export function desugarStructuralDirectives(template, context) {
  let result = template;
  for (const pass of STRUCTURAL_DIRECTIVE_PASSES) {
    result = pass.run(result, context);
  }
  return result;
}
