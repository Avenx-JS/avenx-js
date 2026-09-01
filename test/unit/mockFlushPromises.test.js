import assert from 'assert';
import { AvenxMock, flushPromises } from '../../lib/core/testing.js';

console.log('🧪 Testing flushPromises helper...');

(async () => {
  try {
    let settled = false;
    Promise.resolve().then(() => {
      settled = true;
    });

    assert.strictEqual(settled, false, 'microtask should not have run yet');
    await flushPromises();
    assert.strictEqual(settled, true, 'flushPromises should allow pending Promise to settle');

    let viaStatic = false;
    Promise.resolve().then(() => {
      viaStatic = true;
    });
    await AvenxMock.flushPromises();
    assert.strictEqual(viaStatic, true, 'AvenxMock.flushPromises should settle pending Promises');

    console.log('✅ flushPromises tests passed!');
  } catch (error) {
    console.error('❌ flushPromises tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
