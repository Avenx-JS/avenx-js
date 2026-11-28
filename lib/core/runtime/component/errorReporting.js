import { DeadlockManager } from '../../renderer/deadlockManager.js';
import { logger } from '../AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../AvenxError.js';
import { tokenizeMarkup } from '../../utils/markupLexer.js';

const boundarySources = new WeakMap();

/**
 * Associates a thrown Promise or Error with the DOM boundary element that threw it.
 * @param {any} thrown - The thrown Promise or Error.
 * @param {Element|null} boundaryEl - The enclosing boundary element.
 */
export function recordBoundarySource(thrown, boundaryEl) {
  if (boundaryEl && ((typeof thrown === 'object' && thrown !== null) || typeof thrown === 'function')) {
    boundarySources.set(thrown, boundaryEl);
  }
}

/**
 * Retrieves and removes the DOM boundary element associated with a thrown Promise or Error.
 * @param {any} thrown - The thrown Promise or Error.
 * @returns {Element|null}
 */
export function consumeBoundarySource(thrown) {
  if ((typeof thrown === 'object' && thrown !== null) || typeof thrown === 'function') {
    const el = boundarySources.get(thrown) || null;
    boundarySources.delete(thrown);
    return el;
  }
  return null;
}

/**
 * Unescapes template markers inside a fallback template body.
 * @param {string} html - Raw fallback template inner HTML.
 * @returns {string}
 */
function unescapeFallback(html) {
  return html.replace(/\{%/g, '{{').replace(/%\}/g, '}}');
}

/**
 * Finds an attribute on a markup open token by case-insensitive name.
 * @param {object} token - Markup token.
 * @param {string} name - Attribute name.
 * @returns {object|null}
 */
function getTokenAttr(token, name) {
  if (!token?.attrs) return null;
  const target = name.toLowerCase();
  return token.attrs.find((a) => a.name.toLowerCase() === target) || null;
}

/**
 * Finds the matching close tag token index for an open tag token.
 * @param {Array<object>} tokens - Markup tokens.
 * @param {number} openIdx - Index of the open token.
 * @returns {number} Matching close token index, or -1 if unterminated.
 */
function findMatchingCloseToken(tokens, openIdx) {
  const tagName = tokens[openIdx].name.toLowerCase();
  let depth = 1;
  for (let i = openIdx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'open' && !t.selfClosing && t.name.toLowerCase() === tagName) {
      depth++;
    } else if (t.type === 'close' && t.name.toLowerCase() === tagName) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Locates the direct `<template>` fallback child of a boundary token range.
 * @param {Array<object>} tokens - Markup tokens.
 * @param {number} startIdx - First token index inside the boundary.
 * @param {number} endIdx - Boundary close token index.
 * @param {string} attrName - Marker attribute on the fallback template.
 * @returns {{open: object, close: object}|null}
 */
function findDirectFallbackRange(tokens, startIdx, endIdx, attrName) {
  let depth = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const t = tokens[i];
    if (t.type === 'open' && !t.selfClosing) {
      if (depth === 0 && t.name.toLowerCase() === 'template' && getTokenAttr(t, attrName)) {
        const closeIdx = findMatchingCloseToken(tokens, i);
        if (closeIdx !== -1 && closeIdx < endIdx) {
          return { open: t, close: tokens[closeIdx] };
        }
      }
      depth++;
    } else if (t.type === 'close') {
      depth--;
    }
  }
  return null;
}

/**
 * Finds the nearest enclosing boundary element inside `element` for `sourceElement`.
 * @param {Element|null} element - Component host element.
 * @param {Element|null} sourceElement - Originating element.
 * @param {string} selector - Boundary selector.
 * @returns {Element|null}
 */
