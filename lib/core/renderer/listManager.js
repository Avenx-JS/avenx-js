import { DomPatcher } from './domPatch.js';

/**
 * Handles efficient rendering of lists by managing DOM fragments and performing keyed diffing.
 */
export class ListManager {
    /**
     * @param {DynamicEvaluator} evaluator - The expression evaluator.
     * @param {TemplateRenderer} renderer - The template renderer.
     */
    constructor(evaluator, renderer) {
        this.evaluator = evaluator;
        this.renderer = renderer;
        this.patcher = new DomPatcher();
    }

    /**
     * Processes all template-based lists within a root element.
     * @param {Element} root - The root element to search in.
     * @param {Object} scope - The evaluation scope.
     * @param {Object} state - The component state.
     */
    process(root, scope, state) {
        const templates = root.querySelectorAll('template[data-ax-for]');
        templates.forEach(template => {
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
     * @param {Object} scope - The evaluation scope.
     * @param {Object} state - The component state.
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
            console.warn(`[ListManager] Failed to evaluate list expression: ${listExpr}`, e);
            return;
        }

        if (!Array.isArray(list)) return;

        const currentItems = this.#getCurrentItems(template);
        const nextItems = list.map((item, index) => {
            const itemScope = { ...scope, [itemVar]: item, index };
            let key = index;
            if (keyExpr) {
                try {
                    key = this.evaluator.evaluateExpression(keyExpr, itemScope, state);
                } catch (e) {
                    console.warn(`[ListManager] Failed to evaluate key expression: ${keyExpr}`, e);
                }
            }
            return { item, key: String(key), itemScope };
        });

        // 1. Remove items that are no longer in the list
        const nextKeys = new Set(nextItems.map(i => i.key));
        for (const [key, element] of currentItems.entries()) {
            if (!nextKeys.has(key)) {
                element.remove();
            }
        }

        // 2. Add or move items
        let lastElement = template;
        const itemTemplate = template.innerHTML.replace(/{%/g, '{{').replace(/%}/g, '}}');

        nextItems.forEach(({ key, itemScope }) => {
            let element = currentItems.get(key);
            const html = this.renderer.render(
                itemTemplate,
                expr => this.evaluator.evaluateExpression(expr, itemScope, state)
            ).trim();

            if (element) {
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const newElement = temp.firstElementChild;
                if (newElement) {
                    newElement.setAttribute('data-ax-list-item', '');
                    newElement.setAttribute('data-ax-key-val', key);
                    if (element.outerHTML !== newElement.outerHTML) {
                        this.patcher.patchElement(element, newElement);
                    }
                }
            } else {
                // Create new element
                const temp = document.createElement('div');
                temp.innerHTML = html;
                element = temp.firstElementChild;
                if (element) {
                    element.setAttribute('data-ax-list-item', '');
                    element.setAttribute('data-ax-key-val', key);
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
