import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { logger } from '../runtime/AvenxLogger.js';
import { HtmlEscaper, SafeHtml } from '../security/escapeHtml.js';
import { BOOLEAN_ATTRIBUTES } from './constants.js';

const escaper = new HtmlEscaper();

/**
 * Helper to compute transition/animation duration from element computed styles.
 * @param {Element} el
 * @returns {number} duration in ms
 */
function getTransitionDuration(el) {
  if (!el || typeof window === 'undefined' || !window.getComputedStyle) return 0;
  const styles = window.getComputedStyle(el);
  const transitionDelay = styles.transitionDelay || '';
  const transitionDuration = styles.transitionDuration || '';
  const animationDelay = styles.animationDelay || '';
  const animationDuration = styles.animationDuration || '';

  const parseTime = (timeStr) => {
    if (!timeStr) return 0;
    const times = timeStr.split(',').map((t) => {
      const match = t.trim().match(/^([0-9.]+)(s|ms)$/i);
      if (!match) return 0;
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      return unit === 'ms' ? val : val * 1000;
    });
    return Math.max(...times, 0);
  };

  const tDuration = parseTime(transitionDuration);
  const tDelay = parseTime(transitionDelay);
  const aDuration = parseTime(animationDuration);
  const aDelay = parseTime(animationDelay);

  return Math.max(tDuration + tDelay, aDuration + aDelay);
}

/**
 * Handles patching the DOM with new HTML content using a simple diffing algorithm.
 * This approach is more efficient than innerHTML as it preserves existing DOM nodes.
 */
export class DomPatcher {
  /**
   * Patches the target element with the provided HTML.
   * @param {Element} target - The element to patch.
   * @param {string} html - The new HTML content.
   * @param {function(string): any} [resolveExpression] - Function to evaluate expressions.
   */
  patch(target, html, resolveExpression) {
    const parser = new DOMParser();
    const newDoc = parser.parseFromString(html, 'text/html');

    const parserError =
      newDoc && typeof newDoc.querySelector === 'function' ? newDoc.querySelector('parsererror') : null;
    if (parserError) {
      const errorMsg = parserError.textContent ? parserError.textContent.trim() : 'Unknown parsing error';
      logger.warn(formatMessage(AvenxErrorCodes.DOM_PARSING_FAILED, errorMsg, html));
      return;
    }

    const newRoot = newDoc.body;
    this.flattenTransitionTags(newRoot);

    this.#patchNode(target, newRoot, true, true, resolveExpression);
  }

  /**
   * Patches an existing element with a new element structure in-place.
   * @param {Element} oldElement - The existing element.
   * @param {Element} newElement - The new element structure.
   * @param {function(string): any} [resolveExpression] - Function to evaluate expressions.
   */
  patchElement(oldElement, newElement, resolveExpression) {
    this.flattenTransitionTags(newElement);
    this.#patchNode(oldElement, newElement, false, true, resolveExpression);
  }

  /**
   * Recursively diffs and patches two nodes.
   * @param {Node} oldNode - The existing DOM node.
   * @param {Node} newNode - The new node structure.
   * @param {boolean} [isBodyWrapper] - Whether the new node is a temporary body wrapper.
   * @param {boolean} [isPatchRoot] - Whether this is the root node of the patching operation.
   * @param {function(string): any} [resolveExpression] - Function to evaluate expressions.
   * @private
   */
  #patchNode(oldNode, newNode, isBodyWrapper = false, isPatchRoot = false, resolveExpression) {
    if (
      !isPatchRoot &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      oldNode.nodeName === 'SLOT' &&
      oldNode.hasAttribute('data-avenx-transcluded')
    ) {
      if (newNode.nodeType === Node.ELEMENT_NODE) {
        this.#patchAttributes(oldNode, newNode);
        oldNode.setAttribute('data-avenx-transcluded', 'true');
        if (resolveExpression) {
          this.#applyDirectives(oldNode, resolveExpression);
        }
      }
      return;
    }

    if (
      !isPatchRoot &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      (oldNode.hasAttribute('data-avenx-comp') || oldNode.hasAttribute('data-avenx-comp-dynamic'))
    ) {
      if (newNode.nodeType === Node.ELEMENT_NODE) {
        this.#patchAttributes(oldNode, newNode);
        const compInstance = oldNode.__avenx_comp_instance;
        if (compInstance && typeof compInstance.__updateTranscludedContent === 'function') {
          compInstance.__updateTranscludedContent(newNode.childNodes);
        }
        if (resolveExpression) {
          this.#applyDirectives(oldNode, resolveExpression);
        }
      }
      return;
    }