function findEnclosingBoundary(element, sourceElement, selector) {
  if (!element || !sourceElement) return null;
  let candidate = null;
  if (sourceElement.matches?.(selector)) {
    candidate = sourceElement;
  } else if (sourceElement.closest) {
    candidate = sourceElement.closest(selector);
  }
  if (candidate && element.contains?.(candidate)) {
    return candidate;
  }
  return null;
}

/**
 * Finds the direct fallback `<template>` child of a boundary element.
 * @param {Element|null} boundaryEl - Boundary container element.
 * @param {string} attrName - Fallback marker attribute name.
 * @returns {Element|null}
 */
function findDirectFallbackTemplate(boundaryEl, attrName) {
  const children = boundaryEl?.children ? Array.from(boundaryEl.children) : [];
  return (
    children.find(
      (child) => child.tagName?.toLowerCase() === 'template' && child.hasAttribute?.(attrName),
    ) || null
  );
}

/**
 * Renders a template while scoping `<@suspense>` and `<@errorBoundary>` fallbacks
 * to their own subtrees so siblings outside the boundary are preserved.
 * @param {string} template - Desugared template string.
 * @param {function(string): string} renderFn - Renders a template chunk with normal scope.
 * @param {function(string, object): string} renderFallbackFn - Renders an error fallback with extra scope.
 * @param {function(Promise<any>): void} [onSuspendPromise] - Registers a pending promise for re-render.
 * @returns {string} Rendered HTML string.
 */
export function renderWithBoundaries(template, renderFn, renderFallbackFn, onSuspendPromise) {
  if (!template || (!template.includes('data-ax-suspense') && !template.includes('data-ax-error-boundary'))) {
    return renderFn(template);
  }

  const tokens = tokenizeMarkup(template);
  let output = '';
  let cursor = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'open' || token.selfClosing) continue;

    const isSuspense = !!getTokenAttr(token, 'data-ax-suspense');
    const isErrorBoundary = !isSuspense && !!getTokenAttr(token, 'data-ax-error-boundary');
    if (!isSuspense && !isErrorBoundary) continue;

    const closeIdx = findMatchingCloseToken(tokens, i);
    if (closeIdx === -1) continue;

    const closeToken = tokens[closeIdx];
    if (token.start > cursor) {
      output += renderFn(template.slice(cursor, token.start));
    }

    const openTag = template.slice(token.start, token.end);
    const closeTag = template.slice(closeToken.start, closeToken.end);
    const fallbackAttr = isSuspense ? 'data-ax-fallback' : 'data-ax-error-fallback';
    const fallbackRange = findDirectFallbackRange(tokens, i + 1, closeIdx, fallbackAttr);

    if (!fallbackRange) {
      const inner = template.slice(token.end, closeToken.start);
      output += openTag + renderWithBoundaries(inner, renderFn, renderFallbackFn, onSuspendPromise) + closeTag;
      cursor = closeToken.end;
      i = closeIdx;
      continue;
    }

    const tplFull = template.slice(fallbackRange.open.start, fallbackRange.close.end);
    const tplInner = template.slice(fallbackRange.open.end, fallbackRange.close.start);
    const body =
      template.slice(token.end, fallbackRange.open.start) +
      template.slice(fallbackRange.close.end, closeToken.start);

    try {
      const renderedBody = renderWithBoundaries(body, renderFn, renderFallbackFn, onSuspendPromise);
      output += openTag + tplFull + renderedBody + closeTag;
    } catch (err) {
      if (err instanceof Promise && isSuspense) {
        onSuspendPromise?.(err);
        const renderedFallback = renderFn(unescapeFallback(tplInner));
        output += openTag + tplFull + renderedFallback + closeTag;
      } else if (
        !(err instanceof Promise) &&
        err?.code !== AvenxErrorCodes.STATE_MUTATION_IN_UPDATE &&
        isErrorBoundary
      ) {
        const errorAs = getTokenAttr(token, 'data-ax-error-as')?.value || 'error';
        const renderedFallback = renderFallbackFn(unescapeFallback(tplInner), { [errorAs]: err });
        output += openTag + tplFull + renderedFallback + closeTag;
      } else {
        throw err;
      }
    }

    cursor = closeToken.end;
    i = closeIdx;
  }

  if (cursor < template.length) {
    output += renderFn(template.slice(cursor));
  }

  return output;
}

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
 * @param {Element|null} [sourceElement] - Originating element inside `element`, if known.
 */
