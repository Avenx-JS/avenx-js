import assert from 'assert';
import * as runtime from '../../lib/core/index.js';
import * as avenxError from '../../lib/core/runtime/AvenxError.js';

/**
 * The §4b and §4c documentation imports these four names from `avenx-core/runtime`.
 * They live in lib/core/runtime/AvenxError.js, so the runtime entry point must re-export them.
 */
const DOCUMENTED_EXPORTS = ['formatMessage', 'AvenxErrorCodes', 'AvenxErrorMessages', 'AvenxError'];

/**
 * Every documented error symbol must be reachable from the runtime entry point.
 */
function testErrorSymbolsAreExported() {
  console.log('🧪 Testing error diagnostics are exported from avenx-core/runtime...');

  const missing = DOCUMENTED_EXPORTS.filter((name) => !(name in runtime));
  assert.deepStrictEqual(
    missing,
    [],
    `these symbols are not exported from lib/core/index.js: ${missing.join(', ')}`,
  );

  for (const name of DOCUMENTED_EXPORTS) {
    assert.strictEqual(runtime[name], avenxError[name], `${name} must be the AvenxError.js binding, not a copy`);
  }

  console.log('  ✅ formatMessage, AvenxErrorCodes, AvenxErrorMessages and AvenxError are exported.');
}

try {
  testErrorSymbolsAreExported();
  console.log('🎉 Runtime error export tests passed successfully!');
} catch (err) {
  console.error('❌ Runtime error export test failed:', err);
  process.exit(1);
}
