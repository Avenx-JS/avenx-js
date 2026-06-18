/**
 * Avenx Core Module
 * @module lib/core/index
 */

export { AvenxComponent } from './runtime/AvenxComponent.js';
export { AvenxApp } from './runtime/AvenxApp.js';
export { AvenxBridge } from './runtime/AvenxBridge.js';
export { StateFactory } from './reactive/createState.js';
export { ComputedRegistry } from './reactive/createComputed.js';
export { ProxyHandlerFactory } from './reactive/proxyHandler.js';
export { TemplateRenderer } from './renderer/renderTemplate.js';
export { DomPatcher } from './renderer/domPatch.js';
export { ListManager } from './renderer/listManager.js';
export { HtmlDiff } from './renderer/diff.js';
export { EventBinder } from './events/bindEvents.js';
export { EventExecutor } from './events/eventExecutor.js';
export { HtmlEscaper } from './security/escapeHtml.js';
export { Sanitizer } from './security/sanitize.js';
export { DynamicEvaluator } from './security/evaluator.js';
export { LifecycleManager } from './runtime/lifecycle.js';
