import { stampScope } from '../../renderer/bindingScope.js';
import { restoreScopedSlotInterpolations } from '../../utils/templateUtils.js';
import { logger } from '../AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../AvenxError.js';

/**
 * Slot helpers for checking whether the parent provided content for a slot.
 * Available after mount target setup populates `#transcludedGroups`.
 * @param {object|null} groups - Passed default and named children.
 * @returns {object}
 */
export function slotContents(groups) {
  return {
    /**
     * @param {string} [slotName] Named slot, or `default` / empty for the default slot.
     * @returns {boolean}
     */
    has(slotName = 'default') {
      if (!groups) return false;
      const name = !slotName || slotName === 'default' ? null : slotName;
      if (!name) {
        return Array.isArray(groups.default) && groups.default.length > 0;
      }
      const nodes = groups.named?.[name];
      return Array.isArray(nodes) && nodes.length > 0;
    },
  };
}

/**
 * Resolves the current name of a slot element.
 * Dynamic slot names are evaluated during template rendering, so the
 * rendered name attribute contains the value used for transclusion.
 * @param {Element} slotEl - The slot element.
 * @returns {string|null} The resolved slot name.
 */
export function resolveSlotName(slotEl) {
  const name = slotEl.getAttribute('name');
  return name && name.trim() ? name.trim() : null;
}

/**
 * Retrieves slot elements belonging to this component.
 * @param {Element|null} element - Component host.
 * @returns {Element[]}
 */
export function getOwnSlots(element) {
  if (!element) return [];

  const slots = element.querySelectorAll('slot');
  const root = element;

  return Array.from(slots).filter((slot) => {
    let parent = slot.parentNode;

    while (parent && parent !== root) {
      if (
        parent.hasAttribute &&
        (parent.hasAttribute('data-avenx-comp') || parent.hasAttribute('data-avenx-comp-dynamic'))
      ) {
        return false;
      }

      parent = parent.parentNode;
    }

    return true;
  });
}

/**
 * Records each slot's declared fallback children before anything fills it.
 *
 * Called once, from the compiled render path, while the skeleton's own
 * children are still in the outlet. After `#fillSlots` has run, the outlet
 * holds whatever the parent projected and the fallback is unrecoverable from
 * the DOM -- which is why the string path has to re-render the template and
 * parse the result to find it again.
 * @param {Element|null} element - Component host.
 */
export function captureSlotFallbacks(element) {
  if (!element) return;
  for (const slotEl of getOwnSlots(element)) {
    if (slotEl.__avenxFallback) continue;
    slotEl.__avenxFallback = Array.from(slotEl.childNodes).map((child) => child.cloneNode(true));
  }
}

/**
 * Retrieves the fallback children declared for a slot.
 * @param {Element|null} element - Component host.
 * @param {string|null} name - The name of the slot.
 * @param {Function} render - Renders the current fallback template.
 * @param {object} logContext - Diagnostic context.
 * @returns {Node[]} Cloned child nodes.
 */
export function getDefaultSlotChildren(element, name, render, logContext) {
  // A compiled component captured its fallbacks from the skeleton at mount,
  // so the answer is already a list of nodes. The round trip below exists
  // only for the string path, which has no other record of them.
  const captured = getOwnSlots(element).find((slotEl) => {
    const slotName = resolveSlotName(slotEl);
    return (name ? slotName === name : !slotName) && slotEl.__avenxFallback;
  });
  if (captured) {
    return captured.__avenxFallback.map((child) => child.cloneNode(true));
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(render(), 'text/html');
    const rootDoc = doc.body || doc;

    const defaultSlot = Array.from(rootDoc.querySelectorAll('slot')).find((s) => {
      const sName = resolveSlotName(s);
      return name ? sName === name : !sName;
    });

    if (defaultSlot) {
      return Array.from(defaultSlot.childNodes).map((child) => child.cloneNode(true));
    }
  } catch (e) {
    logger.warn(
      formatMessage(AvenxErrorCodes.COMPONENT_RESTORE_SLOT_CONTENT_FAILED, e.message || e),
      logContext,
    );
  }
  return [];
}

