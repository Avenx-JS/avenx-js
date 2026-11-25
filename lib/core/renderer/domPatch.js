/**
 * @file domPatch.js
 * @description Orchestrates DOM diffing, patching, and rendering updates.
 * Collaborates with patch/attributes.js, patch/directives.js, patch/transitionControl.js, and patch/unmount.js.
 * @module lib/core/renderer/domPatch
 */

import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { logger } from '../runtime/AvenxLogger.js';
import { syncControlValue } from './controlValue.js';
import { profile, getComponentProfilingInfo } from '../utils/profiler.js';
import { tracer } from '../trace/tracer.js';
import { traceDomOp, clampDomValue } from '../trace/dom.js';
import {
  cleanElement,
  patchAttributes,
  sanitizeUrlsIn,
  prepareNode,
  mergeAdjacentTextNodes,
} from './patch/attributes.js';
import { triggerUnmounted, triggerUnmountedForElement, flushLifecycleHooks } from './patch/unmount.js';
import {
  enter,
  leave,
  getTransitionName,
  triggerEnter,
  triggerLeave,
  flattenTransitionTags,
  isNodeInPatchTree,
} from './patch/transitionControl.js';
import { applyDirectivesOnElement, applyDirectivesInternal } from './patch/directives.js';

let parserInstance = null;
const sharedParser = () => (parserInstance ??= new DOMParser());

/**
 * Handles patching the DOM with new HTML content using a diffing algorithm.
 * Preserves existing DOM nodes and coordinates transitions, directives, and unmount hooks.
 */
export class DomPatcher {
  /** @param {object} [options] */
  constructor(options = {}) {
    this.options = options || {};
    this.logContext = options?.logContext || null;
    this.component = options?.component || null;
  }

