/**
 * @file roundTripProperties.js
 * @description Invariant 3: Parse and serialize round-trip idempotency and structural equivalence.
 *
 * Asserts the compiler's guarantee:
 * 1. serializeHTML(parseHTML(template)) stabilizes immediately (idempotent after one round-trip).
 * 2. parseHTML(serializeHTML(tree)) produces an isomorphic AST to tree (same tags, attributes, text, children).
 * 3. Directive headers (<@for>, <@if>) preserve their verbatim expression sources across serialize/parse passes.
 */

import assert from 'node:assert';
import fc from 'fast-check';
import { templateTreeArbitrary } from '../generators/templateTree.js';
import { parseHTML, serializeHTML } from '../../../lib/compiler/parser/htmlTree.js';

/**
 * Asserts structural isomorphism between two parsed HTMLNode trees.
 * @param {object[]} tree1
 * @param {object[]} tree2
 * @param {string} [path]
 */
function assertIsomorphicTrees(tree1, tree2, path = 'root') {
  assert.strictEqual(tree1.length, tree2.length, `${path}: Child count mismatch: ${tree1.length} vs ${tree2.length}`);

  for (let i = 0; i < tree1.length; i++) {
    const n1 = tree1[i];
    const n2 = tree2[i];
    const currentPath = `${path} > [${i}:${n1.tagName || n1.type}]`;

    assert.strictEqual(n1.type, n2.type, `${currentPath}: Node type mismatch`);

    if (n1.type === 'element') {
      assert.strictEqual(n1.tagName.toLowerCase(), n2.tagName.toLowerCase(), `${currentPath}: Tag name mismatch`);

      // Verify attributes
      const keys1 = Object.keys(n1.attrs || {}).sort();
      const keys2 = Object.keys(n2.attrs || {}).sort();
      assert.deepStrictEqual(keys1, keys2, `${currentPath}: Attribute keys mismatch`);

      for (const key of keys1) {
        assert.strictEqual(
          String(n1.attrs[key]),
          String(n2.attrs[key]),
          `${currentPath}: Attribute '${key}' value mismatch`,
        );
      }

      // If directive tag, rawAttrs header should match
      if (n1.tagName.startsWith('@')) {
        assert.strictEqual(
          (n1.rawAttrs || '').trim(),
          (n2.rawAttrs || '').trim(),
          `${currentPath}: Directive rawAttrs mismatch`,
        );
      }

      assertIsomorphicTrees(n1.children || [], n2.children || [], currentPath);
    } else if (n1.type === 'text') {
      assert.strictEqual(n1.content, n2.content, `${currentPath}: Text node content mismatch`);
    } else if (n1.type === 'comment') {
      assert.strictEqual(n1.content.trim(), n2.content.trim(), `${currentPath}: Comment content mismatch`);
    }
  }
}

/**
 * Runs property-based tests for Invariant 3.
 * @param {number} [numRuns]
 */
export function testRoundTripProperties(numRuns = 200) {
  console.log(`🧪 Invariant 3: Parse / serialize round-trip properties [${numRuns} runs]...`);

  fc.assert(
    fc.property(templateTreeArbitrary(), ({ template }) => {
      const tree1 = parseHTML(template);
      const serialized1 = serializeHTML(tree1);

      const tree2 = parseHTML(serialized1);
      const serialized2 = serializeHTML(tree2);

      // Invariant 3.1: Idempotency (serializeHTML(parseHTML(s)) === s)
      assert.strictEqual(
        serialized1,
        serialized2,
        `Serialization idempotency failed.\nRun 1: ${serialized1}\nRun 2: ${serialized2}`,
      );

      // Invariant 3.2: AST Isomorphism
      assertIsomorphicTrees(tree1, tree2);

      return true;
    }),
    { numRuns },
  );

  console.log('  ✅ Invariant 3: Round-trip idempotency and AST isomorphism verified.');
}
