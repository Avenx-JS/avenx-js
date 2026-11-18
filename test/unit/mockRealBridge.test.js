import assert from 'assert';
import { AvenxMock } from '../../lib/core/testing.js';
import { bridge } from '../../lib/core/runtime/bridge.js';

console.log('🧪 Testing AvenxMock.createMockBridge with a real bridge...');

(async () => {
  try {
    const AuthBridge = bridge({
      state: { isLoggedIn: false, user: '' },
      login(email) {
        this.user = email;
        this.isLoggedIn = true;
      },
    });

    // The documented example: seed initial data, then call an action.
    const mockAuth = AvenxMock.createMockBridge(AuthBridge, { isLoggedIn: false });
    mockAuth.login('user@example.com');
    assert.deepStrictEqual(mockAuth.$calls, [{ method: 'login', args: ['user@example.com'] }]);

    // Seeded keys are consistent with what the action then writes.
    assert.strictEqual(mockAuth.isLoggedIn, true);
    assert.strictEqual(mockAuth.user, 'user@example.com');

    // Actions write the mock's own state, not the real bridge's.
    assert.strictEqual(AuthBridge.isLoggedIn, false);
    assert.strictEqual(AuthBridge.user, '');

    // Without initial data, actions must still be reachable.
    const plain = AvenxMock.createMockBridge(AuthBridge);
    assert.strictEqual(typeof plain.login, 'function');
    plain.login('a@b.c');
    assert.strictEqual(plain.$calls.length, 1);
    assert.strictEqual(plain.isLoggedIn, true);

    // A second mock from the same bridge does not see the first mock's state.
    assert.strictEqual(mockAuth.user, 'user@example.com');
    assert.strictEqual(plain.user, 'a@b.c');
    assert.strictEqual(mockAuth.$calls.length, 1);

    // Direct assignment on a mock is recorded as a state change.
    const direct = AvenxMock.createMockBridge(AuthBridge);
    direct.isLoggedIn = true;
    assert.deepStrictEqual(direct.$stateChanges, [{ prop: 'isLoggedIn', value: true }]);
    assert.strictEqual(direct.isLoggedIn, true);

    console.log('✅ createMockBridge with a real bridge tests passed!');
  } catch (error) {
    console.error('❌ createMockBridge with a real bridge tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
