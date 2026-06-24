/**
 * Responsible for binding event listeners to DOM elements based on attributes.
 */
export class EventBinder {
    /**
     * Stores bound events and handlers.
     * @type {WeakMap<Element, Map<string, Function>>}
     * @private
     */
    #boundEvents = new WeakMap();

    /**
     * Binds event listeners to all elements under the root that have attributes starting with '@'.
     * @param {Element|DocumentFragment} root - The root element to scan for event attributes.
     * @param {Object} dispatcher - The object responsible for executing the event handler.
     * @param {function(string, Event): void} dispatcher.execute - Method to execute the event.
     */
    bind(root, dispatcher) {
        if (!root) return;
        const elements = [];
        const traverse = (node) => {
            if (node.nodeType !== 1) return;
            elements.push(node);
            if (node.nodeName === 'SLOT' && node.hasAttribute && node.hasAttribute('data-avenx-transcluded')) {
                return;
            }
            const children = node.childNodes || node.children;
            if (children) {
                for (let i = 0; i < children.length; i++) {
                    traverse(children[i]);
                }
            }
        };
        traverse(root);

        elements.forEach(el => {
            if (el.nodeType !== 1) return; // 1 is Node.ELEMENT_NODE
            if (!el.attributes) return;
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('@')) {
                    const eventName = attr.name.substring(1);
                    const existing = this.#boundEvents.get(el) || new Map();

                    if (!existing.has(eventName)) {
                        const handler = event => {
                            let handlerExpression = null;

                            if (typeof el.getAttribute === 'function') {
                                handlerExpression = el.getAttribute('@' + eventName);
                            } else if (el.attributes) {
                                const matchedAttr = Array.from(el.attributes)
                                    .find(a => a.name === '@' + eventName);

                                handlerExpression = matchedAttr
                                    ? matchedAttr.value
                                    : null;
                            }

                            if (handlerExpression) {
                                dispatcher.execute(handlerExpression, event);
                            }
                        };

                        el.addEventListener(eventName, handler);

                        existing.set(eventName, handler);
                        this.#boundEvents.set(el, existing);
                    }
                }
            });
        });
    }

    /**
     * Removes all tracked event listeners under a root element.
     * @param {Element|DocumentFragment} root
     */
    unbind(root) {
        if (!root) return;

        const elements = [];
        const traverse = (node) => {
            if (node.nodeType !== 1) return;
            elements.push(node);
            if (node.nodeName === 'SLOT' && node.hasAttribute && node.hasAttribute('data-avenx-transcluded')) {
                return;
            }
            const children = node.childNodes || node.children;
            if (children) {
                for (let i = 0; i < children.length; i++) {
                    traverse(children[i]);
                }
            }
        };
        traverse(root);

        elements.forEach(el => {
            const existing = this.#boundEvents.get(el);

            if (!existing) return;

            existing.forEach((handler, eventName) => {
                el.removeEventListener(eventName, handler);
            });

            this.#boundEvents.delete(el);
        });
    }
}
