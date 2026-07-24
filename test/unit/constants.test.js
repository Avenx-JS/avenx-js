import assert from 'assert';
import { isBooleanAttribute } from '../../lib/core/renderer/constants.js';

try {
  console.log('🧪 Testing isBooleanAttribute helper function...');

  // Standard boolean attributes (case-insensitive)
  assert.strictEqual(isBooleanAttribute('disabled'), true, 'disabled should be true');
  assert.strictEqual(isBooleanAttribute('DISABLED'), true, 'case-insensitive DISABLED should be true');
  assert.strictEqual(isBooleanAttribute('checked'), true, 'checked should be true');
  assert.strictEqual(isBooleanAttribute('required'), true, 'required should be true');
  assert.strictEqual(isBooleanAttribute('readonly'), true, 'readonly should be true');
  assert.strictEqual(isBooleanAttribute('hidden'), true, 'hidden should be true');
  assert.strictEqual(isBooleanAttribute('selected'), true, 'selected should be true');
  assert.strictEqual(isBooleanAttribute('async'), true, 'async should be true');
  assert.strictEqual(isBooleanAttribute('defer'), true, 'defer should be true');
  assert.strictEqual(isBooleanAttribute('multiple'), true, 'multiple should be true');
  assert.strictEqual(isBooleanAttribute('novalidate'), true, 'novalidate should be true');
  assert.strictEqual(isBooleanAttribute('autofocus'), true, 'autofocus should be true');

  // Non-boolean attributes
  assert.strictEqual(isBooleanAttribute('value'), false, 'value should be false');
  assert.strictEqual(isBooleanAttribute('id'), false, 'id should be false');
  assert.strictEqual(isBooleanAttribute('class'), false, 'class should be false');
  assert.strictEqual(isBooleanAttribute('src'), false, 'src should be false');
  assert.strictEqual(isBooleanAttribute('href'), false, 'href should be false');

  // Edge cases
  assert.strictEqual(isBooleanAttribute(''), false, 'empty string should be false');
  assert.strictEqual(isBooleanAttribute(null), false, 'null should be false');
  assert.strictEqual(isBooleanAttribute(undefined), false, 'undefined should be false');
  assert.strictEqual(isBooleanAttribute(123), false, 'number should be false');

  console.log('  ✅ isBooleanAttribute tests passed!');
} catch (error) {
  console.error('❌ isBooleanAttribute tests failed!');
  console.error(error);
  process.exit(1);
}
