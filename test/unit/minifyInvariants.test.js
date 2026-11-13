/**
 * @file minifyInvariants.test.js
 * @description Fast unit-tier verification for bundle minifier safety invariants (PR gate).
 *
 * Runs the deterministic regression suite and a bounded iteration count of
 * property-based randomized program verification to ensure minifier safety
 * regressions are caught on every pull request (npm test / pnpm test:unit)
 * without waiting for the nightly fuzz tier.
 */

import { testMinifyProperties } from '../fuzz/invariants/minifyProperties.js';

console.log('🧪 Testing bundle minifier safety invariants (unit PR gate)...');

// Run regression suite and 50 bounded property iterations for fast PR validation
testMinifyProperties(50);

console.log('✅ Bundle minifier safety invariants unit test passed!\n');
