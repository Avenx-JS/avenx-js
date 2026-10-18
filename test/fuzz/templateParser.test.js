/**
 * @file templateParser.test.js
 * @description Property-based / fuzz test suite for Avenx template parser and compiler invariants.
 *
 * Implements Issue #1319:
 * - Generates randomized-but-valid template structures (combinations of <@for>, <@empty>,
 *   slots, conditionals, dynamic bindings, nesting depth).
 * - Tests core compiler invariants:
 *   1. Compiler resilience: Never throws on valid syntax.
 *   2. Dynamic binding & slot classification: Dynamic bindings/slots are never marked static.
 *   3. Round-trip properties: Parse/serialize idempotency and structural AST isomorphism.
 *   4. Structural conservation: Slot, loop, and conditional counts & hierarchy are preserved.
 *
 * Configurable iterations via FAST_CHECK_NUM_RUNS environment variable:
 * - Local / default: 100 iterations per invariant.
 * - Nightly / CI: 500-1000 iterations per invariant.
 */

import { testCompilerResilience } from './invariants/compilerResilience.js';
import { testDynamicBindingClassification } from './invariants/dynamicBindingClassification.js';
import { testRoundTripProperties } from './invariants/roundTripProperties.js';
import { testStructuralConservation } from './invariants/structuralConservation.js';

const numRuns = process.env.FAST_CHECK_NUM_RUNS
  ? parseInt(process.env.FAST_CHECK_NUM_RUNS, 10)
  : process.env.CI_FUZZ
    ? 1000
    : 100;

console.log('====================================================');
console.log(`🎲 Running Avenx Template Parser Fuzz Suite (${numRuns} iterations/prop)`);
console.log('====================================================');

testCompilerResilience(numRuns);
testDynamicBindingClassification(numRuns);
testRoundTripProperties(numRuns);
testStructuralConservation(numRuns);

console.log('====================================================');
console.log('🎉 All property-based fuzz invariants passed successfully!');
console.log('====================================================\n');
