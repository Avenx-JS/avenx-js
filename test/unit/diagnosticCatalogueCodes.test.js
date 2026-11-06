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

const catalogueCodes = new Set(Object.keys(DIAGNOSTIC_CATALOGUE));

for (const code of known) {
  assert.ok(
    catalogueCodes.has(code),
    `AvenxErrorCodes value ${code} has no catalogue entry, so avenx explain cannot answer for it`,
  );

  const entry = DIAGNOSTIC_CATALOGUE[code];
  assert.ok(
    typeof entry.summary === 'string' && entry.summary.length > 0,
    `${code} catalogue entry has no summary`,
  );
  assert.ok(
    Array.isArray(entry.causes) && entry.causes.length >= 1,
    `${code} catalogue entry has no causes`,
  );
  assert.ok(
    Array.isArray(entry.remedies) && entry.remedies.length >= 1,
    `${code} catalogue entry has no remedies`,
  );
  assert.ok(
    typeof entry.docsUrl === 'string' && entry.docsUrl.length > 0,
    `${code} catalogue entry has no docsUrl`,
  );
}

console.log(`  all ${known.size} AvenxErrorCodes values resolve through the catalogue`);