  /** @returns {object} */
  get #directiveContext() {
    return {
      patchRoot: this.patchRoot,
      component: this.component,
      logContext: this.logContext,
      options: this.options,
      sessionElements: this.sessionElements,
    };
  }

  /**
   * @param {Element} root
   * @param {Function} fn
   */
  #withPatchSession(root, fn) {
    const prevSession = this.sessionElements;
    const prevRoot = this.patchRoot;
    this.sessionElements = new Set();
    this.patchRoot = root;
    try {
      fn();
    } finally {
      this.sessionElements = prevSession;
      this.patchRoot = prevRoot;
    }
  }

  /**
   * Patches the target element with the provided HTML.
   * @param {Element} target - Target element to patch.
   * @param {string} html - New HTML content.
   * @param {function(string): any} [resolveExpression] - Evaluates expressions.
   * @param {object} [app] - Application context.
   */
  patch(target, html, resolveExpression, app) {
    const { enableProfiling, componentName } = getComponentProfilingInfo(target);
    profile(enableProfiling, componentName, 'patch', () => {
      const newDoc = sharedParser().parseFromString(html, 'text/html');
      const err = newDoc?.querySelector?.('parsererror');
      if (err) {
        logger.warn(
          formatMessage(AvenxErrorCodes.DOM_PARSING_FAILED, err.textContent?.trim() || 'Unknown parsing error', html),
        );
        return;
      }
      const newRoot = newDoc.body;
      sanitizeUrlsIn(newRoot);
      this.flattenTransitionTags(newRoot);

      this.#withPatchSession(target, () => {
        this.#patchNode(target, newRoot, true, true, resolveExpression, app);
        this.flushLifecycleHooks(app);
      });
    });
  }

  /**
   * Patches an existing element with a new element structure in-place.
   * @param {Element} oldElement - Existing element.
   * @param {Element} newElement - New element structure.
   * @param {function(string): any} [resolveExpression] - Evaluates expressions.
   * @param {object} [app] - Application context.
   */
  patchElement(oldElement, newElement, resolveExpression, app) {
    const { enableProfiling, componentName } = getComponentProfilingInfo(oldElement);
    profile(enableProfiling, componentName, 'patch', () => {
      this.flattenTransitionTags(newElement);
      this.#withPatchSession(oldElement, () => {
        this.#patchNode(oldElement, newElement, false, true, resolveExpression, app);
        this.flushLifecycleHooks(app);
      });
    });
  }

  /**
   * Recursively diffs and patches two nodes.
   * @param {Node} oldNode
   * @param {Node} newNode
   * @param {boolean} [isBodyWrapper]
   * @param {boolean} [isPatchRoot]
   * @param {function(string): any} [resolveExpression]
   * @param {object} [app]
   * @private
   */
  #patchNode(oldNode, newNode, isBodyWrapper = false, isPatchRoot = false, resolveExpression, app) {
    if (!isPatchRoot && oldNode.nodeType === Node.ELEMENT_NODE) {
      const isSlot = oldNode.nodeName === 'SLOT' && oldNode.hasAttribute('data-avenx-transcluded');
      const isComp = oldNode.hasAttribute('data-avenx-comp') || oldNode.hasAttribute('data-avenx-comp-dynamic');
      if (isSlot || isComp) {
        if (newNode.nodeType === Node.ELEMENT_NODE) {
          patchAttributes(oldNode, newNode);
          if (isSlot) oldNode.setAttribute('data-avenx-transcluded', 'true');
          const comp = oldNode.__avenx_comp_instance;
          if (isComp && typeof comp?.__updateTranscludedContent === 'function') {
            comp.__updateTranscludedContent(newNode.childNodes);
          }
          if (resolveExpression) this.#applyDirectives(oldNode, resolveExpression, app);
        }
        return;
      }

      const tag = oldNode.tagName.toLowerCase();
      if ((tag === 'template' || tag === '@for') && newNode.nodeType === Node.ELEMENT_NODE) {
        patchAttributes(oldNode, newNode);
        return;
      }

      if (newNode.nodeType === Node.ELEMENT_NODE) {
        if (oldNode.hasAttribute('data-ax-static') && newNode.hasAttribute('data-ax-static')) return;
        if (
          oldNode.hasAttribute('data-ax-memo') &&
          typeof oldNode.isEqualNode === 'function' &&
          oldNode.isEqualNode(newNode)
        )
          return;
      }

      if (oldNode.hasAttribute('data-ax-deadlock') && oldNode.querySelector?.('.ax-deadlock-fallback')) return;
    }

    let skipChildren = false;
    if (!isBodyWrapper && oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
      patchAttributes(oldNode, newNode);
      if (resolveExpression) skipChildren = this.#applyDirectives(oldNode, resolveExpression, app);
    }
    if (skipChildren) return;

    const oldChildren = mergeAdjacentTextNodes(Array.from(oldNode.childNodes).filter((child) => !child._isLeaving));
    const newChildren = mergeAdjacentTextNodes(Array.from(newNode.childNodes));
    const prep = (node, isSvg) =>
      prepareNode(node, isSvg, resolveExpression, app, (el, res, a) => this.#applyDirectives(el, res, a));
    const removeChildNode = (child) => {
      if (child.parentNode === oldNode) {
        if (tracer.on) traceDomOp('remove', child);
        oldNode.removeChild(child);
      }
    };

    let oldIndex = 0;
    let newIndex = 0;

    while (newIndex < newChildren.length) {
      const newChild = newChildren[newIndex];
      let oldChild = oldChildren[oldIndex];

      while (oldChild && oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item')) {
        oldIndex++;
        oldChild = oldChildren[oldIndex];
      }

      const isParentSvg =
        oldNode &&
        oldNode.nodeType === Node.ELEMENT_NODE &&
        (oldNode.namespaceURI === 'http://www.w3.org/2000/svg' || oldNode.tagName.toLowerCase() === 'svg');

      if (!oldChild) {
        const prepared = prep(newChild, isParentSvg);
        oldNode.appendChild(prepared);
        if (tracer.on) traceDomOp('insert', prepared, { into: oldNode.tagName?.toLowerCase() });
        this.triggerEnter(prepared, resolveExpression);
      } else if (this.#isSameNodeType(oldChild, newChild)) {
        if (oldChild.nodeType === Node.TEXT_NODE) {
          if (oldChild.textContent !== newChild.textContent) {
            const prev = oldChild.textContent;
            oldChild.textContent = newChild.textContent;
            if (tracer.on)
              traceDomOp('text', oldChild, { from: clampDomValue(prev), to: clampDomValue(newChild.textContent) });
          }
        } else {
          this.#patchNode(oldChild, newChild, false, false, resolveExpression, app);
        }
        oldIndex++;
      } else {
        const prepared = prep(newChild, isParentSvg);
        const transitionName = this.getTransitionName(oldChild, resolveExpression);
        if (transitionName) {
          oldNode.insertBefore(prepared, oldChild);
          this.triggerLeave(oldChild, resolveExpression, () => removeChildNode(oldChild), app);
        } else {
          this.triggerUnmounted(oldChild, app);
          if (tracer.on) traceDomOp('replace', oldChild, { with: prepared.nodeName?.toLowerCase() });
          oldNode.replaceChild(prepared, oldChild);
        }
        this.triggerEnter(prepared, resolveExpression);
        oldIndex++;
      }
      newIndex++;
    }

    if (
      oldNode.nodeType === Node.ELEMENT_NODE &&
      oldNode.nodeName === 'SELECT' &&
      newNode.nodeType === Node.ELEMENT_NODE
    ) {
      const valAttr = newNode.getAttribute('value');
      if (valAttr !== null) syncControlValue(oldNode, valAttr);
    }

    while (oldIndex < oldChildren.length) {
      const oldChild = oldChildren[oldIndex];
      if (!(oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item'))) {
        this.triggerLeave(oldChild, resolveExpression, () => removeChildNode(oldChild), app);
      }
      oldIndex++;
    }
  }

  /**
   * @param {Node} a
   * @param {Node} b
   * @returns {boolean}
   */
  #isSameNodeType(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
  }

  /**
   * @param {Element} element
   * @returns {Element}
   */
  cleanElement(element) {
    return cleanElement(element, (node) => this.flattenTransitionTags(node));
  }

  /**
   * @param {Element} el
   * @param {Function} resolveExpression
   * @param {object} [app]
   * @returns {boolean}
   */
  #applyDirectives(el, resolveExpression, app) {
    return applyDirectivesOnElement(el, resolveExpression, app, this.#directiveContext);
  }

  /**
   * @param {Element} element
   * @param {function(string): any} resolveExpression
   * @param {object} [app]
   */
  applyDirectives(element, resolveExpression, app) {
    this.#withPatchSession(element, () => {
      this.applyDirectivesInternal(element, resolveExpression, app);
      this.flushLifecycleHooks(app);
    });
  }

  /**
   * @param {Element} element
   * @param {Function} resolveExpression
   * @param {object} [app]
   */
  applyDirectivesInternal(element, resolveExpression, app) {
    applyDirectivesInternal(element, resolveExpression, app, this.#directiveContext);
  }

  /**
   * @param {Element} el
   * @param {string} transitionName
   */
  enter(el, transitionName) {
    enter(el, transitionName);
  }

  /**
   * @param {Element} el
   * @param {string} transitionName
   * @param {Function} removeCallback
   */
  leave(el, transitionName, removeCallback) {
    leave(el, transitionName, removeCallback);
  }

  /**
   * @param {Element} el
   * @param {function(string): any} [resolveExpression]
   * @returns {string|null}
   */
  getTransitionName(el, resolveExpression) {
    return getTransitionName(el, resolveExpression);
  }

  /**
   * @param {Element} el
   * @param {function(string): any} [resolveExpression]
   */
  triggerEnter(el, resolveExpression) {
    triggerEnter(el, resolveExpression, (element, name) => this.enter(element, name));
  }

  /**
   * @param {Element} el
   * @param {Function} resolveExpression
   * @param {Function} removeCallback
   * @param {object} [app]
   */
  triggerLeave(el, resolveExpression, removeCallback, app) {
    triggerLeave(
      el,
      resolveExpression,
      removeCallback,
      app,
      (node, a) => this.triggerUnmounted(node, a),
      (element, name, done) => this.leave(element, name, done),
    );
  }

  /**
   * @param {Element} node
   */
  flattenTransitionTags(node) {
    flattenTransitionTags(node);
  }

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  isNodeInPatchTree(el) {
    return isNodeInPatchTree(el, this.patchRoot);
  }

  /**
   * @param {Node} node
   * @param {object} [app]
   */
  triggerUnmounted(node, app) {
    triggerUnmounted(node, app);
  }

  /**
   * @param {Element} el
   * @param {object} [app]
   */
  triggerUnmountedForElement(el, app) {
    triggerUnmountedForElement(el, app);
  }

  /**
   * @param {object} [app]
   */
  flushLifecycleHooks(app) {
    flushLifecycleHooks(
      this.sessionElements,
      (el) => this.isNodeInPatchTree(el),
      app,
      (node, a) => this.triggerUnmounted(node, a),
    );
  }
}