    if (
      !isPatchRoot &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      (oldNode.tagName.toLowerCase() === 'template' || oldNode.tagName.toLowerCase() === '@for')
    ) {
      if (newNode.nodeType === Node.ELEMENT_NODE) {
        this.#patchAttributes(oldNode, newNode);
      }
      return;
    }

    if (!isPatchRoot && oldNode.nodeType === Node.ELEMENT_NODE && oldNode.hasAttribute('data-ax-static')) {
      return;
    }

    // 1. Update attributes if it's an element (skip if it is the temporary body wrapper)
    let skipChildren = false;
    if (!isBodyWrapper && oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
      this.#patchAttributes(oldNode, newNode);
      if (resolveExpression) {
        skipChildren = this.#applyDirectives(oldNode, resolveExpression);
      }
    }

    if (skipChildren) {
      return;
    }

    // 2. Diff children
    const oldChildren = Array.from(oldNode.childNodes).filter((child) => !child._isLeaving);
    const newChildren = Array.from(newNode.childNodes);

    let oldIndex = 0;
    let newIndex = 0;

    while (newIndex < newChildren.length) {
      const newChild = newChildren[newIndex];
      let oldChild = oldChildren[oldIndex];

      // Skip items managed by ListManager in the old DOM
      while (oldChild && oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item')) {
        oldIndex++;
        oldChild = oldChildren[oldIndex];
      }

      if (!oldChild) {
        // Add remaining new children
        const isParentSvg =
          oldNode &&
          oldNode.nodeType === Node.ELEMENT_NODE &&
          (oldNode.namespaceURI === 'http://www.w3.org/2000/svg' || oldNode.tagName.toLowerCase() === 'svg');
        const prepared = this.#prepareNode(newChild, isParentSvg, resolveExpression);
        oldNode.appendChild(prepared);
        this.triggerEnter(prepared, resolveExpression);
      } else if (this.#isSameNodeType(oldChild, newChild)) {
        // Nodes are same type, patch them
        if (oldChild.nodeType === Node.TEXT_NODE) {
          if (oldChild.textContent !== newChild.textContent) {
            oldChild.textContent = newChild.textContent;
          }
        } else {
          this.#patchNode(oldChild, newChild, false, false, resolveExpression);
        }
        oldIndex++;
      } else {
        // Nodes are different, replace
        const isParentSvg =
          oldNode &&
          oldNode.nodeType === Node.ELEMENT_NODE &&
          (oldNode.namespaceURI === 'http://www.w3.org/2000/svg' || oldNode.tagName.toLowerCase() === 'svg');
        const prepared = this.#prepareNode(newChild, isParentSvg, resolveExpression);

        const transitionName = this.getTransitionName(oldChild, resolveExpression);
        if (transitionName) {
          oldNode.insertBefore(prepared, oldChild);
          this.triggerLeave(oldChild, resolveExpression, () => {
            if (oldChild.parentNode === oldNode) {
              oldNode.removeChild(oldChild);
            }
          });
        } else {
          oldNode.replaceChild(prepared, oldChild);
        }
        this.triggerEnter(prepared, resolveExpression);
        oldIndex++;
      }
      newIndex++;
    }

    // Remove remaining old children (that are not managed by ListManager)
    while (oldIndex < oldChildren.length) {
      const oldChild = oldChildren[oldIndex];
      if (!(oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item'))) {
        this.triggerLeave(oldChild, resolveExpression, () => {
          if (oldChild.parentNode === oldNode) {
            oldNode.removeChild(oldChild);
          }
        });
      }
      oldIndex++;
    }
  }

