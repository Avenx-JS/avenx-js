/**
 * @file directives.js
 * @description Built-in and custom directive evaluation and recursive directive tree application.
 * Handles data-ax-html, data-ax-show, data-ax-class, dynamic attribute names, custom directives,
 * and scoped slot expression resolution.
 * @module lib/core/renderer/patch/directives
 */

import { AvenxErrorCodes, formatMessage } from '../../runtime/AvenxError.js';
import { logger } from '../../runtime/AvenxLogger.js';
import { isBooleanAttribute, RESERVED_DIRECTIVE_NAMES } from '../constants.js';
import { sanitizeUrlAttribute } from '../../security/urlPolicy.js';
import { isEventHandlerAttribute } from '../../security/eventAttributes.js';
import { findScope } from '../bindingScope.js';
import { formatRenderDiagnostic } from '../../diagnostics/renderDiagnostics.js';
import { applyHtmlDirective } from '../htmlDirective.js';
import { enter, leave, getTransitionName, isNodeInPatchTree } from './transitionControl.js';
import { flushLifecycleHooks } from './unmount.js';

/**
 * Resolves the scope an element's bindings belong to.
 * @param {Element} el - The element a binding is attached to.
 * @returns {object|null} The nearest enclosing derived scope, or null.
 */
export function getSlotScope(el) {
  return findScope(el);
}

/**
 * Evaluates and applies directives on a single element.
 * @param {Element} el - The element to evaluate directives on.
 * @param {function(string, object=): any} resolveExpression - The expression evaluator.
 * @param {object} [app] - The application context.
 * @param {object} [context] - Evaluation context (patchRoot, component, logContext, sessionElements).
 * @returns {boolean} Whether children evaluation/diffing should be skipped.
 */