export function suspendRendering(element, template, promise, callbacks, sourceElement = null) {
  if (!element) return;

  const schedule = () => {
    if (callbacks.scheduleUpdate) {
      callbacks.scheduleUpdate(promise);
    } else {
      promise.finally(() => {
        callbacks.update();
      });
    }
  };

  const boundaryEl = findEnclosingBoundary(element, sourceElement, '[data-ax-suspense]');
  if (boundaryEl) {
    const fallbackTpl = findDirectFallbackTemplate(boundaryEl, 'data-ax-fallback');
    if (fallbackTpl) {
      const fallbackHtml = unescapeFallback(fallbackTpl.innerHTML);
      try {
        callbacks.renderScopedFallback(boundaryEl, fallbackHtml);
      } catch (error) {
        if (error instanceof Promise) {
          callbacks.suspendParent(error);
        } else {
          callbacks.handleError(error, boundaryEl);
        }
      }
      schedule();
      return;
    }
  }

  if (sourceElement) {
    callbacks.suspendParent(promise);
    return;
  }

  const fallbackMatch = template.match(/<template data-ax-fallback[^>]*>([\s\S]*?)<\/template>/i);
  if (!fallbackMatch) {
    callbacks.suspendParent(promise);
    return;
  }

  const fallbackHtml = unescapeFallback(fallbackMatch[1]);

  try {
    callbacks.renderFallback(fallbackHtml);
  } catch (error) {
    if (error instanceof Promise) {
      callbacks.suspendParent(error);
    } else {
      callbacks.handleError(error);
    }
  }

  schedule();
}

/**
 * Selects an error fallback and delegates its rendering through explicit callbacks.
 * @param {Element|null} element - Component host.
 * @param {string} template - Template source.
 * @param {Error} error - Failure.
 * @param {object} callbacks - Boundary traversal, rendering and reporting operations.
 * @param {Element|null} [sourceElement] - Originating element inside `element`, if known.
 */
export function handleComponentError(element, template, error, callbacks, sourceElement = null) {
  if (!element) return;

  const boundaryEl = findEnclosingBoundary(element, sourceElement, '[data-ax-error-boundary]');
  if (boundaryEl) {
    const fallbackTpl = findDirectFallbackTemplate(boundaryEl, 'data-ax-error-fallback');
    if (fallbackTpl) {
      const errorAs = boundaryEl.getAttribute('data-ax-error-as') || 'error';
      const fallbackHtml = unescapeFallback(fallbackTpl.innerHTML);
      try {
        callbacks.renderScopedFallback(boundaryEl, fallbackHtml, { [errorAs]: error });
      } catch (e) {
        callbacks.handleParentError(e);
      }
      return;
    }
  }

  if (sourceElement) {
    let ancestor = callbacks.parentBoundary();
    while (ancestor) {
      if (ancestor.hasFallback()) {
        ancestor.handle(error, element);
        return;
      }
      ancestor = ancestor.next();
    }
    callbacks.reportError(error, 'runUpdate');
    return;
  }

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
        ancestor.handle(error, element);
        return;
      }
      ancestor = ancestor.next();
    }
    callbacks.reportError(error, 'runUpdate');
    return;
  }

  const fallbackHtml = unescapeFallback(fallbackMatch[1]);
  const extraScope = { [errorAs]: error };

  try {
    callbacks.renderFallback(fallbackHtml, extraScope);
  } catch (e) {
    callbacks.handleParentError(e);
  }
}
