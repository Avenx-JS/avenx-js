/**
 * @file deadlockManager.js
 * @description Manages <@deadlock> reactive boundaries, boundary tripping, and fallback UI rendering.
 */

import { deriveScope } from '../reactive/scopeProxy.js';
import { logger } from '../runtime/AvenxLogger.js';

const boundaryManagers = new WeakMap();

/**
 * Manages <@deadlock> reactive boundaries, containment checks, and error recovery fallbacks.
 */
export class DeadlockManager {
  /** @type {WeakSet<Element>} */
  #tripped = new WeakSet();

  /**
   * @param {object} evaluator - Expression evaluator.
   * @param {object} renderer - Template renderer.
   * @param {object} [eventBinder] - Event binder.
   * @param {string} [componentName] - Parent component name.
   */
  constructor(evaluator, renderer, eventBinder, componentName) {
    this.evaluator = evaluator;
    this.renderer = renderer;
    this.eventBinder = eventBinder;
    this.componentName = componentName || 'AnonymousComponent';
  }

  /**
   * Checks if a boundary is currently tripped.
   * @param {Element} container - The [data-ax-deadlock] element.
   * @returns {boolean}
   */
  isTripped(container) {
    return this.#tripped.has(container);
  }

  /**
   * Finds all [data-ax-deadlock] boundary containers within a root element.
   * @param {Element} root
   * @returns {Element[]}
   */
  findBoundaries(root) {
    if (!root) return [];
    const boundaries = [];
    if (root.matches && root.matches('[data-ax-deadlock]')) {
      boundaries.push(root);
      boundaryManagers.set(root, this);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('[data-ax-deadlock]').forEach((el) => {
        boundaries.push(el);
        boundaryManagers.set(el, this);
      });
    }
    return boundaries;
  }

  /**
   * Trips a deadlock boundary, unmounting its active child subtree and rendering fallback UI.
   * @param {Element} container - The [data-ax-deadlock] element.
   * @param {Error|object} [error] - The error or diagnostic details.
   * @param {object} [scope] - Evaluation scope.
   */
  trip(container, error = {}, scope = {}) {
    if (!container || this.#tripped.has(container)) return;
    this.#tripped.add(container);

    const boundaryName = container.getAttribute('data-ax-deadlock-name') || 'anonymous';
    const fallbackTpl = container.querySelector('template[data-ax-deadlock-fallback]');

    if (fallbackTpl) {
      const errorAs = fallbackTpl.getAttribute('data-ax-error-as') || 'error';
      const fallbackHtml = fallbackTpl.innerHTML.replace(/\{%/g, '{{').replace(/%\}/g, '}}');

      const errObj =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : typeof error === 'object' && error !== null
            ? { message: error.message || 'Reactive cycle detected', ...error }
            : { message: String(error) };

      const evalScope = deriveScope(scope, {
        name: boundaryName,
        [errorAs]: errObj,
      });

      const renderedFallback = this.renderer
        ? this.renderer.render(fallbackHtml, (expr) => {
          try {
            if (expr === 'name') return boundaryName;
            if (expr === `${errorAs}.message` || expr === 'error.message') return errObj.message;
            return evalScope[expr] !== undefined ? evalScope[expr] : '';
          } catch {
            return '';
          }
        })
        : fallbackHtml
          .replace(/\{\{\s*name\s*\}\}/g, boundaryName)
          .replace(new RegExp(`\\{\\{\\s*(${errorAs}|error)\\.message\\s*\\}\\}`, 'g'), errObj.message);

      // Remove non-template child elements (unmount child content)
      const childrenToRemove = Array.from(container.childNodes).filter((child) => {
        return !(child.nodeType === 1 && child.tagName && child.tagName.toLowerCase() === 'template');
      });

      for (const child of childrenToRemove) {
        if (child.__avenx_comp_instance && typeof child.__avenx_comp_instance.unmount === 'function') {
          try {
            child.__avenx_comp_instance.unmount();
          } catch (e) {
            logger.error('Error unmounting deadlocked child component:', e);
          }
        }
        if (child.parentNode) {
          child.parentNode.removeChild(child);
        }
      }

      if (typeof document !== 'undefined') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderedFallback;
        while (tempDiv.firstChild) {
          container.appendChild(tempDiv.firstChild);
        }
      }
    }
  }

  /**
   * Resets a tripped boundary so it can render normally again.
   * @param {Element} container
   */
  reset(container) {
    if (container) {
      this.#tripped.delete(container);
    }
  }
}

/**
 * Finds the component instance owning or enclosing a DOM container.
 * @param {Element} container
 * @returns {object|null}
 */
export function findOwningComponent(container) {
  let curr = container;
  while (curr) {
    if (curr.__avenx_comp_instance) {
      return curr.__avenx_comp_instance;
    }
    curr = curr.parentElement || curr.parentNode;
  }
  return null;
}

/**
 * Trips a deadlock boundary container, discovering its manager or owning component.
 * @param {Element} container - The [data-ax-deadlock] element.
 * @param {Error|object} [error] - Diagnostic or error details.
 * @param {object} [scope] - Evaluation scope.
 */
export function tripBoundary(container, error = {}, scope = {}) {
  if (!container) return;
  const manager = boundaryManagers.get(container);
  if (manager) {
    manager.trip(container, error, scope);
    return;
  }
  const owner = findOwningComponent(container);
  if (owner && typeof owner.__tripBoundaryElement === 'function') {
    owner.__tripBoundaryElement(container, error);
    return;
  }
  const dm = new DeadlockManager();
  dm.trip(container, error, scope);
}
