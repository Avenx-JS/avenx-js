/**
 * Avenx testing utilities.
 *
 * These helpers drive components outside a browser: a DOM mock, a component
 * sandbox and the async flush helpers a test needs. They are deliberately kept
 * out of `lib/core/index.js` so that nothing here can reach a production
 * bundle — the runtime entry is the only module the browser build sees.
 * @module lib/core/testing
 */

export { AvenxMock, AvenxSandbox, mountTestComponent, fireEvent, flushPromises } from './runtime/AvenxMock.js';

/**
 * Trace recording and replay.
 *
 * These live behind `avenx-core/testing` rather than the runtime barrel for the
 * same reason the DOM mock does: the replay engine and its reporting exist to
 * serve tests, and an application bundle must not carry them.
 */
export { replay, formatProblems } from './trace/replay.js';
export { startRecording, stopRecording, activeRecorder, TraceRecorder } from './trace/recorder.js';
export { installRecordingGlobals, clearGlobalOverrides } from './trace/globals.js';
export { findContractViolations } from './trace/contracts.js';
export { TRACE_VERSION, Determinism, validateTrace } from './trace/schema.js';
