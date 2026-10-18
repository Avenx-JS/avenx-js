/**
 * @file dynamicBindingClassification.js
 * @description Invariant 2: Dynamic bindings and transclusion slots result in non-static nodes.
 *
 * Catches regressions like the slot-classification bug in #200:
 * 1. Slots and slot ancestors are never marked static (data-ax-static="true").
 * 2. Elements with dynamic bindings ({{ expr }}, @click, :prop, data-ax-show, etc.)
 *    are never marked static.
 * 3. Ancestors containing dynamic descendants are never marked static.
 * 4. Elements marked static never nest inside another element marked static.
 */

import assert from 'node:assert';
import fc from 'fast-check';
import { templateTreeArbitrary } from '../generators/templateTree.js';
import { parseHTML } from '../../../lib/compiler/parser/htmlTree.js';
import ComponentParser from '../../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../../lib/compiler/StyleProcessor.js';

/**
 * Checks whether an HTMLNode or any of its descendants is dynamic.
 * @param {object} node
 * @returns {boolean}
 */
function isDynamicSubtree(node) {
  if (node.type === 'text') {
    return Boolean(node.content && (node.content.includes('{{') || node.content.includes('{%')));
  }

  if (node.type === 'element') {
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'slot' || tag === 'template' || tag.startsWith('@')) {
      return true;
    }

    for (const [key, val] of Object.entries(node.attrs || {})) {
      if (key.startsWith(':') || key.startsWith('@')) {
        return true;
      }
      if (key.startsWith('data-ax-') && key !== 'data-ax-static') {
        return true;
      }
      if (typeof val === 'string' && (val.includes('{{') || val.includes('{%'))) {
        return true;
      }
    }

    return (node.children || []).some(isDynamicSubtree);
  }

  return false;
}

/**
 * Recursively verifies static attributes on AST nodes.
 * @param {object[]} nodes
 * @param {boolean} parentIsStatic
 * @param {string} path
 */
function assertStaticSubtreeInvariants(nodes, parentIsStatic = false, path = 'root') {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const currentPath = `${path} > [${i}:${node.tagName || node.type}]`;

    if (node.type === 'element') {
      const isMarkedStatic = Boolean(
        node.attrs && (node.attrs['data-ax-static'] === 'true' || node.attrs['data-ax-static'] === true),
      );
      const isSlot = node.tagName.toLowerCase() === 'slot';

      // Invariant 2.1: A slot must never be marked static
      assert.ok(
        !(isSlot && isMarkedStatic),
        `${currentPath}: <slot> must never be marked with data-ax-static="true" (Issue #200 regression)`,
      );

      // Invariant 2.2: Static hoisting: an element marked static must not have an ancestor marked static
      assert.ok(
        !(isMarkedStatic && parentIsStatic),
        `${currentPath}: Element marked static inside already static parent (redundant/nested marking)`,
      );

      // Invariant 2.3: Elements containing dynamic bindings or slots must never be marked static
      const hasDynamic = isDynamicSubtree(node);
      assert.ok(
        !(isMarkedStatic && hasDynamic),
        `${currentPath}: Element with dynamic descendants or slot must not be marked static: ${node.tagName}`,
      );

      assertStaticSubtreeInvariants(node.children || [], isMarkedStatic || parentIsStatic, currentPath);
    }
  }
}

/**
 * Runs property-based tests for Invariant 2.
 * @param {number} [numRuns]
 */
export function testDynamicBindingClassification(numRuns = 200) {
  console.log(`🧪 Invariant 2: Dynamic bindings and slots are never static [${numRuns} runs]...`);
  const cp = new ComponentParser(new StyleProcessor());

  fc.assert(
    fc.property(templateTreeArbitrary(), ({ template }) => {
      const optimized = cp.optimizeStaticSubtrees(template);
      const parsed = parseHTML(optimized);
      assertStaticSubtreeInvariants(parsed, false);
      return true;
    }),
    { numRuns },
  );

  console.log('  ✅ Invariant 2: Dynamic bindings and slot transclusion invariants verified.');
}
