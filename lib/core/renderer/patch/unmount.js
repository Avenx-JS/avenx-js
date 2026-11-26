/**
 * @file unmount.js
 * @description Directive unmount hook triggers and deferred lifecycle-hook queue flushing.
 *
 * ## What this module owns
 *
 * During patching and dynamic DOM diffing, elements may leave the DOM or be updated:
 * - Elements removed from the active tree trigger unmounted hooks recursively across their subtrees.
 * - Elements modified during a patch session accumulate lifecycle changes (mounted, updated) that
 *   are flushed once the patch session completes.
 * - If an element in the session elements was disconnected before flush, it receives unmounted calls
 *   instead of mounted/updated calls.
 *
 * All operations take explicit element and application arguments rather than mutating hidden patcher internals.
 * @module lib/core/renderer/patch/unmount
 */

import { logger } from '../../runtime/AvenxLogger.js';

/**
 * Triggers the unmounted hook on a single element.
 * @param {Element} el - The element whose directive unmounted hooks should be executed.
 * @param {object} [app] - The application context providing the directives registry.
 */
export function triggerUnmountedForElement(el, app) {
  if (el.__avenx_directives) {
    for (const [dirName, info] of el.__avenx_directives.entries()) {
      if (info.mountedCalled) {
        const dirDef = app && app.directives && app.directives.get(info.name);
        if (dirDef && typeof dirDef.unmounted === 'function') {
          try {
            dirDef.unmounted(el, {
              value: info.value,
              oldValue: info.value,
              expression: info.expression,
              modifiers: info.modifiers,
            });
          } catch (err) {
            logger.warn(`Error in unmounted hook of directive ${dirName}: ${err.message || err}`);
          }
        }
        info.mountedCalled = false;
      }
    }
  }
}

/**
 * Triggers the unmounted hook recursively on a node and its descendants.
 * @param {Node} node - The root node being unmounted.
 * @param {object} [app] - The application context providing the directives registry.
 */
export function triggerUnmounted(node, app) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

  const descendants = Array.from(node.querySelectorAll('*'));
  for (const desc of descendants) {
    triggerUnmountedForElement(desc, app);
  }
  triggerUnmountedForElement(node, app);
}

/**
 * Flushes all lifecycle hooks collected during the patch session.
 * @param {Set<Element>|null} sessionElements - Elements touched during the patch session.
 * @param {function(Element): boolean} isConnected - Predicate to test if node is in the active patch tree.
 * @param {object} [app] - Application context with directives registry.
 * @param {function(Node, object=): void} [onUnmount] - Callback when a disconnected element is unmounted.
 */
export function flushLifecycleHooks(sessionElements, isConnected, app, onUnmount = triggerUnmounted) {
  if (!sessionElements || !app || !app.directives) return;
  for (const el of sessionElements) {
    if (!el.__avenx_directives) continue;

    const connected = typeof isConnected === 'function' ? isConnected(el) : true;
    if (connected) {
      for (const [dirName, info] of el.__avenx_directives.entries()) {
        const dirDef = app.directives.get(info.name);
        if (!dirDef) continue;

        if (!info.mountedCalled) {
          if (typeof dirDef.mounted === 'function') {
            try {
              dirDef.mounted(el, {
                value: info.value,
                expression: info.expression,
                modifiers: info.modifiers,
              });
            } catch (err) {
              logger.error(`Error in mounted hook of directive ${dirName}: ${err.message || err}`);
            }
          }
          info.mountedCalled = true;
        } else if (info.valueChanged) {
          if (typeof dirDef.updated === 'function') {
            try {
              dirDef.updated(el, {
                value: info.value,
                oldValue: info.oldValue,
                expression: info.expression,
                modifiers: info.modifiers,
              });
            } catch (err) {
              logger.error(`Error in updated hook of directive ${dirName}: ${err.message || err}`);
            }
          }
          info.valueChanged = false;
        }
      }
    } else {
      if (typeof onUnmount === 'function') {
        onUnmount(el, app);
      }
    }
  }
}
