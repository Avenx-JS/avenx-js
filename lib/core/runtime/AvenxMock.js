/**
 * Re-export barrel for legacy `lib/core/runtime/AvenxMock.js` imports.
 * Implementations now live in `lib/core/testing/{mock,sandbox,mountComponent}.js`.
 */
export { AvenxMock } from '../testing/mock.js';
export { AvenxSandbox } from '../testing/sandbox.js';
export { mountTestComponent, fireEvent, flushPromises } from '../testing/mountComponent.js';
export { assertSnapshot } from '../testing/snapshot.js';
