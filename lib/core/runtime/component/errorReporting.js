import { DeadlockManager } from '../../renderer/deadlockManager.js';
import { logger } from '../AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../AvenxError.js';

/**
 * Creates the lazy deadlock manager, tolerating a headless string renderer.
 * @param {object} evaluator - Component evaluator.
 * @param {Function} getRenderer - Lazy renderer lookup.
 * @param {object} eventBinder - Component event binder.
 * @param {string} name - Component diagnostic name.
 * @returns {DeadlockManager}
 */
export function createDeadlockManager(evaluator, getRenderer, eventBinder, name) {
  let renderer = null;
  try {
    renderer = getRenderer();
  } catch {
    // String renderer may not be installed in headless environments.
  }
  return new DeadlockManager(evaluator, renderer, eventBinder, name);
}

/**
 * Trips the first matching deadlock boundary.
 * @param {Element|null} element - Component host.
 * @param {string|null} boundaryName - Optional boundary name.
 * @param {object} error - Failure payload.
 * @param {Function} getManager - Lazy manager lookup.
 * @param {Function} createScope - Current scope factory.
 */
export function tripDeadlockBoundary(element, boundaryName, error, getManager, createScope) {
  if (!element) return;
  const boundaries = getManager().findBoundaries(element);
  for (const b of boundaries) {
    const name = b.getAttribute('data-ax-deadlock-name');
    if (!boundaryName || name === boundaryName) {
      getManager().trip(b, error, createScope());
      return;
    }
  }
}

/**
 * Resets the first matching deadlock boundary.
 * @param {Element|null} element - Component host.
 * @param {string|null} boundaryName - Optional boundary name.
 * @param {Function} getManager - Lazy manager lookup.
 */
export function resetDeadlockBoundary(element, boundaryName, getManager) {
  if (!element) return;
  const boundaries = getManager().findBoundaries(element);
  for (const b of boundaries) {
    const name = b.getAttribute('data-ax-deadlock-name');
    if (!boundaryName || name === boundaryName) {
      getManager().reset(b);
      return;
    }
  }
}

/**
 * Finds the first enclosing component host; app ownership is resolved by the caller.
 * @param {Element|null} element - Component host.
 * @returns {object|null} Enclosing host's instance, used only as an identity by this module.
 */
export function findErrorAncestor(element) {
  let parentEl = element?.parentNode;
  while (parentEl) {
    if (parentEl.__avenx_comp_instance) return parentEl.__avenx_comp_instance;
    parentEl = parentEl.parentNode;
  }
  return null;
}

/**
 * Reports through explicit boundary hooks, preserving diagnostic and propagation order.
 * @param {Error} error - Failure.
 * @param {string} origin - Execution phase.
 * @param {boolean|string} logged - Prior diagnostic or logging state.
 * @param {object} boundary - First boundary descriptor, containing hook and parent callbacks.
 * @param {object} callbacks - Application reporting and diagnostic context lookups.
 */
export function reportComponentError(error, origin, logged, boundary, callbacks) {
  let current = boundary;
  let currentError = error;
  const diagnostic = typeof logged === 'string' ? logged : null;
  if (diagnostic !== null) {
    logged = true;
  }

  while (current) {
    const hooks = current.hooks();

    if (hooks.length > 0) {
      let stopPropagation = false;
      for (const hook of hooks) {
        try {
          const result = hook(currentError, origin);
          if (result === false) {
            stopPropagation = true;
          }
        } catch (hookError) {
          currentError = hookError;
          origin = 'onErrorCaptured hook';
        }
      }

      if (stopPropagation) {
        if (diagnostic !== null) {
          const claimedBy = current.name();
          logger.debug(`${diagnostic} (handled: <${claimedBy}> claimed it in onErrorCaptured)`, callbacks.logContext());
        }
        return;
      }
    }

    current = current.next();
  }

  if (diagnostic !== null) {
    logger.error(diagnostic, callbacks.logContext());
  }

  if (callbacks.handleAppError(currentError, origin, logged)) return;

  if (logged) {
    // The call site already said what happened, with a diagnostic more
    // specific than this one.
    return;
  }

  // No application is reachable -- a component mounted on its own, or one
  // whose element is not in the document yet. `$app` walks the parent chain
  // and then the DOM, so this is uncommon, but it used to be the second way
  // an error could disappear: the chain above found no `onErrorCaptured`,
  // there was nothing to hand the error to, and the method simply ended.
  // Silence has to cost something, so it costs a report here as well.
  logger.error(
    formatMessage(
      AvenxErrorCodes.COMPONENT_RENDER_ABORTED,
      callbacks.componentName(),
      origin || 'render',
      (currentError && (currentError.stack || currentError.message)) || String(currentError),
    ),
  );
}

/**
 * Shows a suspense fallback or delegates to the enclosing boundary.
 * @param {Element|null} element - Component host.
 * @param {string} template - Template source.
 * @param {Promise<any>} promise - Pending work.
 * @param {object} callbacks - Render, parent, error and update operations.
 */
export function suspendRendering(element, template, promise, callbacks) {
  if (!element) return;

  const fallbackMatch = template.match(/<template data-ax-fallback[^>]*>([\s\S]*?)<\/template>/i);
  if (!fallbackMatch) {
    callbacks.suspendParent(promise);
    return;
  }

  const fallbackHtml = fallbackMatch[1].replace(/\{%/g, '{{').replace(/%\}/g, '}}');

  try {
    callbacks.renderFallback(fallbackHtml);
  } catch (error) {
    if (error instanceof Promise) {
      callbacks.suspendParent(error);
    } else {
      callbacks.handleError(error);
    }
  }

  promise.finally(() => {
    callbacks.update();
  });
}

/**
 * Selects an error fallback and delegates its rendering through explicit callbacks.
 * @param {Element|null} element - Component host.
 * @param {string} template - Template source.
 * @param {Error} error - Failure.
 * @param {object} callbacks - Boundary traversal, rendering and reporting operations.
 */
export function handleComponentError(element, template, error, callbacks) {
  if (!element) return;
  let errorAs = 'error';
  const asMatch = template.match(/data-ax-error-as="([^"]*)"/i);
  if (asMatch) {
    errorAs = asMatch[1];
  }

  const fallbackMatch = template.match(/<template data-ax-error-fallback[^>]*>([\s\S]*?)<\/template>/i);
  if (!fallbackMatch) {
    // Only transfer rendering to an ancestor that has a fallback. Otherwise
    // report from the failing child so its component hooks are not skipped.
    let ancestor = callbacks.parentBoundary();
    while (ancestor) {
      if (ancestor.hasFallback()) {
        ancestor.handle(error);
        return;
      }
      ancestor = ancestor.next();
    }
    callbacks.reportError(error, 'runUpdate');
    return;
  }

  const fallbackHtml = fallbackMatch[1].replace(/\{%/g, '{{').replace(/%\}/g, '}}');
  const extraScope = { [errorAs]: error };

  try {
    callbacks.renderFallback(fallbackHtml, extraScope);
  } catch (e) {
    callbacks.handleParentError(e);
  }
}