  /**
   * Checks if two nodes are of the same type and name.
   * @param {Node} nodeA
   * @param {Node} nodeB
   * @private
   */
  #isSameNodeType(nodeA, nodeB) {
    return nodeA.nodeType === nodeB.nodeType && nodeA.nodeName === nodeB.nodeName;
  }

  /**
   * Syncs attributes from newNode to oldNode.
   * @param {Element} oldNode
   * @param {Element} newNode
   * @private
   */
  #patchAttributes(oldNode, newNode) {
    const oldAttrs = oldNode.attributes;
    const newAttrs = newNode.attributes;

    // Remove old attributes that are gone
    for (let i = oldAttrs.length - 1; i >= 0; i--) {
      const attr = oldAttrs[i];
      if (!newNode.hasAttribute(attr.name)) {
        oldNode.removeAttribute(attr.name);
        if (BOOLEAN_ATTRIBUTES.has(attr.name.toLowerCase())) {
          oldNode[attr.name] = false;
        }
        if (attr.name === 'value' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(oldNode.nodeName)) {
          oldNode.value = '';
        }
      }
    }

    // Add or update attributes
    for (let i = 0; i < newAttrs.length; i++) {
      const attr = newAttrs[i];
      const isBoolean = BOOLEAN_ATTRIBUTES.has(attr.name.toLowerCase());

      if (isBoolean) {
        const isFalsy = attr.value === 'false' || attr.value === null || attr.value === undefined;
        if (isFalsy) {
          if (oldNode.hasAttribute(attr.name)) {
            oldNode.removeAttribute(attr.name);
          }
          oldNode[attr.name] = false;
        } else {
          if (oldNode.getAttribute(attr.name) !== attr.value) {
            oldNode.setAttribute(attr.name, attr.value);
          }
          oldNode[attr.name] = true;
        }
      } else {
        if (oldNode.getAttribute(attr.name) !== attr.value) {
          oldNode.setAttribute(attr.name, attr.value);
        }
        if (attr.name === 'value' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(oldNode.nodeName)) {
          if (oldNode.value !== attr.value) {
            oldNode.value = attr.value;
          }
        }
      }
    }
  }

  /**
   * Cleans an element by removing boolean attributes that evaluate to false.
   * @param {Element} element - The element to clean.
   * @returns {Element} The cleaned element.
   */
  cleanElement(element) {
    if (element && element.nodeType === Node.ELEMENT_NODE) {
      this.flattenTransitionTags(element);
      this.#cleanBooleanAttributes(element);
    }
    return element;
  }

  /**
   * Recursively finds and cleans boolean attributes that evaluate to false in a subtree.
   * @param {Element} element - The root element to clean.
   * @private
   */
  #cleanBooleanAttributes(element) {
    const elements = [element, ...element.querySelectorAll('*')];
    for (const el of elements) {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (BOOLEAN_ATTRIBUTES.has(attr.name.toLowerCase())) {
          const isFalsy = attr.value === 'false' || attr.value === null || attr.value === undefined;
          if (isFalsy) {
            el.removeAttribute(attr.name);
            el[attr.name] = false;
          } else {
            el[attr.name] = true;
          }
        }
      }
    }
  }

  /**
   * Cleans boolean attributes of a single element in-place.
   * @param {Element} el
   * @private
   */
  #cleanBooleanAttributesForNode(el) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (BOOLEAN_ATTRIBUTES.has(attr.name.toLowerCase())) {
        const isFalsy = attr.value === 'false' || attr.value === null || attr.value === undefined;
        if (isFalsy) {
          el.removeAttribute(attr.name);
          el[attr.name] = false;
        } else {
          el[attr.name] = true;
        }
      }
    }
  }

  /**
   * Prepares a node for insertion into the DOM by cleaning its boolean attributes
   * and ensuring correct namespaces for SVG elements.
   * If a node already has the correct namespace, it is prepared in-place without cloning.
   * @param {Node} node - The node to prepare.
   * @param {boolean} [isSvg] - Whether the node is within an SVG context.
   * @param {function(string): any} [resolveExpression] - Function to evaluate expressions.
   * @returns {Node} The prepared node.
   * @private
   */
  #prepareNode(node, isSvg = false, resolveExpression) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      if (tagName === 'template' || tagName === '@for') {
        return node;
      }
      const currentIsSvg = isSvg || tagName === 'svg';

      let skipChildren = false;
      if (resolveExpression) {
        skipChildren = this.#applyDirectives(node, resolveExpression);
      }

      if (currentIsSvg) {
        if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
          this.#cleanBooleanAttributesForNode(node);
          if (!skipChildren) {
            const children = Array.from(node.childNodes);
            for (const child of children) {
              this.#prepareNode(child, currentIsSvg, resolveExpression);
            }
          }
          return node;
        } else {
          const svgElement = document.createElementNS('http://www.w3.org/2000/svg', tagName);
          const attrs = node.attributes;
          if (attrs) {
            for (let i = 0; i < attrs.length; i++) {
              const attr = attrs[i];
              const isBoolean = BOOLEAN_ATTRIBUTES.has(attr.name.toLowerCase());
              const isFalsy = attr.value === 'false' || attr.value === null || attr.value === undefined;
              if (isBoolean && isFalsy) {
                svgElement[attr.name] = false;
              } else {
                svgElement.setAttribute(attr.name, attr.value);
                if (isBoolean) {
                  svgElement[attr.name] = true;
                }
              }
            }
          }
          if (resolveExpression) {
            this.#applyDirectives(svgElement, resolveExpression);
          }
          if (!skipChildren) {
            const children = Array.from(node.childNodes);
            for (const child of children) {
              svgElement.appendChild(this.#prepareNode(child, currentIsSvg, resolveExpression));
            }
          }
          return svgElement;
        }
      } else {
        this.#cleanBooleanAttributesForNode(node);
        if (!skipChildren) {
          const children = Array.from(node.childNodes);
          for (const child of children) {
            this.#prepareNode(child, false, resolveExpression);
          }
        }
        return node;
      }
    }
    return node;
  }

  /**
   * Evaluates and applies directives on a single element.
   * @param {Element} el - The element to evaluate directives on.
   * @param {function(string): any} resolveExpression - The expression evaluator.
   * @returns {boolean} Whether children evaluation/diffing should be skipped.
   * @private
   */
  #applyDirectives(el, resolveExpression) {
    if (!resolveExpression || el.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    let skipChildren = false;

    // 1. data-ax-html
    if (el.hasAttribute('data-ax-html')) {
      const expr = el.getAttribute('data-ax-html');
      try {
        const value = resolveExpression(expr);
        let resolvedHtml = '';
        if (value instanceof SafeHtml) {
          resolvedHtml = value.toString();
        } else if (value == null) {
          resolvedHtml = '';
        } else {
          resolvedHtml = escaper.escape(value);
        }
        if (el.innerHTML !== resolvedHtml) {
          el.innerHTML = resolvedHtml;
        }
        skipChildren = true;
      } catch (err) {
        logger.warn(
          formatMessage(AvenxErrorCodes.DIRECTIVE_HTML_EVALUATION_FAILED, expr, err.message || err)
        );
      }
    }

    // 2. data-ax-show
    if (el.hasAttribute('data-ax-show')) {
      const expr = el.getAttribute('data-ax-show');
      try {
        const value = !!resolveExpression(expr);
        const hasOriginal = typeof el.__originalDisplay !== 'undefined';
        if (!hasOriginal) {
          el.__originalDisplay = el.style.display || '';
        }

        const isCurrentlyVisible = el.style.display !== 'none';

        if (!el.axShowInitialized) {
          el.style.display = value ? el.__originalDisplay : 'none';
          el.axShowInitialized = true;
        } else if (value !== isCurrentlyVisible) {
          const transitionName = this.getTransitionName(el, resolveExpression);
          if (transitionName) {
            if (value) {
              el.style.display = el.__originalDisplay;
              this.enter(el, transitionName);
            } else {
              this.leave(el, transitionName, () => {
                el.style.display = 'none';
              });
            }
          } else {
            el.style.display = value ? el.__originalDisplay : 'none';
          }
        }
      } catch (err) {
        logger.warn(
          formatMessage(AvenxErrorCodes.DIRECTIVE_SHOW_EVALUATION_FAILED, expr, err.message || err)
        );
      }
    }

    // 3. data-ax-class
    if (el.hasAttribute('data-ax-class')) {
      const expr = el.getAttribute('data-ax-class');
      try {
        const value = resolveExpression(expr);
        // Clean up classes added by previous data-ax-class evaluation
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
            if (enabled) {
              newClasses.push(cls);
            }
          }
        }

        for (const cls of newClasses) {
          el.classList.add(cls);
        }
        el.__lastAxClasses = newClasses;
      } catch (err) {
        logger.warn(
          formatMessage(AvenxErrorCodes.DIRECTIVE_CLASS_EVALUATION_FAILED, expr, err.message || err)
        );
      }
    }

    return skipChildren;
  }

  /**
   * Recursively applies custom directives to an element and its children.
   * @param {Element} element - The element tree root.
   * @param {function(string): any} resolveExpression - The expression evaluator.
   */
  applyDirectives(element, resolveExpression) {
    const skip = this.#applyDirectives(element, resolveExpression);
    if (!skip) {
      const children = Array.from(element.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          this.applyDirectives(child, resolveExpression);
        }
      }
    }
  }

  /**
   * Applies the enter transition classes and triggers animation/transition.
   * @param {Element} el - The element to animate.
   * @param {string} transitionName - The transition name (e.g. 'fade').
   */
  enter(el, transitionName) {
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const name = transitionName || 'ax';
    const enterClass = `${name}-enter`;
    const enterActiveClass = `${name}-enter-active`;
    const enterToClass = `${name}-enter-to`;

    if (el._cleanupTransition) {
      el._cleanupTransition();
    }

    el.classList.add(enterClass);
    el.classList.add(enterActiveClass);

    let resolved = false;
    let timeoutId = null;

    const done = () => {
      if (resolved) return;
      resolved = true;
      el.classList.remove(enterActiveClass);
      el.classList.remove(enterToClass);
      el.removeEventListener('transitionend', done);
      el.removeEventListener('animationend', done);
      if (timeoutId) clearTimeout(timeoutId);
      delete el._cleanupTransition;
    };

    el._cleanupTransition = done;

    el.addEventListener('transitionend', done);
    el.addEventListener('animationend', done);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (resolved) return;
        el.classList.remove(enterClass);
        el.classList.add(enterToClass);

        const duration = getTransitionDuration(el);
        if (duration === 0) {
          done();
        } else {
          timeoutId = setTimeout(done, duration + 50);
        }
      });
    });
  }

  /**
   * Applies the leave transition classes, triggers animation, and cleans up when complete.
   * @param {Element} el - The element to animate.
   * @param {string} transitionName - The transition name (e.g. 'fade').
   * @param {function(): void} removeCallback - Callback invoked when the leave transition completes.
   */
  leave(el, transitionName, removeCallback) {
    if (el.nodeType !== Node.ELEMENT_NODE) {
      if (removeCallback) removeCallback();
      return;
    }
    const name = transitionName || 'ax';
    const leaveClass = `${name}-leave`;
    const leaveActiveClass = `${name}-leave-active`;
    const leaveToClass = `${name}-leave-to`;

    if (el._cleanupTransition) {
      el._cleanupTransition();
    }

    el._isLeaving = true;

    el.classList.add(leaveClass);
    el.classList.add(leaveActiveClass);

    let resolved = false;
    let timeoutId = null;

    const done = () => {
      if (resolved) return;
      resolved = true;
      el.classList.remove(leaveActiveClass);
      el.classList.remove(leaveToClass);
      el.removeEventListener('transitionend', done);
      el.removeEventListener('animationend', done);
      if (timeoutId) clearTimeout(timeoutId);
      delete el._cleanupTransition;
      delete el._isLeaving;
      if (removeCallback) removeCallback();
    };

    el._cleanupTransition = done;

    el.addEventListener('transitionend', done);
    el.addEventListener('animationend', done);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (resolved) return;
        el.classList.remove(leaveClass);
        el.classList.add(leaveToClass);

        const duration = getTransitionDuration(el);
        if (duration === 0) {
          done();
        } else {
          timeoutId = setTimeout(done, duration + 50);
        }
      });
    });
  }

  /**
   * Resolves the transition name for an element.
   * @param {Element} el - The element.
   * @param {function(string): any} [resolveExpression] - The expression evaluator.
   * @returns {string|null} The resolved transition name, or null.
   */
  getTransitionName(el, resolveExpression) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    if (!el.hasAttribute('data-ax-transition')) return null;
    const expr = el.getAttribute('data-ax-transition');
    if (!expr) return 'ax';
    if (!resolveExpression) return expr;
    try {
      const val = resolveExpression(expr);
      return typeof val === 'string' ? val : expr;
    } catch {
      return expr;
    }
  }

  /**
   * Triggers the enter transition if transition configurations are present.
   * @param {Element} el - The element.
   * @param {function(string): any} [resolveExpression] - The expression evaluator.
   */
  triggerEnter(el, resolveExpression) {
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const transitionName = this.getTransitionName(el, resolveExpression);
    if (transitionName) {
      el._transitionName = transitionName;
      this.enter(el, transitionName);
    }
  }

  /**
   * Triggers the leave transition if transition configurations are present.
   * @param {Element} el - The element.
   * @param {function(string): any} [resolveExpression] - The expression evaluator.
   * @param {function(): void} removeCallback - Callback invoked when transition completes or immediately.
   */
  triggerLeave(el, resolveExpression, removeCallback) {
    if (el.nodeType !== Node.ELEMENT_NODE) {
      if (removeCallback) removeCallback();
      return;
    }
    const transitionName = el._transitionName || this.getTransitionName(el, resolveExpression);
    if (transitionName) {
      this.leave(el, transitionName, removeCallback);
    } else {
      if (removeCallback) removeCallback();
    }
  }

  /**
   * Flattens <transition> elements inside a root element.
   * @param {Element} node - The root element.
   */
  flattenTransitionTags(node) {
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
}
