/**
 * @file compilerResilience.js
 * @description Invariant 1: The compiler never throws or crashes on valid template syntax.
 *
 * For any randomized-but-valid template syntax tree:
 * 1. parseHTML(template) succeeds without throwing and produces valid HTMLNode[] trees.
 * 2. Positional line and column metadata are valid positive numbers.
 * 3. optimizeStaticSubtrees(template) executes successfully and returns a non-empty string.
 * 4. buildTemplateIR(template) succeeds without throwing and produces built.ir !== null.
 * 5. lowerToProgram(built.ir) lowers to an executable render program without throwing.
 */

import assert from 'node:assert';
import fc from 'fast-check';
import { templateTreeArbitrary } from '../generators/templateTree.js';
import { parseHTML } from '../../../lib/compiler/parser/htmlTree.js';
import { buildTemplateIR } from '../../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../../lib/compiler/ir/lower.js';
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
 * Runs property-based tests for Invariant 1.
 * @param {number} [numRuns]
 */
export function testCompilerResilience(numRuns = 200) {
  console.log(`🧪 Invariant 1: Compiler resilience (never throws on valid syntax) [${numRuns} runs]...`);
  const cp = new ComponentParser(new StyleProcessor());

  fc.assert(
    fc.property(templateTreeArbitrary(), ({ template }) => {
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
      assert.strictEqual(
        built.refusal,
        null,
        `Unexpected refusal on valid syntax: ${JSON.stringify(built.refusal)}\nTemplate:\n${template}`,
      );
      assert.ok(built.ir, 'buildTemplateIR must return an ir root fragment');

      // 4. IR Lowering pass
      const lowered = lowerToProgram(built.ir, {});
      assert.strictEqual(lowered.refusal, null, `Unexpected lowering refusal: ${JSON.stringify(lowered.refusal)}`);
      assert.ok(lowered.program, 'lowerToProgram must return a valid program');
      assert.ok(Array.isArray(lowered.program.ops), 'program must contain ops array');
      assert.strictEqual(typeof lowered.program.html, 'string', 'program must contain html string');

      return true;
    }),
    { numRuns },
  );

  console.log('  ✅ Invariant 1: Compiler resilience verified across all random syntax trees.');
}
