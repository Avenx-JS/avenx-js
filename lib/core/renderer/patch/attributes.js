/**
 * @file attributes.js
 * @description Attribute diffing, boolean attribute normalization, class-token comparison, and URL sanitization.
 *
 * ## What this module owns
 *
 * This collaborator handles DOM attribute mutation and synchronization during rendering:
 * - Compares class attribute tokens as unordered sets to skip redundant DOM writes.
 * - Enforces security by sanitizing URL attributes across newly parsed render trees.
 * - Normalizes and cleans boolean attributes so that falsy values remove attributes and clear properties.
 * - Diffing and patching attribute sets between existing DOM elements and newly rendered nodes,
 *   including dynamic attribute name tracking (`data-ax-dyn-attrs`) and form control value synchronization.
 * - Normalizing text child nodes and preparing new nodes for DOM insertion.
 *
 * All operations take explicit element arguments with no hidden state or circular references.
 * @module lib/core/renderer/patch/attributes
 */

import { isBooleanAttribute } from '../constants.js';
import { VALUE_PROPERTY_TAGS, syncControlValue } from '../controlValue.js';
import { sanitizeUrlAttribute, isUrlAttribute } from '../../security/urlPolicy.js';
import { tracer } from '../../trace/tracer.js';
import { traceDomOp, clampDomValue } from '../../trace/dom.js';

/**
 * Compares two class attribute strings as unordered token sets.
 * @param {string|null} a - The first class attribute string.
 * @param {string|null} b - The second class attribute string.
 * @returns {boolean} True if both strings normalize to the same token set.
 */
export function classTokensEqual(a, b) {
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
 * Applies the URL policy to every URL-bearing attribute in a parsed tree.
 * @param {Element} root - The root of the freshly parsed render output.
 */
export function sanitizeUrlsIn(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return;
  }
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of elements) {
    if (!el || !el.attributes || typeof el.setAttribute !== 'function') continue;
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (!isUrlAttribute(attr.name)) continue;
      const safe = sanitizeUrlAttribute(attr.name, attr.value);
      if (safe !== attr.value) {
        el.setAttribute(attr.name, safe);
      }
    }
  }
}

/**
 * Cleans boolean attributes of a single element in-place.
 * @param {Element} el - The element to clean.
 */
export function cleanBooleanAttributesForNode(el) {
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
 * Recursively finds and cleans boolean attributes that evaluate to false in a subtree.
 * @param {Element} element - The root element to clean.
 */
export function cleanBooleanAttributes(element) {
  const elements = [element, ...element.querySelectorAll('*')];
  for (const el of elements) {
    cleanBooleanAttributesForNode(el);
  }
}

/**
 * Cleans an element by removing boolean attributes that evaluate to false.
 * @param {Element} element - The element to clean.
 * @param {function(Element): void} [flattenTransitions] - Optional callback to flatten transition tags.
 * @returns {Element} The cleaned element.
 */
export function cleanElement(element, flattenTransitions) {
  if (element && element.nodeType === Node.ELEMENT_NODE) {
    if (typeof flattenTransitions === 'function') {
      flattenTransitions(element);
    }
    cleanBooleanAttributes(element);
  }
  return element;
}

/**
 * Merges adjacent text nodes in a child list to normalize text diffing.
 * @param {Node[]} rawNodes - Raw child nodes.
 * @returns {Node[]} Normalized child list.
 */
export function mergeAdjacentTextNodes(rawNodes) {
  const result = [];
  for (const child of rawNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const last = result[result.length - 1];
      if (last && last.nodeType === Node.TEXT_NODE) {
        last.textContent += child.textContent;
        if (child.parentNode) child.parentNode.removeChild(child);
      } else {
        result.push(child);
      }
    } else {
      result.push(child);
    }
  }
  return result;
}

/**
 * Prepares a node for insertion into the DOM.
 * @param {Node} node - The node to prepare.
 * @param {boolean} [isSvg] - Whether within an SVG context.
 * @param {function(string, object=): any} [resolveExpression] - Expression evaluator.
 * @param {object} [app] - Application context.
 * @param {function(Node, function(string, object=): any, object=): boolean} [applyDirectives] - Directive applicator.
 * @returns {Node} The prepared node.
 */
export function prepareNode(node, isSvg = false, resolveExpression, app, applyDirectives) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return node;
  const tagName = node.tagName.toLowerCase();
  if (tagName === 'template' || tagName === '@for') return node;
  const currentIsSvg = isSvg || tagName === 'svg';
  const skipChildren =
    resolveExpression && typeof applyDirectives === 'function' ? applyDirectives(node, resolveExpression, app) : false;

  if (currentIsSvg && node.namespaceURI !== 'http://www.w3.org/2000/svg') {
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', tagName);
    for (const attr of Array.from(node.attributes || [])) {
      const isBool = isBooleanAttribute(attr.name);
      const isFalsy = attr.value === 'false' || attr.value === null || attr.value === undefined;
      if (isBool && isFalsy) {
        svgEl[attr.name] = false;
      } else {
        svgEl.setAttribute(attr.name, sanitizeUrlAttribute(attr.name, attr.value));
        if (isBool) svgEl[attr.name] = true;
      }
    }
    if (resolveExpression && typeof applyDirectives === 'function') {
      applyDirectives(svgEl, resolveExpression, app);
    }
    if (!skipChildren) {
      for (const child of Array.from(node.childNodes)) {
        svgEl.appendChild(prepareNode(child, currentIsSvg, resolveExpression, app, applyDirectives));
      }
    }
    return svgEl;
  }

  cleanBooleanAttributesForNode(node);
  if (!skipChildren) {
    for (const child of Array.from(node.childNodes)) {
      prepareNode(child, currentIsSvg, resolveExpression, app, applyDirectives);
    }
  }
  return node;
}

/**
 * Syncs attributes from newNode to oldNode.
 * @param {Element} oldNode - The existing DOM element.
 * @param {Element} newNode - The newly parsed element structure.
 */
export function patchAttributes(oldNode, newNode) {
  const oldAttrs = oldNode.attributes;
  const newAttrs = newNode.attributes;

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
      if (attr.name === 'value' && VALUE_PROPERTY_TAGS.has(oldNode.nodeName)) {
        syncControlValue(oldNode, '');
      }
    }
  }

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
          oldNode.setAttribute(attr.name, sanitizeUrlAttribute(attr.name, attr.value));
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
      const shouldUpdate = attr.name === 'class' ? !classTokensEqual(oldValue, attr.value) : oldValue !== attr.value;
      if (shouldUpdate) {
        oldNode.setAttribute(attr.name, sanitizeUrlAttribute(attr.name, attr.value));
        if (tracer.on) {
          traceDomOp('attr', oldNode, {
            name: attr.name,
            from: clampDomValue(oldValue),
            to: clampDomValue(attr.value),
          });
        }
      }
      if (attr.name === 'value' && VALUE_PROPERTY_TAGS.has(oldNode.nodeName)) {
        syncControlValue(oldNode, attr.value);
      }
    }
  }
}
