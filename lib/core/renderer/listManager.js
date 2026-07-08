import { DomPatcher } from './domPatch.js';
import { logger } from '../runtime/AvenxLogger.js';

/**
 * Handles efficient rendering of lists by managing DOM fragments and performing keyed diffing.
 */
export class ListManager {
  /** @type {WeakMap<HTMLTemplateElement, {listRef: Array, items: Array}>} */
  #listCache = new WeakMap();

  /**
   * @param {DynamicEvaluator} evaluator - The expression evaluator.
   * @param {TemplateRenderer} renderer - The template renderer.
   * @param {EventBinder} [eventBinder] - The event binder to unbind removed elements.
   */
  constructor(evaluator, renderer, eventBinder) {
    this.evaluator = evaluator;
    this.renderer = renderer;
    this.eventBinder = eventBinder;
    this.patcher = new DomPatcher();
  }

  /**
   * Processes all template-based lists within a root element.
   * @param {Element} root - The root element to search in.
   * @param {object} scope - The evaluation scope.
   * @param {object} state - The component state.
   */
  process(root, scope, state) {
    const templates = root.querySelectorAll('template[data-ax-for]');
    templates.forEach((template) => {
      let parent = template.parentNode;
      let insideSlot = false;
      while (parent) {
        if (parent.nodeName === 'SLOT' && parent.hasAttribute && parent.hasAttribute('data-avenx-transcluded')) {
          insideSlot = true;
          break;
        }
        parent = parent.parentNode;
      }
      if (!insideSlot) {
        this.#updateList(template, scope, state);
      }
    });
  }

  /**
   * Updates a specific list based on its template and current state.
   * @param {HTMLTemplateElement} template - The list template.
   * @param {object} scope - The evaluation scope.
   * @param {object} state - The component state.
   * @private
   */
  #updateList(template, scope, state) {
    const listExpr = template.getAttribute('data-ax-for');
    const itemVar = template.getAttribute('data-ax-as');
    const keyExpr = template.getAttribute('data-ax-key');

    let list;
    try {
      list = this.evaluator.evaluateExpression(listExpr, scope, state);
    } catch (e) {
      logger.warn(`[ListManager] Failed to evaluate list expression: ${listExpr}`, e);
      return;
    }

    if (!Array.isArray(list)) {
      list = [];
    }

    const cached = this.#listCache.get(template);
    if (
      cached &&
      cached.listRef === list &&
      cached.items.length === list.length &&
      cached.items.every((item, i) => item === list[i])
    ) {
      return;
    }

    const currentItems = this.#getCurrentItems(template);
    const rawItems = list.map((item, index) => {
      const itemScope = { ...scope, [itemVar]: item, index };
      let key = index;
      if (keyExpr) {
        try {
          key = this.evaluator.evaluateExpression(keyExpr, itemScope, state);
        } catch (e) {
          logger.warn(`[ListManager] Failed to evaluate key expression: ${keyExpr}`, e);
        }
      }
      return { item, key: String(key), itemScope, index };
    });

    const keyCounts = {};
    for (const entry of rawItems) {
      keyCounts[entry.key] = (keyCounts[entry.key] || 0) + 1;
    }

    const warnedKeys = new Set();
    const nextItems = rawItems.map((entry) => {
      let finalKey = entry.key;
      if (keyCounts[entry.key] > 1) {
        if (!warnedKeys.has(entry.key)) {
          logger.warn(
            `[ListManager] Duplicate key "${entry.key}" detected in list expression "${listExpr}". Appending index suffix to prevent node reuse conflict.`,
          );
          warnedKeys.add(entry.key);
        }
        finalKey = `${entry.key}_${entry.index}`;
      }
      return { item: entry.item, key: finalKey, itemScope: entry.itemScope };
    });

    // 1. Remove items that are no longer in the list
    const nextKeys = new Set(nextItems.map((i) => i.key));
    for (const [key, element] of currentItems.entries()) {
      if (!nextKeys.has(key)) {
        if (this.eventBinder) {
          this.eventBinder.unbind(element);
        }
        element.remove();
      }
    }

    // 2. Add or move items
    let lastElement = template;
    const itemTemplate = template.innerHTML.replace(/{%/g, '{{').replace(/%}/g, '}}');

    nextItems.forEach(({ key, itemScope }) => {
      let element = currentItems.get(key);
      const resolver = (expr) => this.evaluator.evaluateExpression(expr, itemScope, state);
      const html = this.renderer
        .render(itemTemplate, resolver)
        .trim();

      if (element) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        let newElement = temp.firstElementChild;
        if (newElement) {
          newElement = this.patcher.cleanElement(newElement);
          newElement.setAttribute('data-ax-list-item', '');
          newElement.setAttribute('data-ax-key-val', key);
          let needsPatch = element.outerHTML !== newElement.outerHTML;
          if (!needsPatch) {
            const hasDirectives = element.hasAttribute('data-ax-show') ||
                                  element.hasAttribute('data-ax-class') ||
                                  element.hasAttribute('data-ax-html') ||
                                  (typeof element.querySelector === 'function' && 
                                   (element.querySelector('[data-ax-show]') ||
                                    element.querySelector('[data-ax-class]') ||
                                    element.querySelector('[data-ax-html]')));
            if (hasDirectives) {
              needsPatch = true;
            }
          }
          if (needsPatch) {
            this.patcher.patchElement(element, newElement, resolver);
          }
        }
      } else {
        // Create new element
        const temp = document.createElement('div');
        temp.innerHTML = html;
        element = temp.firstElementChild;
        if (element) {
          element = this.patcher.cleanElement(element);
          element.setAttribute('data-ax-list-item', '');
          element.setAttribute('data-ax-key-val', key);
          this.patcher.applyDirectives(element, resolver);
        }
      }

      if (element) {
        // Ensure correct order
        if (element.previousElementSibling !== lastElement) {
          lastElement.after(element);
        }
        lastElement = element;
      }
    });

    this.#listCache.set(template, {
      listRef: list,
      items: [...list],
    });
  }

  /**
   * Retrieves currently rendered items for a template by scanning subsequent siblings.
   * @param {HTMLTemplateElement} template - The template.
   * @returns {Map<string, Element>}
   * @private
   */
  #getCurrentItems(template) {
    const items = new Map();
    let current = template.nextElementSibling;
    while (current && current.hasAttribute('data-ax-list-item')) {
      const key = current.getAttribute('data-ax-key-val');
      items.set(key, current);
      current = current.nextElementSibling;
    }
    return items;
  }
}
