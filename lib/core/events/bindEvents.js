import { findScope } from '../renderer/bindingScope.js';
import { FALLBACK_KEY_MODIFIERS as KEY_MODIFIER_MAP, SYSTEM_MODIFIERS as SYSTEM_MODIFIER_MAP } from './modifiers.js';
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
   * @type {WeakMap<Element, Map<string, {handler: Function, options: object}>>}
   * @private
   */
  #boundEvents = new WeakMap();

  /**
   * Builds addEventListener options from `{ passive, capture }` flags.
   * @param {{passive?: boolean, capture?: boolean}} flags
   * @returns {object}
   * @private
   */
  #toListenerOptions(flags) {
    const options = {};
    if (flags && flags.passive) options.passive = true;
    if (flags && flags.capture) options.capture = true;
    return options;
  }

  /**
   * Removes stored listener entries (single or array) from a DOM target.
   * @param {EventTarget} target
   * @param {Map<string, object|Function|Array<object|Function>>|undefined} entriesByEvent
   * @private
   */
  #removeStoredListeners(target, entriesByEvent) {
    if (!entriesByEvent) return;
    entriesByEvent.forEach((entryOrList, eventName) => {
      const entries = Array.isArray(entryOrList) ? entryOrList : [entryOrList];
      for (const entry of entries) {
        const handler = typeof entry === 'function' ? entry : entry.handler;
        const options = typeof entry === 'function' ? undefined : entry.options;
        if (typeof target.removeEventListener === 'function') {
          target.removeEventListener(eventName, handler, options);
        }
      }
    });
  }

  /**
   * Collects elements along the DOM path from `target` up to `root` (inclusive).
   * @param {Element} target
   * @param {Element} root
   * @returns {Element[]}
   * @private
   */
  #collectPath(target, root) {
    const path = [];
    let current = target || root;
    while (current) {
      path.push(current);
      if (current === root) break;
      current = current.parentNode;
    }
    return path;
  }

  /**
   * Dispatches delegated handlers along `path` for one `(eventName, passive)` bucket.
   * Capture handlers walk root-downward before bubble handlers walk target-upward.
   * @param {Element} root
   * @param {object} dispatcher
   * @param {string} eventName
   * @param {Event} event
   * @param {{passive: boolean, capture: boolean}} options
   * @private
   */
  #dispatchDelegatedBucket(root, dispatcher, eventName, event, options) {
    const { passive } = options;
    const path = this.#collectPath(event && event.target, root);

    const runPass = (capturePhase) => {
      const start = capturePhase ? path.length - 1 : 0;
      const end = capturePhase ? -1 : path.length;
      const step = capturePhase ? -1 : 1;

      for (let i = start; i !== end; i += step) {
        if (event && event.cancelBubble) break;
        const current = path[i];
        if (!belongsToComponent(current, root)) continue;

        if (!capturePhase && !passive && current.hasAttribute && current.hasAttribute('data-ax-validate')) {
          if (dispatcher && typeof dispatcher.validate === 'function') {
            dispatcher.validate(current);
          }
        }

        const handlers = this.#getEventHandlers(current);
        for (const h of handlers) {
          const parts = h.fullName.split('.');
          if (parts[0] !== eventName) continue;
          const modifiers = parts.slice(1);
          if (modifiers.includes('capture') !== capturePhase || modifiers.includes('passive') !== passive) {
            continue;
          }
          if (h.value) {
            this.#executeWithModifiers(dispatcher, h.value, event, modifiers, current, h.attrName);
          }
        }
      }
    };

    runPass(true);
    runPass(false);
  }

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
    /** @type {Map<string, Map<string, {passive: boolean, capture: boolean}>>} */
    const eventBuckets = new Map();

    const addBucket = (eventName, passive, capture) => {
      if (!eventBuckets.has(eventName)) {
        eventBuckets.set(eventName, new Map());
      }
      const key = passive ? 'passive' : 'active';
      const buckets = eventBuckets.get(eventName);
      const existingBucket = buckets.get(key);
      if (existingBucket) {
        existingBucket.capture = existingBucket.capture || capture;
      } else {
        buckets.set(key, { passive, capture });
      }
    };

    COMMON_EVENTS.forEach((name) => addBucket(name, false, false));

    const traverse = (node) => {
      if (node.nodeType !== 1) return;

      const handlers = this.#getEventHandlers(node);
      handlers.forEach((h) => {
        const parts = h.fullName.split('.');
        const baseEventName = parts[0];
        const modifiers = parts.slice(1);
        addBucket(baseEventName, modifiers.includes('passive'), modifiers.includes('capture'));
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

    if (!root.__avenxDelegatedListeners) {
      root.__avenxDelegatedListeners = new Map();
    }
    const delegatedMap = root.__avenxDelegatedListeners;
    const existing = this.#boundEvents.get(root) || new Map();

    eventBuckets.forEach((bucketsMap, eventName) => {
      if (delegatedMap.has(eventName)) {
        this.#removeStoredListeners(root, new Map([[eventName, delegatedMap.get(eventName)]]));
        delegatedMap.delete(eventName);
        existing.delete(eventName);
      }

      // Register bubble listeners before capture listeners so single-slot mock elements
      // preserve `{ capture: true }` when `.capture` is present, while real DOMs get both.
      const orderedBuckets = Array.from(bucketsMap.values()).sort(
        (a, b) => Number(a.capture) - Number(b.capture) || Number(a.passive) - Number(b.passive),
      );
      const entries = orderedBuckets.map((flags) => {
        const handler = (event) => this.#dispatchDelegatedBucket(root, dispatcher, eventName, event, flags);
        const options = this.#toListenerOptions(flags);
        if (typeof root.addEventListener === 'function') {
          root.addEventListener(eventName, handler, options);
        }
        return { handler, options };
      });

      const stored = entries.length === 1 ? entries[0] : entries;
      delegatedMap.set(eventName, stored);
      existing.set(eventName, stored);
      this.#boundEvents.set(root, existing);
    });
  }

  /**
   * @param {Element} root
   */
  #unbindDelegated(root) {
    if (root.__avenxDelegatedListeners) {
      this.#removeStoredListeners(root, root.__avenxDelegatedListeners);
      delete root.__avenxDelegatedListeners;
    }
    const existing = this.#boundEvents.get(root);
    if (existing) {
      this.#removeStoredListeners(root, existing);
      this.#boundEvents.delete(root);
    }
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
      if (!el.__avenxDirectListeners) {
        el.__avenxDirectListeners = new Map();
      }
      const directMap = el.__avenxDirectListeners;
      const existing = this.#boundEvents.get(el) || new Map();
      const handlers = this.#getEventHandlers(el);

      // Remove any existing direct listeners on el before binding new ones
      this.#removeStoredListeners(el, directMap);
      directMap.clear();
      existing.clear();

      /** @type {Map<string, Map<string, {passive: boolean, capture: boolean}>>} */
      const eventBuckets = new Map();
      handlers.forEach((h) => {
        const parts = h.fullName.split('.');
        const baseEventName = parts[0];
        const modifiers = parts.slice(1);
        if (!eventBuckets.has(baseEventName)) {
          eventBuckets.set(baseEventName, new Map());
        }
        const passive = modifiers.includes('passive');
        const capture = modifiers.includes('capture');
        const key = `${passive ? 1 : 0}:${capture ? 1 : 0}`;
        if (!eventBuckets.get(baseEventName).has(key)) {
          eventBuckets.get(baseEventName).set(key, { passive, capture });
        }
      });

      eventBuckets.forEach((bucketsMap, baseEventName) => {
        const orderedBuckets = Array.from(bucketsMap.values()).sort(
          (a, b) => Number(a.capture) - Number(b.capture) || Number(a.passive) - Number(b.passive),
        );
        const entries = orderedBuckets.map(({ passive, capture }) => {
          const handler = (event) => {
            const currentHandlers = this.#getEventHandlers(el);
            currentHandlers.forEach((ch) => {
              const cp = ch.fullName.split('.');
              if (cp[0] !== baseEventName) return;
              const mods = cp.slice(1);
              if (mods.includes('capture') !== capture || mods.includes('passive') !== passive) return;
              if (ch.value) {
                this.#executeWithModifiers(dispatcher, ch.value, event, mods, el, ch.attrName);
              }
            });
          };
          const options = this.#toListenerOptions({ passive, capture });
          if (typeof el.addEventListener === 'function') {
            el.addEventListener(baseEventName, handler, options);
          }
          return { handler, options };
        });

        const stored = entries.length === 1 ? entries[0] : entries;
        directMap.set(baseEventName, stored);
        existing.set(baseEventName, stored);
        this.#boundEvents.set(el, existing);
      });
    });
  }

  /**
   * Resolves the scope an element's bindings belong to.
   *
   * A scoped slot was the first thing to need this; a `<@for>` row needs
   * exactly the same answer, so the walk lives in one module now and both stamp
   * through it.
   * @param {Element} el - The element a binding is attached to.
   * @returns {object|null} The nearest enclosing derived scope, or null.
   * @private
   */
  #getSlotScope(el) {
    return findScope(el);
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
    // 0. Check self modifier
    if (modifiers.includes('self')) {
      if (event && event.target && event.target !== el) {
        return;
      }
    }

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

    // 2. Check system key modifiers

    const systemModifiers = modifiers.filter(m => Object.prototype.hasOwnProperty.call(SYSTEM_MODIFIER_MAP, m));
    if (systemModifiers.some(mod => !event || event[SYSTEM_MODIFIER_MAP[mod]] !== true)) {
      return;
    }

    // 3. Check key modifiers for keyboard events

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

    // 4. Apply prevent & stop modifiers
    // Skip preventDefault when .passive is present — browsers ignore it on passive listeners
    if (
      modifiers.includes('prevent') &&
      !modifiers.includes('passive') &&
      event &&
      typeof event.preventDefault === 'function'
    ) {
      event.preventDefault();
    }
    if (modifiers.includes('stop') && event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }

    // 4. Execute handler
    const slotScope = this.#getSlotScope(el);
    dispatcher.execute(handlerExpression, event, slotScope);
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
      if (el.__avenxDirectListeners) {
        this.#removeStoredListeners(el, el.__avenxDirectListeners);
        delete el.__avenxDirectListeners;
      }

      const existing = this.#boundEvents.get(el);
      if (existing) {
        this.#removeStoredListeners(el, existing);
        this.#boundEvents.delete(el);
      }
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
