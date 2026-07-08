/**
 * Checks if a given DOM element belongs to the component defined by root.
 * Deals with nested component boundaries and transcluded slots.
 * @param {Element} element
 * @param {Element} root
 * @returns {boolean}
 */
function belongsToComponent(element, root) {
  let current = element;
  let isTranscluded = false;
  while (current && current !== root) {
    if (current.nodeType === 1) {
      if (current.nodeName === 'SLOT' && current.hasAttribute && current.hasAttribute('data-avenx-transcluded')) {
        isTranscluded = true;
      } else if (current.hasAttribute && current.hasAttribute('data-avenx-comp')) {
        if (isTranscluded) {
          isTranscluded = false;
        } else {
          return false;
        }
      }
    }
    current = current.parentNode;
  }
  return !isTranscluded;
}

/**
 * Responsible for binding event listeners to DOM elements based on attributes.
 * Uses event delegation on the root element.
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
   * Uses event delegation on Element roots, falls back to direct binding on DocumentFragments.
   * @param {Element|DocumentFragment} root - The root element to bind events on.
   * @param {object} dispatcher - The object responsible for executing the event handler.
   * @param {function(string, Event): void} dispatcher.execute - Method to execute the event.
   */
  bind(root, dispatcher) {
    if (!root) return;
    if (root.nodeType === 11) {
      this.#bindDirect(root, dispatcher);
    } else {
      this.#bindDelegated(root, dispatcher);
    }
  }

  /**
   * Removes all event listeners for the given root.
   * @param {Element|DocumentFragment} root
   */
  unbind(root) {
    if (!root) return;
    if (root.nodeType === 11) {
      this.#unbindDirect(root);
    } else {
      this.#unbindDelegated(root);
      this.#unbindDirect(root);
    }
  }

  /**
   * @param {Element} root
   * @param {object} dispatcher
   */
  #bindDelegated(root, dispatcher) {
    // Collect all unique event names from elements belonging to this component
    const eventNames = new Set();
    const traverse = (node) => {
      if (node.nodeType !== 1) return;

      if (node.attributes) {
        Array.from(node.attributes).forEach((attr) => {
          if (attr.name.startsWith('@')) {
            eventNames.add(attr.name.substring(1));
          }
        });
      }

      if (node.nodeName === 'SLOT' && node.hasAttribute && node.hasAttribute('data-avenx-transcluded')) {
        return;
      }
      if (node !== root && node.hasAttribute && node.hasAttribute('data-avenx-comp')) {
        // If it's a child component root, we might want its parent-defined event handlers,
        // but we do NOT traverse its children.
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

    eventNames.forEach((eventName) => {
      const existing = this.#boundEvents.get(root) || new Map();
      if (!existing.has(eventName)) {
        const handler = (event) => {
          let current = (event && event.target) || root;
          while (current) {
            if (belongsToComponent(current, root)) {
              let handlerExpression = null;
              if (typeof current.getAttribute === 'function') {
                handlerExpression = current.getAttribute('@' + eventName);
              } else if (current.attributes) {
                const matchedAttr = Array.from(current.attributes).find((a) => a.name === '@' + eventName);
                handlerExpression = matchedAttr ? matchedAttr.value : null;
              }
              if (handlerExpression) {
                dispatcher.execute(handlerExpression, event);
              }
            }
            if (current === root) {
              break;
            }
            current = current.parentNode;
            if (event.cancelBubble) {
              break;
            }
          }
        };

        root.addEventListener(eventName, handler);
        existing.set(eventName, handler);
        this.#boundEvents.set(root, existing);
      }
    });
  }

  /**
   * @param {Element} root
   */
  #unbindDelegated(root) {
    const existing = this.#boundEvents.get(root);
    if (!existing) return;
    existing.forEach((handler, eventName) => {
      root.removeEventListener(eventName, handler);
    });
    this.#boundEvents.delete(root);
  }

  /**
   * @param {Element|DocumentFragment} root
   * @param {object} dispatcher
   */
  #bindDirect(root, dispatcher) {
    const elements = [];
    const traverse = (node) => {
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.nodeType === 1) {
        elements.push(node);
      }
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

    elements.forEach((el) => {
      if (el.nodeType !== 1) return;
      if (!el.attributes) return;
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name.startsWith('@')) {
          const eventName = attr.name.substring(1);
          const existing = this.#boundEvents.get(el) || new Map();

          if (!existing.has(eventName)) {
            const handler = (event) => {
              let handlerExpression = null;
              if (typeof el.getAttribute === 'function') {
                handlerExpression = el.getAttribute('@' + eventName);
              } else if (el.attributes) {
                const matchedAttr = Array.from(el.attributes).find((a) => a.name === '@' + eventName);
                handlerExpression = matchedAttr ? matchedAttr.value : null;
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
   * @param {Element|DocumentFragment} root
   */
  #unbindDirect(root) {
    const elements = [];
    const traverse = (node) => {
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.nodeType === 1) {
        elements.push(node);
      }
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

    elements.forEach((el) => {
      const existing = this.#boundEvents.get(el);
      if (!existing) return;
      existing.forEach((handler, eventName) => {
        el.removeEventListener(eventName, handler);
      });
      this.#boundEvents.delete(el);
    });
  }
}