/**
 * Fills <slot> elements with transcluded child nodes.
 * Supports both static and dynamically rendered slot names.
 * @param {Element|null} element - Component host.
 * @param {object|null} groups - Passed children.
 * @param {Function} renderScoped - Renders one scoped outlet.
 * @param {Function} getFallback - Retrieves cloned fallback children.
 */
export function fillSlots(element, groups, renderScoped, getFallback) {
  if (!element || !groups) return;

  const slots = getOwnSlots(element);

  slots.forEach((slotEl) => {
    const name = resolveSlotName(slotEl);

    const nodes = name ? groups.named[name] || [] : groups.default || [];

    const hasContent = nodes.some((node) => {
      if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
      if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
      return false;
    });

    if (hasContent) {
      slotEl.innerHTML = '';

      const templateEl = nodes.find(
        (node) =>
          node.nodeType === 1 && node.tagName.toLowerCase() === 'template' && node.hasAttribute('data-slot-props'),
      );

      if (templateEl) {
        const renderedNodes = renderScoped(slotEl, templateEl);
        renderedNodes.forEach((node) => {
          slotEl.appendChild(node);
        });
      } else {
        nodes.forEach((node) => {
          slotEl.appendChild(node);
        });
      }

      slotEl.setAttribute('data-avenx-transcluded', 'true');
    } else if (slotEl.hasAttribute('data-avenx-transcluded')) {
      // Only when the outlet actually held projected content. Rebuilding it
      // unconditionally replaced the fallback with *clones* of itself, and on
      // the compiled path the bindings still pointed at the originals -- so a
      // slot showing its fallback rendered once and then went stale, writing
      // every later value into a detached node.
      //
      // When nothing was ever projected, the fallback in the outlet is the
      // one the renderer produced and is already live. Leaving it alone is
      // both cheaper and the only correct thing to do.
      slotEl.removeAttribute('data-avenx-transcluded');
      slotEl.innerHTML = '';
      getFallback(name).forEach((child) => {
        slotEl.appendChild(child);
      });
    }
  });
}

/**
 * Renders the content of a scoped slot template using child-exposed properties
 * merged into the parent component's evaluation scope.
 * @param {Element} slotEl - The slot element.
 * @param {Element} templateEl - The transcluded template element.
 * @param {Function} evaluate - Evaluates exposed child expressions.
 * @param {Function} renderParent - Renders in the parent's scope, returning HTML and its evaluator.
 * @param {Function} applyDirectives - Applies directives to a rendered root.
 * @returns {Node[]} Array of rendered and tagged child nodes.
 */
export function renderScopedSlot(slotEl, templateEl, evaluate, renderParent, applyDirectives) {
  const slotPropsName = templateEl.getAttribute('data-slot-props');
  if (!slotPropsName) return [];

  const exposedProps = {};
  for (const attr of slotEl.attributes) {
    if (attr.name.startsWith(':')) {
      const propName = attr.name.slice(1);
      exposedProps[propName] = evaluate(attr.value);
    } else if (attr.name.startsWith('data-props-')) {
      const propName = attr.name.slice('data-props-'.length);
      exposedProps[propName] = evaluate(attr.value);
    }
  }

  const extraScope = { [slotPropsName]: exposedProps };
  // innerHTML encodes operators in text expressions. Restore one level only
  // inside the placeholders, leaving literal markup and entity strings inert.
  const templateHtml = restoreScopedSlotInterpolations(templateEl.innerHTML);

  const parent = renderParent(templateHtml, extraScope);
  const renderedHtml = parent.html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(renderedHtml, 'text/html');
  const nodes = Array.from((doc.body || doc).childNodes);

  // Only the roots need stamping: resolution walks up from wherever a binding
  // sits, so marking every descendant was redundant work proportional to the
  // size of the slot's content.
  nodes.forEach((node) => stampScope(node, extraScope));

  nodes.forEach((node) => {
    if (node.nodeType === 1) {
      applyDirectives(node, parent.evaluate);
    }
  });

  return nodes;
}

