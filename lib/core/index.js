/**
 * Avenx Core Module
 * @module lib/core/index
 */

export { AvenxComponent } from './runtime/AvenxComponent.js';
export { AvenxApp } from './runtime/AvenxApp.js';
export { AvenxBridge } from './runtime/AvenxBridge.js';
export { bridge, isBridge, defineBridgeName, IS_BRIDGE, suggestName } from './runtime/bridge.js';
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
export { AvenxWatcher, watchEffect, setDebugReactivity, isDebugReactivityEnabled, getActiveCausationTrace, clearCausationTrace } from './reactive/watcher.js';
export { AvenxMock, AvenxSandbox, mountTestComponent, fireEvent, flushPromises } from './runtime/AvenxMock.js';
export { AvenxPage } from './runtime/AvenxPage.js';
export { VirtualList } from './runtime/VirtualList.js';
export { initInspector } from './tooling/inspect.js';
export {
  componentNameFromFile,
  findRegisteredComponents,
  extractLintableTemplate,
  findInvalidComponentTags,
  findProjectRoot,
} from './tooling/componentTagNaming.js';
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


