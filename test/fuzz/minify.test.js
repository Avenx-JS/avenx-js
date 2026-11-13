/**
 * @file minify.test.js
 * @description Property-based / fuzz test suite for Avenx bundle minifier safety invariants.
 *
 * Implements Issue #1656:
 * - Tests core minifier invariants:
 *   1. Line count preservation: minify(src).split('\n').length === src.split('\n').length.
 *   2. Semantic equivalence: Both src and minify(src) parse with Acorn, and evaluation matches.
 *   3. Literal value preservation: Every string Literal and TemplateElement in AST is byte-identical.
 *   4. Idempotence: minify(minify(src)) === minify(src).
 *   5. Non-increasing length: minify(src).length <= src.length.
 *   6. Complete comment removal: Acorn parser reports 0 comments in minified output.
 *
 * Configurable iterations via FAST_CHECK_NUM_RUNS environment variable:
 * - Local / default: 100 iterations.
 * - Nightly / CI: 1,000 iterations.
 */

import { testMinifyProperties } from './invariants/minifyProperties.js';

const numRuns = process.env.FAST_CHECK_NUM_RUNS
  ? parseInt(process.env.FAST_CHECK_NUM_RUNS, 10)
  : process.env.CI_FUZZ
    ? 1000
    : 100;

console.log('====================================================');
console.log(`🎲 Running Avenx Bundle Minifier Fuzz Suite (${numRuns} iterations)`);
console.log('====================================================');

testMinifyProperties(numRuns);

console.log('====================================================');
console.log('🎉 All minifier property-based invariants passed successfully!');
console.log('====================================================\n');
