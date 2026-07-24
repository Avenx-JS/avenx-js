/**
 * Checks if a given DOM element belongs to the component defined by root.
 * Deals with nested component boundaries and transcluded slots.
 * @param {Element} element
 * @param {Element} root
 * @returns {boolean}
 */
function belongsToComponent(element, root) {
  if (element === root) {
    return !(root.hasAttribute && (root.hasAttribute('data-avenx-comp') || root.hasAttribute('data-avenx-comp-dynamic')));
  }
  let current = element;
  let isTranscluded = false;
  while (current && current !== root) {
    if (current.nodeType === 1) {
      if (current.nodeName === 'SLOT' && current.hasAttribute && current.hasAttribute('data-avenx-transcluded')) {
        isTranscluded = true;
      } else if (
        current.hasAttribute &&
        (current.hasAttribute('data-avenx-comp') || current.hasAttribute('data-avenx-comp-dynamic'))
      ) {
        if (isTranscluded) {
          isTranscluded = false;
        } else if (current !== element) {
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
   * Stores elements and executed modifier keys for once handlers.
   * @type {WeakMap<Element, Set<string>>}
   * @private
   */
  #onceExecuted = new WeakMap();

  /**
   * Reads all event handlers (including delegation metadata) from an element.
   * Supports both data-ax-event and traditional @event attributes.
   * @param {Element} el
   * @returns {Array<{fullName: string, value: string, attrName: string}>}
   * @private
   */
  #getEventHandlers(el) {
    const handlers = [];
    if (!el) return handlers;

    if (el.hasAttribute && el.hasAttribute('data-ax-event')) {
      const attrVal = el.getAttribute('data-ax-event');
      try {
        const parsed = JSON.parse(attrVal);
        for (const [key, val] of Object.entries(parsed)) {
          handlers.push({
            fullName: key,
            value: val,
            attrName: `data-ax-event:${key}`
          });
        }
      } catch {
        // Ignored
      }
    }

    if (el.attributes) {
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name.startsWith('@')) {
          handlers.push({
            fullName: attr.name.substring(1),
            value: attr.value,
            attrName: attr.name
          });
        }
      });
    }

    return handlers;
  }

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
    const COMMON_EVENTS = ['click', 'input', 'change', 'keydown'];
    const eventNames = new Set(COMMON_EVENTS);

    const traverse = (node) => {
      if (node.nodeType !== 1) return;

      const handlers = this.#getEventHandlers(node);
      handlers.forEach((h) => {
        const baseEventName = h.fullName.split('.')[0];
        eventNames.add(baseEventName);
      });

      if (node.nodeName === 'SLOT' && node.hasAttribute && node.hasAttribute('data-avenx-transcluded')) {
        return;
      }
      if (
        node !== root &&
        node.hasAttribute &&
        (node.hasAttribute('data-avenx-comp') || node.hasAttribute('data-avenx-comp-dynamic'))
      ) {
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
              const handlers = this.#getEventHandlers(current);
              handlers.forEach((h) => {
                const parts = h.fullName.split('.');
                const baseEventName = parts[0];
                if (baseEventName === eventName) {
                  const modifiers = parts.slice(1);
                  if (h.value) {
                    this.#executeWithModifiers(dispatcher, h.value, event, modifiers, current, h.attrName);
                  }
                }
              });
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

        if (typeof root.addEventListener === 'function') {
          root.addEventListener(eventName, handler);
        }
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
      if (typeof root.removeEventListener === 'function') {
        root.removeEventListener(eventName, handler);
      }
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
      const handlers = this.#getEventHandlers(el);
      handlers.forEach((h) => {
        const parts = h.fullName.split('.');
        const baseEventName = parts[0];
        const existing = this.#boundEvents.get(el) || new Map();

        if (!existing.has(baseEventName)) {
          const handler = (event) => {
            const currentHandlers = this.#getEventHandlers(el);
            currentHandlers.forEach((ch) => {
              const cp = ch.fullName.split('.');
              const cbEventName = cp[0];
              if (cbEventName === baseEventName) {
                const mods = cp.slice(1);
                if (ch.value) {
                  this.#executeWithModifiers(dispatcher, ch.value, event, mods, el, ch.attrName);
                }
              }
            });
          };
          if (typeof el.addEventListener === 'function') {
            el.addEventListener(baseEventName, handler);
          }
          existing.set(baseEventName, handler);
          this.#boundEvents.set(el, existing);
        }
      });
    });
  }

  /**
   * Executes the handler expression if modifiers permit, and applies modifier effects.
   * @param {object} dispatcher
   * @param {string} handlerExpression
   * @param {Event} event
   * @param {string[]} modifiers
   * @param {Element} el
   * @param {string} attrName
   * @private
   */
  #executeWithModifiers(dispatcher, handlerExpression, event, modifiers, el, attrName) {
    // 1. Check once modifier
    if (modifiers.includes('once')) {
      let executedSet = this.#onceExecuted.get(el);
      if (!executedSet) {
        executedSet = new Set();
        this.#onceExecuted.set(el, executedSet);
      }
      if (executedSet.has(attrName)) {
        return;
      }
      executedSet.add(attrName);
    }

    // 2. Check key modifiers for keyboard events
    const KEY_MODIFIER_MAP = {
      enter: 'Enter',
      esc: 'Escape',
      escape: 'Escape',
      space: ' ',
      tab: 'Tab',
      delete: 'Delete',
    };

    const keyModifiers = modifiers.filter(m => Object.prototype.hasOwnProperty.call(KEY_MODIFIER_MAP, m));
    if (keyModifiers.length > 0) {
      if (!event || typeof event.key !== 'string') {
        return;
      }
      const matches = keyModifiers.some(mod => event.key === KEY_MODIFIER_MAP[mod]);
      if (!matches) {
        return;
      }
    }

    // 3. Apply prevent & stop modifiers
    if (modifiers.includes('prevent') && event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (modifiers.includes('stop') && event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }

    // 4. Execute handler
    dispatcher.execute(handlerExpression, event);
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
        if (typeof el.removeEventListener === 'function') {
          el.removeEventListener(eventName, handler);
        }
      });
      this.#boundEvents.delete(el);
    });
  }

  /**
   * Resets internal WeakMaps to release any remaining element-handler references.
   */
  teardown() {
    this.#boundEvents = new WeakMap();
    this.#onceExecuted = new WeakMap();
  }
}
