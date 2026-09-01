import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { logger } from '../runtime/AvenxLogger.js';
import { HtmlEscaper, SafeHtml } from '../security/escapeHtml.js';
import { isBooleanAttribute } from './constants.js';
import { profile, getComponentProfilingInfo } from '../utils/profiler.js';
import { tracer } from '../trace/tracer.js';
import { traceDomOp, clampDomValue } from '../trace/dom.js';

const escaper = new HtmlEscaper();

/**
 * Compares two class attribute strings as unordered token sets, ignoring extra
 * whitespace and token order, so redundant DOM mutations are skipped when the
 * effective class list is unchanged.
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
function classTokensEqual(a, b) {
  const tokensOf = (value) => {
    if (value == null) return [];
    return Array.from(new Set(String(value).trim().split(/\s+/).filter(Boolean))).sort();
  };
  const aTokens = tokensOf(a);
  const bTokens = tokensOf(b);
  if (aTokens.length !== bTokens.length) {
    return false;
  }
  return aTokens.every((token, index) => token === bTokens[index]);
}

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
   * @param {object} [app] - The application context.
   */
  patch(target, html, resolveExpression, app) {
    const { enableProfiling, componentName } = getComponentProfilingInfo(target);
    profile(enableProfiling, componentName, 'patch', () => {
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

      const prevSession = this.sessionElements;
      const prevRoot = this.patchRoot;
      this.sessionElements = new Set();
      this.patchRoot = target;

      try {
        this.#patchNode(target, newRoot, true, true, resolveExpression, app);
        this.flushLifecycleHooks(app);
      } finally {
        this.sessionElements = prevSession;
        this.patchRoot = prevRoot;
      }
    });
  }

  /**
   * Patches an existing element with a new element structure in-place.
   * @param {Element} oldElement - The existing element.
   * @param {Element} newElement - The new element structure.
   * @param {function(string): any} [resolveExpression] - Function to evaluate expressions.
   * @param {object} [app] - The application context.
   */
  patchElement(oldElement, newElement, resolveExpression, app) {
    const { enableProfiling, componentName } = getComponentProfilingInfo(oldElement);
    profile(enableProfiling, componentName, 'patch', () => {
      this.flattenTransitionTags(newElement);

      const prevSession = this.sessionElements;
      const prevRoot = this.patchRoot;
      this.sessionElements = new Set();
      this.patchRoot = oldElement;

      try {
        this.#patchNode(oldElement, newElement, false, true, resolveExpression, app);
        this.flushLifecycleHooks(app);
      } finally {
        this.sessionElements = prevSession;
        this.patchRoot = prevRoot;
      }
    });
  }

  /**
   * Recursively diffs and patches two nodes.
   * @param {Node} oldNode - The existing DOM node.
   * @param {Node} newNode - The new node structure.
   * @param {boolean} [isBodyWrapper] - Whether the new node is a temporary body wrapper.
   * @param {boolean} [isPatchRoot] - Whether this is the root node of the patching operation.
   * @param {function(string): any} [resolveExpression] - Function to evaluate expressions.
   * @param {object} [app] - The application context.
   * @private
   */
  #patchNode(oldNode, newNode, isBodyWrapper = false, isPatchRoot = false, resolveExpression, app) {
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
          this.#applyDirectives(oldNode, resolveExpression, app);
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
          this.#applyDirectives(oldNode, resolveExpression, app);
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

    if (
      !isPatchRoot &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      newNode.nodeType === Node.ELEMENT_NODE &&
      oldNode.hasAttribute('data-ax-memo') &&
      typeof oldNode.isEqualNode === 'function' &&
      oldNode.isEqualNode(newNode)
    ) {
      return;
    }

    if (
      !isPatchRoot &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      oldNode.hasAttribute('data-ax-deadlock') &&
      typeof oldNode.querySelector === 'function' &&
      oldNode.querySelector('.ax-deadlock-fallback')
    ) {
      return;
    }

    // 1. Update attributes if it's an element (skip if it is the temporary body wrapper)
    let skipChildren = false;
    if (!isBodyWrapper && oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
      this.#patchAttributes(oldNode, newNode);
      if (resolveExpression) {
        skipChildren = this.#applyDirectives(oldNode, resolveExpression, app);
      }
    }

    if (skipChildren) {
      return;
    }

    // 2. Diff children
    const oldChildrenRaw = Array.from(oldNode.childNodes).filter((child) => !child._isLeaving);
    const newChildrenRaw = Array.from(newNode.childNodes);

    const oldChildren = [];
    for (const child of oldChildrenRaw) {
      if (child.nodeType === Node.TEXT_NODE) {
        const last = oldChildren[oldChildren.length - 1];
        if (last && last.nodeType === Node.TEXT_NODE) {
          last.textContent += child.textContent;
          if (child.parentNode) {
            child.parentNode.removeChild(child);
          }
        } else {
          oldChildren.push(child);
        }
      } else {
        oldChildren.push(child);
      }
    }

    const newChildren = [];
    for (const child of newChildrenRaw) {
      if (child.nodeType === Node.TEXT_NODE) {
        const last = newChildren[newChildren.length - 1];
        if (last && last.nodeType === Node.TEXT_NODE) {
          last.textContent += child.textContent;
          if (child.parentNode) {
            child.parentNode.removeChild(child);
          }
        } else {
          newChildren.push(child);
        }
      } else {
        newChildren.push(child);
      }
    }

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
        const prepared = this.#prepareNode(newChild, isParentSvg, resolveExpression, app);
        oldNode.appendChild(prepared);
        if (tracer.on) {
          traceDomOp('insert', prepared, { into: oldNode.tagName && oldNode.tagName.toLowerCase() });
        }
        this.triggerEnter(prepared, resolveExpression);
      } else if (this.#isSameNodeType(oldChild, newChild)) {
        // Nodes are same type, patch them
        if (oldChild.nodeType === Node.TEXT_NODE) {
          if (oldChild.textContent !== newChild.textContent) {
            const previousText = oldChild.textContent;
            oldChild.textContent = newChild.textContent;
            if (tracer.on) {
              traceDomOp('text', oldChild, {
                from: clampDomValue(previousText),
                to: clampDomValue(newChild.textContent),
              });
            }
          }
        } else {
          this.#patchNode(oldChild, newChild, false, false, resolveExpression, app);
        }
        oldIndex++;
      } else {
        // Nodes are different, replace
        const isParentSvg =
          oldNode &&
          oldNode.nodeType === Node.ELEMENT_NODE &&
          (oldNode.namespaceURI === 'http://www.w3.org/2000/svg' || oldNode.tagName.toLowerCase() === 'svg');
        const prepared = this.#prepareNode(newChild, isParentSvg, resolveExpression, app);

        const transitionName = this.getTransitionName(oldChild, resolveExpression);
        if (transitionName) {
          oldNode.insertBefore(prepared, oldChild);
          this.triggerLeave(oldChild, resolveExpression, () => {
            if (oldChild.parentNode === oldNode) {
              if (tracer.on) {
                traceDomOp('remove', oldChild);
              }
              oldNode.removeChild(oldChild);
            }
          }, app);
        } else {
          this.triggerUnmounted(oldChild, app);
          if (tracer.on) {
            traceDomOp('replace', oldChild, { with: prepared.nodeName && prepared.nodeName.toLowerCase() });
          }
          oldNode.replaceChild(prepared, oldChild);
        }
        this.triggerEnter(prepared, resolveExpression);
        oldIndex++;
      }
      newIndex++;
    }

    // Re-sync select value after dynamic options are patched.
    if (
      oldNode.nodeType === Node.ELEMENT_NODE &&
      oldNode.nodeName === 'SELECT' &&
      newNode.nodeType === Node.ELEMENT_NODE
    ) {
      const valueAttr = newNode.getAttribute('value');

      if (valueAttr !== null && oldNode.value !== valueAttr) {
        oldNode.value = valueAttr;
      }
    }

    // Remove remaining old children (that are not managed by ListManager)
    while (oldIndex < oldChildren.length) {
      const oldChild = oldChildren[oldIndex];
      if (!(oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item'))) {
        this.triggerLeave(oldChild, resolveExpression, () => {
          if (oldChild.parentNode === oldNode) {
            if (tracer.on) {
              traceDomOp('remove', oldChild);
            }
            oldNode.removeChild(oldChild);
          }
        }, app);
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

    // Track dynamic attribute names for clean attribute removal when dynamic attribute names change
    const newDynAttrStr = newNode.getAttribute ? newNode.getAttribute('data-ax-dyn-attrs') : null;
    const newDynAttrs = newDynAttrStr !== null ? newDynAttrStr.split(',').filter(Boolean) : null;

    let prevDynAttrs = oldNode.__avenxDynAttrs || [];
    if (oldNode.getAttribute && oldNode.hasAttribute('data-ax-dyn-attrs')) {
      const attrVal = oldNode.getAttribute('data-ax-dyn-attrs');
      const fromAttr = attrVal ? attrVal.split(',').filter(Boolean) : [];
      prevDynAttrs = Array.from(new Set([...prevDynAttrs, ...fromAttr]));
    }

    if (newDynAttrs !== null) {
      for (const oldDynName of prevDynAttrs) {
        if (!newDynAttrs.includes(oldDynName)) {
          if (oldNode.hasAttribute(oldDynName)) {
            oldNode.removeAttribute(oldDynName);
            if (isBooleanAttribute(oldDynName)) {
              oldNode[oldDynName] = false;
            }
          }
        }
      }
      oldNode.__avenxDynAttrs = newDynAttrs;
    }

    // Remove old attributes that are gone
    for (let i = oldAttrs.length - 1; i >= 0; i--) {
      const attr = oldAttrs[i];
      if (!newNode.hasAttribute(attr.name)) {
        oldNode.removeAttribute(attr.name);
        if (tracer.on) {
          traceDomOp('remove-attr', oldNode, { name: attr.name, from: clampDomValue(attr.value) });
        }
        if (isBooleanAttribute(attr.name)) {
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
      const isBoolean = isBooleanAttribute(attr.name);

      if (isBoolean) {
        const isFalsy = attr.value === 'false' || attr.value === null || attr.value === undefined;
        if (isFalsy) {
          if (oldNode.hasAttribute(attr.name)) {
            oldNode.removeAttribute(attr.name);
          }
          oldNode[attr.name] = false;
        } else {
          if (oldNode.getAttribute(attr.name) !== attr.value) {
            const previous = oldNode.getAttribute(attr.name);
            oldNode.setAttribute(attr.name, attr.value);
            if (tracer.on) {
              traceDomOp('attr', oldNode, {
                name: attr.name,
                from: clampDomValue(previous),
                to: clampDomValue(attr.value),
              });
            }
          }
          oldNode[attr.name] = true;
        }
      } else {
        const oldValue = oldNode.getAttribute(attr.name);
        const shouldUpdate =
          attr.name === 'class' ? !classTokensEqual(oldValue, attr.value) : oldValue !== attr.value;
        if (shouldUpdate) {
          oldNode.setAttribute(attr.name, attr.value);
          if (tracer.on) {
            traceDomOp('attr', oldNode, {
              name: attr.name,
              from: clampDomValue(oldValue),
              to: clampDomValue(attr.value),
            });
          }
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
        if (isBooleanAttribute(attr.name)) {
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
      if (isBooleanAttribute(attr.name)) {
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
   * @param {object} [app] - The application context.
   * @returns {Node} The prepared node.
   * @private
   */
  #prepareNode(node, isSvg = false, resolveExpression, app) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      if (tagName === 'template' || tagName === '@for') {
        return node;
      }
      const currentIsSvg = isSvg || tagName === 'svg';

      let skipChildren = false;
      if (resolveExpression) {
        skipChildren = this.#applyDirectives(node, resolveExpression, app);
      }

      if (currentIsSvg) {
        if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
          this.#cleanBooleanAttributesForNode(node);
          if (!skipChildren) {
            const children = Array.from(node.childNodes);
            for (const child of children) {
              this.#prepareNode(child, currentIsSvg, resolveExpression, app);
            }
          }
          return node;
        } else {
          const svgElement = document.createElementNS('http://www.w3.org/2000/svg', tagName);
          const attrs = node.attributes;
          if (attrs) {
            for (let i = 0; i < attrs.length; i++) {
              const attr = attrs[i];
              const isBoolean = isBooleanAttribute(attr.name);
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
            this.#applyDirectives(svgElement, resolveExpression, app);
          }
          if (!skipChildren) {
            const children = Array.from(node.childNodes);
            for (const child of children) {
              svgElement.appendChild(this.#prepareNode(child, currentIsSvg, resolveExpression, app));
            }
          }
          return svgElement;
        }
      } else {
        this.#cleanBooleanAttributesForNode(node);
        if (!skipChildren) {
          const children = Array.from(node.childNodes);
          for (const child of children) {
            this.#prepareNode(child, false, resolveExpression, app);
          }
        }
        return node;
      }
    }
    return node;
  }

  /**
   * Resolves the slot scope for an element by traversing up the DOM tree.
   * @param {Element} el
   * @returns {object|null}
   * @private
   */
  #getSlotScope(el) {
    let current = el;
    while (current) {
      if (current.__avenx_slot_scope) {
        return current.__avenx_slot_scope;
      }
      current = current.parentNode;
    }
    return null;
  }

  /**
   * Evaluates and applies directives on a single element.
   * @param {Element} el - The element to evaluate directives on.
   * @param {function(string): any} resolveExpression - The expression evaluator.
   * @param {object} [app] - The application context.
   * @returns {boolean} Whether children evaluation/diffing should be skipped.
   * @private
   */
  #applyDirectives(el, resolveExpression, app) {
    if (!resolveExpression || el.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const slotScope = this.#getSlotScope(el);
    const localResolve = slotScope ? (expr) => resolveExpression(expr, slotScope) : resolveExpression;
    let skipChildren = false;

    // 1. data-ax-html
    if (el.hasAttribute('data-ax-html')) {
      const expr = el.getAttribute('data-ax-html');
      try {
        const value = localResolve(expr);
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
        const value = !!localResolve(expr);
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
        const value = localResolve(expr);
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

    // 4. Dynamic Attribute Name Binding (:[attrName]="attrValue")
    const elAttrs = Array.from(el.attributes || []);
    const currentDynAttrs = [];
    for (const attr of elAttrs) {
      const match = attr.name.match(/^:\[(.*)\]$/);
      if (match) {
        const nameExpr = match[1];
        const valExpr = attr.value;
        let resolvedName = null;
        try {
          resolvedName = localResolve(nameExpr);
        } catch (err) {
          logger.warn(`Failed to evaluate dynamic attribute name expression "${nameExpr}": ${err.message || err}`);
        }

        if (resolvedName != null && String(resolvedName).trim() !== '') {
          const attrName = String(resolvedName).trim();
          let resolvedVal = null;
          if (valExpr) {
            try {
              resolvedVal = localResolve(valExpr);
            } catch (err) {
              logger.warn(`Failed to evaluate dynamic attribute value expression "${valExpr}": ${err.message || err}`);
            }
          }

          if (resolvedVal !== false && resolvedVal != null) {
            currentDynAttrs.push(attrName);
            if (resolvedVal === true) {
              el.setAttribute(attrName, 'true');
              if (isBooleanAttribute(attrName)) {
                el[attrName] = true;
              }
            } else {
              el.setAttribute(attrName, String(resolvedVal));
            }
          } else {
            currentDynAttrs.push(attrName);
            if (el.hasAttribute(attrName)) {
              el.removeAttribute(attrName);
              if (isBooleanAttribute(attrName)) {
                el[attrName] = false;
              }
            }
          }
        }
        el.removeAttribute(attr.name);
      }
    }

    const prevDynAttrs = el.__avenxDynAttrs || [];
    for (const oldName of prevDynAttrs) {
      if (!currentDynAttrs.includes(oldName)) {
        if (el.hasAttribute(oldName)) {
          el.removeAttribute(oldName);
          if (isBooleanAttribute(oldName)) {
            el[oldName] = false;
          }
        }
      }
    }
    if (currentDynAttrs.length > 0 || prevDynAttrs.length > 0) {
      el.__avenxDynAttrs = currentDynAttrs;
    }

    // 5. Custom Directives
    if (app && app.directives) {
      const attrs = Array.from(el.attributes || []);
      for (const attr of attrs) {
        if (attr.name.startsWith('data-ax-')) {
          // Split dot-notation modifiers off the directive name, mirroring the
          // event modifier convention in core/events/bindEvents.js.
          const attrKey = attr.name.slice(8);
          const parts = attrKey.split('.');
          const dirName = parts[0];
          // Ignore built-in core directives
          if (
            dirName === 'show' ||
            dirName === 'class' ||
            dirName === 'html' ||
            dirName === 'static' ||
            dirName === 'transition' ||
            dirName === 'for' ||
            dirName === 'as' ||
            dirName === 'key' ||
            dirName === 'list-item' ||
            dirName === 'key-val' ||
            dirName === 'validate' ||
            dirName === 'validate-messages'
          ) {
            continue;
          }
          if (app.directives.has(dirName)) {
            const expr = attr.value;
            let value;
            if (expr) {
              try {
                value = localResolve(expr);
              } catch (err) {
                logger.warn(
                  `Failed to evaluate custom directive ${dirName} expression "${expr}": ${err.message || err}`
                );
              }
            }

            if (!el.__avenx_directives) {
              el.__avenx_directives = new Map();
            }

            // Keyed by the full attribute suffix so that two modifier variants of
            // the same directive on one element do not overwrite each other.
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
                // The directive value has not changed.
                // Make sure a previous update flag cannot trigger
                // another updated() lifecycle call.
                oldInfo.valueChanged = false;
              }
            }

            if (this.sessionElements) {
              this.sessionElements.add(el);
            }
          }
        }
      }
    }

    return skipChildren;
  }

  /**
   * Recursively applies custom directives to an element and its children.
   * @param {Element} element - The element tree root.
   * @param {function(string): any} resolveExpression - The expression evaluator.
   * @param {object} [app] - The application context.
   */
  applyDirectives(element, resolveExpression, app) {
    const prevSession = this.sessionElements;
    const prevRoot = this.patchRoot;
    this.sessionElements = new Set();
    this.patchRoot = element;

    try {
      this.applyDirectivesInternal(element, resolveExpression, app);
      this.flushLifecycleHooks(app);
    } finally {
      this.sessionElements = prevSession;
      this.patchRoot = prevRoot;
    }
  }

  /**
   * Recursively applies directives to an element and its children.
   * @param {Element} element - The target element.
   * @param {Function} resolveExpression - Expression resolver callback.
   * @param {object} [app] - The application context.
   */
  applyDirectivesInternal(element, resolveExpression, app) {
    const skip = this.#applyDirectives(element, resolveExpression, app);
    if (!skip) {
      const children = Array.from(element.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          this.applyDirectivesInternal(child, resolveExpression, app);
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
    const slotScope = this.#getSlotScope(el);
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
   * Triggers the leave transition or asynchronous unmounting of an element.
   * @param {Element} el - The element leaving.
   * @param {Function} resolveExpression - Expression evaluator callback.
   * @param {Function} removeCallback - Callback to remove element from DOM.
   * @param {object} [app] - The application context.
   */
  triggerLeave(el, resolveExpression, removeCallback, app) {
    if (el.nodeType !== Node.ELEMENT_NODE) {
      if (removeCallback) removeCallback();
      return;
    }

    const compInstance = el.__avenx_comp_instance;
    const proceedWithRemoval = () => {
      const done = () => {
        this.triggerUnmounted(el, app);
        if (removeCallback) removeCallback();
      };
      const transitionName = el._transitionName || this.getTransitionName(el, resolveExpression);
      if (transitionName) {
        this.leave(el, transitionName, done);
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

  /**
   * Checks if a node is in the currently patched DOM tree.
   * @param {Element} el
   * @returns {boolean}
   */
  isNodeInPatchTree(el) {
    if (!this.patchRoot) return false;
    let curr = el;
    while (curr) {
      if (curr === this.patchRoot) return true;
      curr = curr.parentNode || (curr.host && curr.host.nodeType === 1 ? curr.host : null);
    }
    return false;
  }

  /**
   * Triggers the unmounted hook recursively on a node and its descendants.
   * @param {Node} node
   * @param {object} app
   */
  triggerUnmounted(node, app) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    const descendants = Array.from(node.querySelectorAll('*'));
    for (const desc of descendants) {
      this.triggerUnmountedForElement(desc, app);
    }
    this.triggerUnmountedForElement(node, app);
  }

  /**
   * Triggers the unmounted hook on a single element.
   * @param {Element} el
   * @param {object} app
   */
  triggerUnmountedForElement(el, app) {
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
   * Flushes all lifecycle hooks collected during the patch session.
   * @param {object} app
   */
  flushLifecycleHooks(app) {
    if (!this.sessionElements || !app) return;
    for (const el of this.sessionElements) {
      if (!el.__avenx_directives) continue;

      const isConnected = this.isNodeInPatchTree(el);
      if (isConnected) {
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
        this.triggerUnmounted(el, app);
      }
    }
  }
}
