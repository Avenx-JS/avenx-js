import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { logger } from '../runtime/AvenxLogger.js';

/**
 * A set of known HTML boolean attributes.
 * @type {Set<string>}
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'checked',
  'disabled',
  'required',
  'readonly',
  'selected',
  'multiple',
  'autofocus',
  'novalidate',
  'formnovalidate',
  'hidden',
  'open',
  'reversed',
  'loop',
  'controls',
  'autoplay',
  'muted',
  'default',
  'ismap',
  'async',
  'defer',
]);

/**
 * Handles patching the DOM with new HTML content using a simple diffing algorithm.
 * This approach is more efficient than innerHTML as it preserves existing DOM nodes.
 */
export class DomPatcher {
  /**
   * Patches the target element with the provided HTML.
   * @param {Element} target - The element to patch.
   * @param {string} html - The new HTML content.
   */
  patch(target, html) {
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

    this.#patchNode(target, newRoot, true, true);
  }

  /**
   * Patches an existing element with a new element structure in-place.
   * @param {Element} oldElement - The existing element.
   * @param {Element} newElement - The new element structure.
   */
  patchElement(oldElement, newElement) {
    this.#patchNode(oldElement, newElement, false, true);
  }

  /**
   * Recursively diffs and patches two nodes.
   * @param {Node} oldNode - The existing DOM node.
   * @param {Node} newNode - The new node structure.
   * @param {boolean} [isBodyWrapper] - Whether the new node is a temporary body wrapper.
   * @param {boolean} [isPatchRoot] - Whether this is the root node of the patching operation.
   * @private
   */
  #patchNode(oldNode, newNode, isBodyWrapper = false, isPatchRoot = false) {
    if (
      !isPatchRoot &&
      oldNode.nodeType === Node.ELEMENT_NODE &&
      oldNode.nodeName === 'SLOT' &&
      oldNode.hasAttribute('data-avenx-transcluded')
    ) {
      if (newNode.nodeType === Node.ELEMENT_NODE) {
        this.#patchAttributes(oldNode, newNode);
        oldNode.setAttribute('data-avenx-transcluded', 'true');
      }
      return;
    }

    if (!isPatchRoot && oldNode.nodeType === Node.ELEMENT_NODE && oldNode.hasAttribute('data-avenx-comp')) {
      if (newNode.nodeType === Node.ELEMENT_NODE) {
        this.#patchAttributes(oldNode, newNode);
        const compInstance = oldNode.__avenx_comp_instance;
        if (compInstance && typeof compInstance.__updateTranscludedContent === 'function') {
          compInstance.__updateTranscludedContent(newNode.childNodes);
        }
      }
      return;
    }

    if (!isPatchRoot && oldNode.nodeType === Node.ELEMENT_NODE && oldNode.hasAttribute('data-ax-static')) {
      return;
    }

    // 1. Update attributes if it's an element (skip if it is the temporary body wrapper)
    if (!isBodyWrapper && oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
      this.#patchAttributes(oldNode, newNode);
    }

    // 2. Diff children
    const oldChildren = Array.from(oldNode.childNodes);
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
        oldNode.appendChild(this.#prepareNode(newChild, isParentSvg));
      } else if (this.#isSameNodeType(oldChild, newChild)) {
        // Nodes are same type, patch them
        if (oldChild.nodeType === Node.TEXT_NODE) {
          if (oldChild.textContent !== newChild.textContent) {
            oldChild.textContent = newChild.textContent;
          }
        } else {
          this.#patchNode(oldChild, newChild);
        }
        oldIndex++;
      } else {
        // Nodes are different, replace
        const isParentSvg =
          oldNode &&
          oldNode.nodeType === Node.ELEMENT_NODE &&
          (oldNode.namespaceURI === 'http://www.w3.org/2000/svg' || oldNode.tagName.toLowerCase() === 'svg');
        oldNode.replaceChild(this.#prepareNode(newChild, isParentSvg), oldChild);
        oldIndex++;
      }
      newIndex++;
    }

    // Remove remaining old children (that are not managed by ListManager)
    while (oldIndex < oldChildren.length) {
      const oldChild = oldChildren[oldIndex];
      if (!(oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item'))) {
        oldNode.removeChild(oldChild);
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
   * @returns {Node} The prepared node.
   * @private
   */
  #prepareNode(node, isSvg = false) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      const currentIsSvg = isSvg || tagName === 'svg';

      if (currentIsSvg) {
        if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
          this.#cleanBooleanAttributesForNode(node);
          const children = Array.from(node.childNodes);
          for (const child of children) {
            this.#prepareNode(child, currentIsSvg);
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
          const children = Array.from(node.childNodes);
          for (const child of children) {
            svgElement.appendChild(this.#prepareNode(child, currentIsSvg));
          }
          return svgElement;
        }
      } else {
        this.#cleanBooleanAttributesForNode(node);
        const children = Array.from(node.childNodes);
        for (const child of children) {
          this.#prepareNode(child, false);
        }
        return node;
      }
    }
    return node;
  }
}
