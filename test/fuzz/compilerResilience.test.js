/**
 * @file compilerResilience.test.js
 * @description Regression tests for the resilience invariant's refusal handling.
 *
 * A refusal is how the IR reports a construct it does not model. The invariant
 * must accept a declared refusal for a tree that contains such a construct, and
 * must still fail when a refusal is returned for a tree that contains none.
 */

import assert from 'node:assert';
import fc from 'fast-check';
import * as compilerResilience from './invariants/compilerResilience.js';
import { testCompilerResilience } from './invariants/compilerResilience.js';

// Seed 475409916 is the nightly counterexample from issue #1670: a generated
// scoped slot (`<slot :item="item">`) that the IR declares as a refusal.
// On the base commit this run fails with "Unexpected refusal on valid syntax".
const savedGlobal = fc.readConfigureGlobal();
fc.configureGlobal({ ...savedGlobal, seed: 475409916 });
try {
  testCompilerResilience(100);
} finally {
  fc.configureGlobal(savedGlobal);
}

// The helper must exist and classify refusals as the invariant requires.
const { assertResilientCase, isDeclaredRefusal } = compilerResilience;
assert.strictEqual(typeof assertResilientCase, 'function', 'assertResilientCase must be exported');
assert.strictEqual(typeof isDeclaredRefusal, 'function', 'isDeclaredRefusal must be exported');

// Shape mirrors the generator's slotElementArb output for a slot with props.
const scopedSlotRoot = {
  type: 'element',
  tagName: 'div',
  children: [{ type: 'slot', name: null, attrs: { ':item': 'item' }, children: [] }],
};
const plainRoot = { type: 'element', tagName: 'div', children: [] };

// A declared SCOPED_SLOT refusal for a scoped-slot tree is accepted.
assert.ok(
  isDeclaredRefusal({ reason: 'a scoped slot outlet', detail: '<slot :item="item">' }, scopedSlotRoot),
  'a scoped-slot refusal of a scoped-slot tree must be declared',
);

// A refusal with a different reason on a scoped-slot tree is a defect.
assert.ok(
  !isDeclaredRefusal({ reason: 'a <@suspense> boundary', detail: '<@suspense>' }, scopedSlotRoot),
  'a non-scoped-slot refusal must not be accepted on a scoped-slot tree',
);

// A scoped-slot refusal of a tree without a scoped slot is a defect.
assert.ok(
  !isDeclaredRefusal({ reason: 'a scoped slot outlet', detail: '<slot :item="item">' }, plainRoot),
  'a scoped-slot refusal of a tree without a scoped slot must not be accepted',
);

// End to end: a suspense template refused on a tree with no scoped slot fails.
const suspenseTemplate = '<div><@suspense><p>Loading</p></@suspense></div>';
assert.throws(
  () => assertResilientCase(suspenseTemplate, plainRoot),
  /Unexpected refusal on valid syntax/,
);

console.log('✅ Compiler resilience refusal handling tests passed.');
