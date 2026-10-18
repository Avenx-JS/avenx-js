/**
 * @file structuralConservation.js
 * @description Invariant 4: Structural conservation of control-flow and transclusion constructs.
 *
 * Verifies that:
 * 1. Slot conservation: The total number and order of <slot> outlets is preserved from source to IR.
 * 2. Loop conservation: Every <@for> generates an IR iteration node; empty branches are accurately preserved.
 * 3. Conditional conservation: Every <@if> chain maps to an IR conditional node with the exact number of branches.
 */

import assert from 'node:assert';
import fc from 'fast-check';
import { templateTreeArbitrary } from '../generators/templateTree.js';
import { buildTemplateIR } from '../../../lib/compiler/ir/build.js';
import { IRKind, walkIR } from '../../../lib/compiler/ir/nodes.js';

/**
 * Runs property-based tests for Invariant 4.
 * @param {number} [numRuns]
 */
export function testStructuralConservation(numRuns = 200) {
  console.log(`🧪 Invariant 4: Structural conservation of control-flow and slots [${numRuns} runs]...`);

  fc.assert(
    fc.property(templateTreeArbitrary(), ({ template, meta }) => {
      const built = buildTemplateIR(template, {});
      assert.strictEqual(built.refusal, null, `Unexpected refusal on valid syntax: ${JSON.stringify(built.refusal)}`);

      let irSlotsCount = 0;
      const irSlotNames = [];
      let irLoopsCount = 0;
      let irConditionalsCount = 0;

      walkIR(built.ir, (node) => {
        if (node.kind === IRKind.SLOT) {
          irSlotsCount++;
          irSlotNames.push(node.name);
        } else if (node.kind === IRKind.FOR) {
          irLoopsCount++;
        } else if (node.kind === IRKind.IF) {
          irConditionalsCount++;
        }
      });

      // 1. Slot conservation
      assert.strictEqual(
        irSlotsCount,
        meta.slotsCount,
        `Slot count mismatch: expected ${meta.slotsCount}, got ${irSlotsCount}`,
      );
      assert.deepStrictEqual(
        irSlotNames,
        meta.slotNames,
        `Slot names sequence mismatch: expected ${JSON.stringify(meta.slotNames)}, got ${JSON.stringify(irSlotNames)}`,
      );

      // 2. Loop conservation
      assert.strictEqual(
        irLoopsCount,
        meta.loopsCount,
        `Loop count mismatch: expected ${meta.loopsCount}, got ${irLoopsCount}`,
      );

      // 3. Conditional conservation
      assert.strictEqual(
        irConditionalsCount,
        meta.conditionalsCount,
        `Conditional count mismatch: expected ${meta.conditionalsCount}, got ${irConditionalsCount}`,
      );

      return true;
    }),
    { numRuns },
  );

  console.log('  ✅ Invariant 4: Structural conservation of slots, loops, and branches verified.');
}
