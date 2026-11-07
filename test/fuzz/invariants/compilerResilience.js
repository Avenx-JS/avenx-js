/**
 * @file compilerResilience.js
 * @description Invariant 1: The compiler never throws or crashes on valid template syntax.
 *
 * For any randomized-but-valid template syntax tree:
 * 1. parseHTML(template) succeeds without throwing and produces valid HTMLNode[] trees.
 * 2. Positional line and column metadata are valid positive numbers.
 * 3. optimizeStaticSubtrees(template) executes successfully and returns a non-empty string.
 * 4. buildTemplateIR(template) succeeds without throwing. It either produces built.ir,
 *    or refuses with a reason from RefusalReason. A refusal is a valid outcome only when
 *    the tree contains a construct the IR declines to model.
 * 5. lowerToProgram(built.ir) lowers to an executable render program without refusing.
 */

import assert from 'node:assert';
import fc from 'fast-check';
import { templateTreeArbitrary } from '../generators/templateTree.js';
import { parseHTML } from '../../../lib/compiler/parser/htmlTree.js';
import { buildTemplateIR } from '../../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../../lib/compiler/ir/lower.js';
import { RefusalReason } from '../../../lib/compiler/ir/nodes.js';
import ComponentParser from '../../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../../lib/compiler/StyleProcessor.js';

/**
 * Validates that all nodes in an HTMLNode tree have positive line and column numbers.
 * @param {object[]} nodes
 */
function assertValidPositions(nodes) {
  for (const node of nodes) {
    if (node.type === 'element' || node.type === 'comment' || node.type === 'text') {
      assert.ok(
        typeof node.line === 'number' && node.line >= 1,
        `Node ${node.tagName || node.type} must have line >= 1, got ${node.line}`,
      );
      assert.ok(
        typeof node.column === 'number' && node.column >= 1,
        `Node ${node.tagName || node.type} must have column >= 1, got ${node.column}`,
      );
    }
    if (node.children && node.children.length > 0) {
      assertValidPositions(node.children);
    }
  }
}

/**
 * Whether a generated tree contains a scoped slot: a slot carrying `:prop`
 * or `data-props-*` attributes. This is the only unmodelled construct the
 * generator emits, and the IR builder refuses it with SCOPED_SLOT.
 * @param {*} node - A generated tree node, array, or attribute value.
 * @returns {boolean}
 */
export function containsScopedSlot(node) {
  if (Array.isArray(node)) return node.some(containsScopedSlot);
  if (!node || typeof node !== 'object') return false;
  if (
    node.type === 'slot' &&
    Object.keys(node.attrs || {}).some((name) => name.startsWith(':') || name.startsWith('data-props-'))
  ) {
    return true;
  }
  return Object.values(node).some((value) => typeof value === 'object' && containsScopedSlot(value));
}

/**
 * Whether a refusal is a declared outcome for the generated tree. Only a
 * SCOPED_SLOT refusal of a tree that contains a scoped slot qualifies; any
 * other reason, or a refusal of a tree without the construct, is a defect.
 * @param {{reason: string, detail: string}} refusal
 * @param {object} root - The generated tree the template was rendered from.
 * @returns {boolean}
 */
export function isDeclaredRefusal(refusal, root) {
  return refusal.reason === RefusalReason.SCOPED_SLOT && containsScopedSlot(root);
}

/**
 * @param {{reason: string, detail: string}} refusal
 * @param {object} root
 * @param {string} template
 */
function assertDeclaredRefusal(refusal, root, template) {
  assert.ok(
    isDeclaredRefusal(refusal, root),
    `Unexpected refusal on valid syntax: ${JSON.stringify(refusal)}\nTemplate:\n${template}`,
  );
}

const cp = new ComponentParser(new StyleProcessor());

/**
 * Checks Invariant 1 for one generated template.
 * @param {string} template - The rendered template source.
 * @param {object} root - The generated tree the template was rendered from.
 */
export function assertResilientCase(template, root) {
  // 1. Parser pass
  const nodes = parseHTML(template);
  assert.ok(Array.isArray(nodes), 'parseHTML must return an array of nodes');
  assertValidPositions(nodes);

  // 2. Static subtree optimization pass
  const optimized = cp.optimizeStaticSubtrees(template);
  assert.strictEqual(typeof optimized, 'string', 'optimizeStaticSubtrees must return a string');
  assert.ok(optimized.length > 0, 'optimizeStaticSubtrees must not return empty string');

  // 3. IR Build pass
  const built = buildTemplateIR(optimized, {});
  if (built.refusal) {
    assertDeclaredRefusal(built.refusal, root, template);
    return;
  }
  assert.ok(built.ir, 'buildTemplateIR must return an ir root fragment');

  // 4. IR Lowering pass. The builder refuses every scoped slot before lowering
  // runs, so a lowering refusal here means a built IR the lowerer cannot handle.
  const lowered = lowerToProgram(built.ir, {});
  assert.strictEqual(lowered.refusal, null, `Unexpected lowering refusal: ${JSON.stringify(lowered.refusal)}`);
  assert.ok(lowered.program, 'lowerToProgram must return a valid program');
  assert.ok(Array.isArray(lowered.program.ops), 'program must contain ops array');
  assert.strictEqual(typeof lowered.program.html, 'string', 'program must contain html string');
}

/**
 * Runs property-based tests for Invariant 1.
 * @param {number} [numRuns]
 */
export function testCompilerResilience(numRuns = 200) {
  console.log(`🧪 Invariant 1: Compiler resilience (never throws on valid syntax) [${numRuns} runs]...`);

  fc.assert(
    fc.property(templateTreeArbitrary(), ({ template, root }) => {
      assertResilientCase(template, root);
      return true;
    }),
    { numRuns },
  );

  console.log('  ✅ Invariant 1: Compiler resilience verified across all random syntax trees.');
}
