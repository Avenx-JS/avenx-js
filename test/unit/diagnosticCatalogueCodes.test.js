/**
 * Every catalogue key must be a real AvenxErrorCodes value so avenx explain
 * cannot describe a different diagnostic than the compiler raises.
 */
import assert from 'assert';
import { DIAGNOSTIC_CATALOGUE } from '../../lib/core/diagnostics/catalogue.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

console.log('Testing diagnostic catalogue keys against AvenxErrorCodes...');

const known = new Set(Object.values(AvenxErrorCodes));

for (const code of Object.keys(DIAGNOSTIC_CATALOGUE)) {
  assert.ok(
    known.has(code),
    `catalogue key ${code} is not defined in AvenxErrorCodes`,
  );
}

assert.strictEqual(
  DIAGNOSTIC_CATALOGUE.AVX_C03.name,
  'CompilerDuplicateComponentName',
  'AVX_C03 must describe duplicate component names',
);

console.log(`  all ${Object.keys(DIAGNOSTIC_CATALOGUE).length} catalogue keys match AvenxErrorCodes`);
