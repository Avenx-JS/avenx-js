/**
 * Verifies the split diagnostic catalogue refuses duplicates, category
 * mismatches, and missing or obsolete codes while preserving all exports.
 */
import assert from 'assert';
import {
  DIAGNOSTIC_CATALOGUE,
  buildDiagnosticCatalogue,
  getDiagnostic,
  normalizeCode,
  suggestCodes,
} from '../../lib/core/diagnostics/catalogue.js';
import accessibility from '../../lib/core/diagnostics/catalogue/accessibility.js';
import compiler from '../../lib/core/diagnostics/catalogue/compiler.js';
import environment from '../../lib/core/diagnostics/catalogue/environment.js';
import routing from '../../lib/core/diagnostics/catalogue/routing.js';
import runtime from '../../lib/core/diagnostics/catalogue/runtime.js';
import styling from '../../lib/core/diagnostics/catalogue/styling.js';

console.log('Testing split diagnostic catalogue invariants...');

const categories = { compiler, runtime, styling, routing, environment, accessibility };
const totalSplitEntries = Object.values(categories).reduce(
  (sum, map) => sum + Object.keys(map).length,
  0,
);
assert.strictEqual(
  Object.keys(DIAGNOSTIC_CATALOGUE).length,
  totalSplitEntries,
  'merged catalogue must contain every entry from the category files',
);

assert.strictEqual(normalizeCode('c01'), 'AVX_C01');
assert.strictEqual(getDiagnostic('c01')?.code, 'AVX_C01');
assert.ok(suggestCodes('C0').includes('AVX_C01'));

assert.throws(
  () =>
    buildDiagnosticCatalogue(
      {
        compiler: { AVX_C01: compiler.AVX_C01 },
        runtime: { AVX_C01: { ...compiler.AVX_C01, category: 'runtime' } },
      },
      ['AVX_C01'],
    ),
  /Duplicate diagnostic code 'AVX_C01'/,
  'duplicate code across two category files must fail with a message naming the code',
);

assert.throws(
  () =>
    buildDiagnosticCatalogue(
      {
        runtime: { AVX_C01: compiler.AVX_C01 },
      },
      ['AVX_C01'],
    ),
  /AVX_C01.*category 'runtime'.*declares category 'compiler'/,
  'category mismatch must fail with a descriptive error',
);

assert.throws(
  () =>
    buildDiagnosticCatalogue(
      {
        compiler: { AVX_C01: compiler.AVX_C01 },
      },
      ['AVX_C01', 'AVX_C02'],
    ),
  /Missing diagnostic catalogue entry for code 'AVX_C02'/,
  'missing known code must fail',
);

assert.throws(
  () =>
    buildDiagnosticCatalogue(
      {
        compiler: { AVX_C01: compiler.AVX_C01, AVX_C02: compiler.AVX_C02 },
      },
      ['AVX_C01'],
    ),
  /Obsolete diagnostic catalogue entry 'AVX_C02'/,
  'obsolete catalogue entry must fail',
);

console.log('  ✅ split diagnostic catalogue invariants passed');
