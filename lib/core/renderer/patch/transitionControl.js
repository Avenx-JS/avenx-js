/**
 * @file transitionControl.js
 * @description Transition lifecycle triggers, transition element flattening, and active patch tree containment checks.
 *
 * ## What this module owns
 *
 * This collaborator coordinates element transitions and DOM tree membership:
 * - Direct enter and leave animations delegating to the transition driver.
 * - Resolving transition names from `data-ax-transition` attributes, honoring slot binding scopes.
 * - Triggering enter and leave animations with asynchronous component unmount handling.
 * - Flattening `<transition>` tags in template fragments into `data-ax-transition` attributes.
 * - Checking whether a node remains connected inside the active patch tree root.
 *
 * All functions take explicit arguments with no mutual dependency on `DomPatcher`.
 * @module lib/core/renderer/patch/transitionControl
 */

import { enter as runEnter, leave as runLeave } from '../transitions.js';
import { findScope } from '../bindingScope.js';
import { triggerUnmounted } from './unmount.js';

/**
 * Runs an enter transition using the shared page/component helpers.
 * @param {Element} el - The element to animate.
 * @param {string} transitionName - The transition class prefix.
 */
export function enter(el, transitionName) {
  runEnter(el, transitionName);
}

/**
 * Runs a leave transition and removes the element when complete.
 * @param {Element} el - The element to animate.
 * @param {string} transitionName - The transition class prefix.
 * @param {Function} removeCallback - Called after leaving.
 */
export function leave(el, transitionName, removeCallback) {
  runLeave(el, transitionName, removeCallback);
}

/**
 * Resolves the transition name for an element.
 * @param {Element} el - The element.
 * @param {function(string, object=): any} [resolveExpression] - The expression evaluator.
 * @returns {string|null} The resolved transition name, or null.
 */
export function getTransitionName(el, resolveExpression) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  if (!el.hasAttribute('data-ax-transition')) return null;
  const expr = el.getAttribute('data-ax-transition');
  if (!expr) return 'ax';
  if (!resolveExpression) return expr;
  const slotScope = findScope(el);
  const localResolve = slotScope ? (e) => resolveExpression(e, slotScope) : resolveExpression;
  try {
    const val = localResolve(expr);
    return typeof val === 'string' ? val : expr;
  } catch {
    return expr;
  }
}

/**
 * Triggers the enter transition if transition configurations are present.
 * @param {Element} el - The element.
 * @param {function(string, object=): any} [resolveExpression] - The expression evaluator.
 * @param {function(Element, string): void} [enterFn] - Enter animation implementation.
 */
export function triggerEnter(el, resolveExpression, enterFn = enter) {
  if (el.nodeType !== Node.ELEMENT_NODE) return;
  const transitionName = getTransitionName(el, resolveExpression);
  if (transitionName) {
    el._transitionName = transitionName;
    enterFn(el, transitionName);
  }
}

/**
 * Triggers the leave transition or asynchronous unmounting of an element.
 * @param {Element} el - The element leaving.
 * @param {function(string, object=): any} [resolveExpression] - Expression evaluator callback.
 * @param {Function} [removeCallback] - Callback to remove element from DOM.
 * @param {object} [app] - The application context.
 * @param {function(Node, object=): void} [unmountHook] - Callback to unmount element directives.
 * @param {function(Element, string, Function): void} [leaveFn] - Leave animation implementation.
 */
export function triggerLeave(
  el,
  resolveExpression,
  removeCallback,
  app,
  unmountHook = triggerUnmounted,
  leaveFn = leave,
) {
  if (el.nodeType !== Node.ELEMENT_NODE) {
    if (removeCallback) removeCallback();
    return;
  }

  const compInstance = el.__avenx_comp_instance;
  const proceedWithRemoval = () => {
    const done = () => {
      if (typeof unmountHook === 'function') {
        unmountHook(el, app);
      }
      if (removeCallback) removeCallback();
    };
    const transitionName = el._transitionName || getTransitionName(el, resolveExpression);
    if (transitionName) {
      leaveFn(el, transitionName, done);
    } else {
      done();
    }
  };

  if (compInstance && typeof compInstance.unmount === 'function') {
    const unmountResult = compInstance.unmount();
    if (unmountResult instanceof Promise) {
      unmountResult.then(proceedWithRemoval);
      return;
    }
  }
  proceedWithRemoval();
}

/**
 * Flattens <transition> elements inside a root element.
 * @param {Element} node - The root element.
 */
export function flattenTransitionTags(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
  const transitions = Array.from(node.querySelectorAll('transition'));
  for (const trans of transitions) {
    const nameAttr = trans.getAttribute('name');
    let transitionValue = 'ax';
    if (nameAttr) {
      if (nameAttr.startsWith('{{') && nameAttr.endsWith('}}')) {
        transitionValue = nameAttr.slice(2, -2).trim();
      } else {
        transitionValue = nameAttr;
      }
    }
    const children = Array.from(trans.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        child.setAttribute('data-ax-transition', transitionValue);
      }
      trans.parentNode.insertBefore(child, trans);
    }
    trans.parentNode.removeChild(trans);
  }
}

/**
 * Checks if a node is in the currently patched DOM tree.
 * @param {Element} el - The element to check.
 * @param {Element|null} patchRoot - The root element of current patch operation.
 * @returns {boolean} True if the node is within patchRoot.
 */
export function isNodeInPatchTree(el, patchRoot) {
  if (!patchRoot) return false;
  let curr = el;
  while (curr) {
    if (curr === patchRoot) return true;
    curr = curr.parentNode || (curr.host && curr.host.nodeType === 1 ? curr.host : null);
  }
  return false;
}