/**
 * Groups passed children without cloning them.
 * @param {NodeList|Array} virtualChildNodes - Passed nodes.
 * @returns {object} Default and named groups.
 */
export function groupSlotChildren(virtualChildNodes) {
  const grouped = {
    default: [],
    named: Object.create(null),
  };

  Array.from(virtualChildNodes || []).forEach((node) => {
    const name = node.nodeType === 1 ? (node.getAttribute('slot') || '').trim() : '';
    const group = name ? (grouped.named[name] ||= []) : grouped.default;

    // A slot <template> groups multiple projected children; its own DOM node
    // is inert. Scoped templates keep their wrapper so the slot can evaluate
    // its contents with the declared child-prop scope.
    if (
      node.nodeType === 1 &&
      node.tagName.toLowerCase() === 'template' &&
      node.hasAttribute('slot') &&
      !node.hasAttribute('data-slot-props')
    ) {
      group.push(...Array.from((node.content || node).childNodes));
    } else {
      group.push(node);
    }
  });

  return grouped;
}

/**
 * Updates the transcluded content when the parent template updates.
 * @param {Element|null} element - Component host.
 * @param {object} grouped - New passed children, grouped by outlet name.
 * @param {object} callbacks - Scoped rendering, fallback, evaluation and patch operations.
 */
export function updateSlotContent(element, grouped, callbacks) {
  const { renderScoped, getFallback, evaluate, evaluateParent, resolveExpression, patchElement } = callbacks;

  if (element) {
    const slots = getOwnSlots(element);

    slots.forEach((slotEl) => {
      const name = resolveSlotName(slotEl);

      const newChildren = name ? grouped.named[name] || [] : grouped.default || [];

      const newSlotWrapper = slotEl.cloneNode(false);

      const templateEl = newChildren.find(
        (node) =>
          node.nodeType === 1 && node.tagName.toLowerCase() === 'template' && node.hasAttribute('data-slot-props'),
      );

      let finalChildren = newChildren;
      let isScoped = false;
      if (templateEl) {
        finalChildren = renderScoped(slotEl, templateEl);
        isScoped = true;
      }

      if (isScoped) {
        finalChildren.forEach((child) => {
          newSlotWrapper.appendChild(child);
        });
      } else {
        finalChildren.forEach((child) => {
          newSlotWrapper.appendChild(child.cloneNode(true));
        });
      }

      const hasContent = finalChildren.some((node) => {
        if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
        if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
        return false;
      });

      if (hasContent) {
        newSlotWrapper.setAttribute('data-avenx-transcluded', 'true');
      } else {
        newSlotWrapper.removeAttribute('data-avenx-transcluded');
        getFallback(name).forEach((child) => {
          newSlotWrapper.appendChild(child);
        });
      }

      const slotEvaluator = (expr) => {
        if (isScoped && templateEl) {
          const slotPropsName = templateEl.getAttribute('data-slot-props');
          const exposedProps = {};
          for (const attr of slotEl.attributes) {
            if (attr.name.startsWith(':')) {
              const propName = attr.name.slice(1);
              exposedProps[propName] = evaluate(attr.value);
            } else if (attr.name.startsWith('data-props-')) {
              const propName = attr.name.slice('data-props-'.length);
              exposedProps[propName] = evaluate(attr.value);
            }
          }
          const extraScope = { [slotPropsName]: exposedProps };
          return evaluateParent(expr, extraScope);
        }
        return resolveExpression(expr);
      };

      patchElement(slotEl, newSlotWrapper, slotEvaluator);
    });
  }
}
