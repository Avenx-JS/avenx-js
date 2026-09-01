/**
 * Avenx browser runtime.
 *
 * This is the only module the browser build bundles, so its import graph
 * defines what ships to users. Two neighbours are deliberately not re-exported
 * here, because doing so would pull them into every application bundle:
 *
 * - `./testing.js`     — the DOM mock and component sandbox (`avenx-core/testing`)
 * - `./tooling/`       — the lint and build helpers, which import `fs` and
 *                        `path` (`avenx-core/tooling`)
 *
 * Keep this file free of anything that is not needed at runtime in a browser.
 * @module lib/core/index
 */

export { AvenxComponent } from './runtime/AvenxComponent.js';
export { AvenxApp } from './runtime/AvenxApp.js';
export { bridge, isBridge, defineBridgeName } from './runtime/bridge.js';
export { atomic, isAtomic, atomicOptions } from './runtime/atomic.js';
export { AvenxGuard } from './runtime/AvenxGuard.js';
export { AvenxRouter } from './runtime/AvenxRouter.js';
export { StateFactory, toRaw, isReactive, markRaw } from './reactive/createState.js';
export { ComputedRegistry } from './reactive/createComputed.js';
export { ProxyHandlerFactory } from './reactive/proxyHandler.js';
export { TemplateRenderer } from './renderer/renderTemplate.js';
export { DomPatcher } from './renderer/domPatch.js';
export { ListManager } from './renderer/listManager.js';
export { DeferManager } from './renderer/deferManager.js';
export { DeadlockManager } from './renderer/deadlockManager.js';
export { HtmlDiff } from './renderer/diff.js';
export { EventBinder } from './events/bindEvents.js';
export { EventExecutor } from './events/eventExecutor.js';
export { HtmlEscaper, SafeHtml, html, unescapeHtml } from './security/escapeHtml.js';
export { Sanitizer } from './security/sanitize.js';
export { DynamicEvaluator } from './security/evaluator.js';
export { LifecycleManager } from './runtime/lifecycle.js';
export { StyleMountManager, styleMountManager } from './runtime/StyleMountManager.js';
export { AvenxLogger, logger, LogLevels, defaultFormatter, consoleTransport } from './runtime/AvenxLogger.js';
export { DisposalScope, getScope, runInScope, onScopeDispose } from './reactive/scope.js';
export { journal, JournalFrame, ConflictPolicy, DEFAULT_MAX_SNAPSHOT_ITEMS } from './reactive/journal.js';
export { AvenxWatcher, watchEffect, setDebugReactivity, isDebugReactivityEnabled, getActiveCausationTrace, clearCausationTrace } from './reactive/watcher.js';
export { AvenxPage } from './runtime/AvenxPage.js';
export { VirtualList } from './runtime/VirtualList.js';
export { initInspector } from './tooling/inspect.js';
export { RouteMatcher } from './runtime/RouteMatcher.js';
export * from './runtime/navigation/index.js';
export { LruCache } from './utils/LruCache.js';
export { parseValidationRules, validateValue, getFieldName, updateValidationState } from './validation/validator.js';
export {
  queueJob,
  queueFlushCallback,
  nextTick,
  setSchedulerMaxFlushCount,
  getSchedulerMaxFlushCount,
  onSchedulerDeadlock,
  resetScheduler,
} from './reactive/scheduler.js';
export { profile, getComponentProfilingInfo } from './utils/profiler.js';

/**
 * Trace recording.
 *
 * Only the recording side ships in the runtime, because that is the half that
 * has to run in a real browser next to a real bug. Replay, the causal viewer
 * and test generation live behind `avenx-core/testing` and the CLI, where an
 * application bundle cannot reach them.
 *
 * Nothing here runs unless `installTraceRecorder()` is called, which the dev
 * server only does for `avenx serve --trace`.
 */
export { installTraceRecorder, uninstallTraceRecorder, isRecording, TRACE_ENDPOINT } from './trace/devtools.js';
export { startRecording, stopRecording, activeRecorder } from './trace/recorder.js';