export function applyDirectivesOnElement(el, resolveExpression, app, context = {}) {
  if (!resolveExpression || el.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const slotScope = getSlotScope(el);
  const localResolve = slotScope ? (expr) => resolveExpression(expr, slotScope) : resolveExpression;
  let skipChildren = false;

  const comp =
    el.__avenx_comp_instance ||
    context.patchRoot?.__avenx_comp_instance ||
    context.component ||
    context.options?.component ||
    null;
  const logCtx =
    comp?.$logContext || context.logContext || context.options?.logContext || (comp ? { component: comp } : {});

  // 1. data-ax-html
  if (el.hasAttribute('data-ax-html')) {
    const expr = el.getAttribute('data-ax-html');
    try {
      applyHtmlDirective(el, localResolve(expr));
      skipChildren = true;
    } catch (err) {
      const formatted = formatRenderDiagnostic(
        AvenxErrorCodes.DIRECTIVE_HTML_EVALUATION_FAILED,
        expr,
        err.message || err,
        logCtx,
        { type: 'html' },
      );
      logger.warn(formatted, logCtx);
    }
  }

  // 2. data-ax-show
  if (el.hasAttribute('data-ax-show')) {
    const expr = el.getAttribute('data-ax-show');
    try {
      const value = !!localResolve(expr);
      if (typeof el.__originalDisplay === 'undefined') {
        el.__originalDisplay = el.style.display || '';
      }
      const isCurrentlyVisible = el.style.display !== 'none';
      if (!el.axShowInitialized) {
        el.style.display = value ? el.__originalDisplay : 'none';
        el.axShowInitialized = true;
      } else if (value !== isCurrentlyVisible) {
        const transitionName = getTransitionName(el, resolveExpression);
        if (transitionName) {
          if (value) {
            el.style.display = el.__originalDisplay;
            enter(el, transitionName);
          } else {
            leave(el, transitionName, () => {
              el.style.display = 'none';
            });
          }
        } else {
          el.style.display = value ? el.__originalDisplay : 'none';
        }
      }
    } catch (err) {
      const formatted = formatRenderDiagnostic(
        AvenxErrorCodes.DIRECTIVE_SHOW_EVALUATION_FAILED,
        expr,
        err.message || err,
        logCtx,
        { type: 'show' },
      );
      logger.warn(formatted, logCtx);
    }
  }

  // 3. data-ax-class
  if (el.hasAttribute('data-ax-class')) {
    const expr = el.getAttribute('data-ax-class');
    try {
      const value = localResolve(expr);
      if (el.__lastAxClasses) {
        for (const cls of el.__lastAxClasses) {
          el.classList.remove(cls);
        }
      }
      const newClasses = [];
      if (typeof value === 'string') {
        newClasses.push(...value.split(/\s+/).filter(Boolean));
      } else if (value && typeof value === 'object') {
        for (const [cls, enabled] of Object.entries(value)) {
          if (enabled) newClasses.push(cls);
        }
      }
      for (const cls of newClasses) {
        el.classList.add(cls);
      }
      el.__lastAxClasses = newClasses;
    } catch (err) {
      const formatted = formatRenderDiagnostic(
        AvenxErrorCodes.DIRECTIVE_CLASS_EVALUATION_FAILED,
        expr,
        err.message || err,
        logCtx,
        { type: 'class' },
      );
      logger.warn(formatted, logCtx);
    }
  }

  // 4. Dynamic Attribute Name Binding (:[attrName]="attrValue")
  const elAttrs = Array.from(el.attributes || []);
  const currentDynAttrs = [];
  let hasDynAttrDirective = false;
  for (const attr of elAttrs) {
    const match = attr.name.match(/^:\[(.*)\]$/);
    if (match) {
      hasDynAttrDirective = true;
      const nameExpr = match[1];
      const valExpr = attr.value;
      let resolvedName = null;
      try {
        resolvedName = localResolve(nameExpr);
      } catch (err) {
        const formatted = formatRenderDiagnostic(
          AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
          nameExpr,
          err.message || err,
          logCtx,
          { type: 'attr_name' },
        );
        logger.warn(formatted, logCtx);
      }

      if (resolvedName != null && String(resolvedName).trim() !== '') {
        const attrName = String(resolvedName).trim();
        if (isEventHandlerAttribute(attrName)) {
          logger.warn(formatMessage(AvenxErrorCodes.SECURITY_BLOCKED_EVENT_ATTRIBUTE, attrName));
          continue;
        }
        let resolvedVal = null;
        if (valExpr) {
          try {
            resolvedVal = localResolve(valExpr);
          } catch (err) {
            const formatted = formatRenderDiagnostic(
              AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
              valExpr,
              err.message || err,
              logCtx,
              { type: 'attr_value' },
            );
            logger.warn(formatted, logCtx);
          }
        }

        if (resolvedVal !== false && resolvedVal != null) {
          currentDynAttrs.push(attrName);
          if (resolvedVal === true) {
            el.setAttribute(attrName, 'true');
            if (isBooleanAttribute(attrName)) el[attrName] = true;
          } else {
            el.setAttribute(attrName, sanitizeUrlAttribute(attrName, String(resolvedVal)));
          }
        } else {
          currentDynAttrs.push(attrName);
          if (el.hasAttribute(attrName)) {
            el.removeAttribute(attrName);
            if (isBooleanAttribute(attrName)) el[attrName] = false;
          }
        }
      }
      el.removeAttribute(attr.name);
    }
  }

  if (hasDynAttrDirective) {
    const prevDynAttrs = el.__avenxDynAttrs || [];
    for (const oldName of prevDynAttrs) {
      if (!currentDynAttrs.includes(oldName)) {
        if (el.hasAttribute(oldName)) {
          el.removeAttribute(oldName);
          if (isBooleanAttribute(oldName)) el[oldName] = false;
        }
      }
    }
    el.__avenxDynAttrs = currentDynAttrs;
  }

  // 5. Custom Directives
  if (app && app.directives) {
    const attrs = Array.from(el.attributes || []);
    for (const attr of attrs) {
      if (attr.name.startsWith('data-ax-')) {
        const attrKey = attr.name.slice(8);
        const parts = attrKey.split('.');
        const dirName = parts[0];
        if (RESERVED_DIRECTIVE_NAMES.has(dirName)) continue;
        if (app.directives.has(dirName)) {
          const expr = attr.value;
          let value;
          if (expr) {
            try {
              value = localResolve(expr);
            } catch (err) {
              logger.warn(`Failed to evaluate custom directive ${dirName} expression "${expr}": ${err.message || err}`);
            }
          }

          if (!el.__avenx_directives) {
            el.__avenx_directives = new Map();
          }

          const oldInfo = el.__avenx_directives.get(attrKey);
          if (!oldInfo) {
            const modifiers = {};
            for (let i = 1; i < parts.length; i++) {
              if (parts[i]) modifiers[parts[i]] = true;
            }

            el.__avenx_directives.set(attrKey, {
              name: dirName,
              value,
              oldValue: undefined,
              expression: expr,
              modifiers,
              mountedCalled: false,
              valueChanged: false,
            });
          } else {
            const oldValue = oldInfo.value;
            if (value !== oldValue) {
              oldInfo.oldValue = oldValue;
              oldInfo.value = value;
              oldInfo.expression = expr;
              oldInfo.valueChanged = true;
            } else {
              oldInfo.valueChanged = false;
            }
          }

          if (context.sessionElements) {
            context.sessionElements.add(el);
          }
        }
      }
    }
  }

  return skipChildren;
}

/**
 * Recursively applies directives to an element and its children.
 * @param {Element} element - The target element.
 * @param {function(string, object=): any} resolveExpression - Expression resolver callback.
 * @param {object} [app] - The application context.
 * @param {object} [context] - Context containing sessionElements and patchRoot.
 */
export function applyDirectivesInternal(element, resolveExpression, app, context = {}) {
  const skip = applyDirectivesOnElement(element, resolveExpression, app, context);
  if (!skip) {
    const children = Array.from(element.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        applyDirectivesInternal(child, resolveExpression, app, context);
      }
    }
  }
}

/**
 * Recursively applies custom directives to an element and its children and flushes lifecycle hooks.
 * @param {Element} element - The element tree root.
 * @param {function(string, object=): any} resolveExpression - The expression evaluator.
 * @param {object} [app] - The application context.
 * @param {object} [options] - Optional settings (patchRoot, logContext, component).
 */
export function applyDirectives(element, resolveExpression, app, options = {}) {
  const sessionElements = new Set();
  const patchRoot = options.patchRoot || element;
  const context = { ...options, patchRoot, sessionElements };

  try {
    applyDirectivesInternal(element, resolveExpression, app, context);
    flushLifecycleHooks(sessionElements, (el) => isNodeInPatchTree(el, patchRoot), app);
  } finally {
    sessionElements.clear();
  }
}
