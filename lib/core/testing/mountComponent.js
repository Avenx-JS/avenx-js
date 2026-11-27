import { AvenxPage } from '../runtime/AvenxPage.js';
import { nextTick } from '../reactive/scheduler.js';
import { assertSnapshot } from './snapshot.js';
import { AvenxMock } from './mock.js';
import { AvenxSandbox } from './sandbox.js';

/**
 * Recursively serializes a DOM element to HTML.
 * @param {Element|object} el - Element to serialize.
 * @returns {string} Serialized HTML string.
 */
export function getHTML(el) {
  if (!el) return '';
  // If JSDOM/real DOM
  if (typeof Element !== 'undefined' && el instanceof Element) {
    return el.innerHTML;
  }
  // If it's a mock element with custom innerHTML getter
  const desc =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) || {}, 'innerHTML') ||
    Object.getOwnPropertyDescriptor(el, 'innerHTML');
  if (desc && typeof desc.get === 'function') {
    return el.innerHTML;
  }
  // Fallback serializing children
  if (el.childNodes && el.childNodes.length > 0) {
    return el.childNodes
      .map((c) => {
        if (c.nodeType === 3) return c.textContent;
        if (c.nodeType === 1) {
          const attrsStr = (c.attributes || []).map((attr) => ` ${attr.name}="${attr.value}"`).join('');
          const tag = c.tagName.toLowerCase();
          return `<${tag}${attrsStr}>${getHTML(c)}</${tag}>`;
        }
        return '';
      })
      .join('');
  }
  return el.innerHTML || '';
}

/**
 * Settles the event loop so pending Promises and timers can complete.
 * Prefer this over ad-hoc `setTimeout` chains in unit tests.
 * @returns {Promise<void>}
 */
export function flushPromises() {
  return new Promise((resolve) => {
    if (typeof globalThis.setImmediate === 'function') {
      globalThis.setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Instantiates, mounts, and returns the component instance and target DOM element for testing.
 * @param {Function} ComponentClass - Component class to mount.
 * @param {object} [options] - Mounting options.
 * @param {object} [options.props] - Props to pass to component.
 * @param {object|string} [options.slots] - Slot content string, DOM node, or map of slot name to content.
 * @param {object} [options.state] - State overrides.
 * @param {object} [options.initialState] - Alias for state overrides.
 * @param {object} [options.bridges] - Mock or real bridges to pass.
 * @param {object} [options.components] - Child component map.
 * @param {Element} [options.container] - Target DOM container.
 * @param {object} [options.route] - Mock route options.
 * @returns {Promise<{instance: object, element: Element, container: Element, unmount: Function, html: string}>}
 */
export async function mountTestComponent(ComponentClass, options = {}) {
  const {
    props = {},
    slots = null,
    state = null,
    initialState = null,
    bridges = {},
    components = {},
    container = null,
    route = null,
  } = options;

  if (route) {
    AvenxMock.createMockRouter(typeof route === 'object' ? route : {});
  }

  let target = container;
  if (!target) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      target = document.createElement('div');
    } else {
      target = new AvenxSandbox()._createMockElement('div');
    }
  }

  if (slots) {
    if (typeof slots === 'string') {
      target.innerHTML = slots;
    } else if (typeof slots === 'object') {
      if (slots.nodeType) {
        target.appendChild(slots);
      } else {
        Object.entries(slots).forEach(([name, content]) => {
          if (name === 'default') {
            if (typeof content === 'string') {
              if (typeof target.insertAdjacentHTML === 'function') {
                target.insertAdjacentHTML('beforeend', content);
              } else {
                target.innerHTML += content;
              }
            } else if (content && content.nodeType) {
              target.appendChild(content);
            }
          } else {
            if (typeof content === 'string') {
              if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
                const div = document.createElement('div');
                div.setAttribute('slot', name);
                div.innerHTML = content;
                target.appendChild(div);
              }
            } else if (content && content.nodeType) {
              if (typeof content.setAttribute === 'function') {
                content.setAttribute('slot', name);
              }
              target.appendChild(content);
            }
          }
        });
      }
    }
  }

  let instance;
  if (ComponentClass.prototype && ComponentClass.prototype instanceof AvenxPage) {
    instance = new ComponentClass(bridges, components, props);
  } else {
    try {
      instance = new ComponentClass(bridges, props);
    } catch {
      instance = new ComponentClass(props);
    }
  }

  const stateOverrides = state || initialState;
  if (stateOverrides && instance.state) {
    Object.assign(instance.state, stateOverrides);
  }

  instance.mount(target);
  await nextTick();

  const element =
    (typeof instance._getElement === 'function' && instance._getElement()) ||
    (typeof instance.getElement === 'function' && instance.getElement()) ||
    target.firstElementChild ||
    target;

  const matchesSelector = (node, selector) => {
    if (!node || node.nodeType !== 1 || !selector) return false;
    if (selector === '*') return true;
    if (/^[a-zA-Z][\w-]*$/.test(selector)) {
      return node.tagName && node.tagName.toLowerCase() === selector.toLowerCase();
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const classAttr = (typeof node.getAttribute === 'function' && node.getAttribute('class')) || '';
      return (
        (node.classList && typeof node.classList.contains === 'function' && node.classList.contains(cls)) ||
        classAttr.split(/\s+/).includes(cls)
      );
    }
    const tagClass = selector.match(/^([a-zA-Z][\w-]*)\.([\w-]+)$/);
    if (tagClass) {
      const classAttr = (typeof node.getAttribute === 'function' && node.getAttribute('class')) || '';
      return (
        node.tagName &&
        node.tagName.toLowerCase() === tagClass[1].toLowerCase() &&
        ((node.classList && node.classList.contains(tagClass[2])) || classAttr.split(/\s+/).includes(tagClass[2]))
      );
    }
    if (typeof node.matches === 'function') {
      try {
        return node.matches(selector);
      } catch {
        return false;
      }
    }
    return false;
  };

  const collectElements = (root) => {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 1) out.push(node);
      const kids = node.childNodes || node.children || [];
      for (let i = 0; i < kids.length; i++) {
        visit(kids[i]);
      }
    };
    visit(root);
    return out;
  };

  return {
    instance,
    component: instance,
    element,
    container: target,
    update: () => {
      if (typeof instance.update === 'function') {
        instance.update();
      }
    },
    unmount: () => {
      if (typeof instance.unmount === 'function') {
        instance.unmount();
      }
    },
    toMatchSnapshot(name = 'default', snapshotOptions = {}) {
      return assertSnapshot(element || target, name, snapshotOptions);
    },
    get html() {
      return getHTML(target);
    },
    find(selector) {
      if (!selector) return null;
      const roots = [element, target].filter(Boolean);
      for (const root of roots) {
        if (matchesSelector(root, selector)) return root;
        if (typeof root.querySelector === 'function') {
          const found = root.querySelector(selector);
          if (found) return found;
        }
        const nodes = collectElements(root);
        for (const node of nodes) {
          if (node !== root && matchesSelector(node, selector)) {
            return node;
          }
        }
      }
      return null;
    },
    findAll(selector) {
      if (!selector) return [];
      const seen = new Set();
      const out = [];
      const roots = [element, target].filter(Boolean);
      for (const root of roots) {
        if (typeof root.querySelectorAll === 'function') {
          const list = root.querySelectorAll(selector);
          for (let i = 0; i < list.length; i++) {
            if (!seen.has(list[i])) {
              seen.add(list[i]);
              out.push(list[i]);
            }
          }
        }
        for (const node of collectElements(root)) {
          if (matchesSelector(node, selector) && !seen.has(node)) {
            seen.add(node);
            out.push(node);
          }
        }
      }
      return out;
    },
    findComponent(ComponentClassOrName) {
      const matches = [];
      const roots = [element, target].filter(Boolean);
      for (const root of roots) {
        for (const node of collectElements(root)) {
          const comp = node.__avenx_comp_instance;
          if (!comp) continue;
          let ok;
          if (typeof ComponentClassOrName === 'function') {
            ok = comp instanceof ComponentClassOrName || comp.constructor === ComponentClassOrName;
          } else if (typeof ComponentClassOrName === 'string') {
            const name = ComponentClassOrName;
            ok =
              (comp.constructor && comp.constructor.name === name) ||
              (comp.name && comp.name === name) ||
              (typeof node.getAttribute === 'function' &&
                (node.getAttribute('data-avenx-comp') === name ||
                  node.getAttribute('data-avenx-comp-dynamic') === name));
          } else {
            ok = true;
          }
          if (ok) matches.push(comp);
        }
      }
      return matches.find((c) => c !== instance) || matches[0] || null;
    },
    async trigger(selectorOrEl, eventName, detail = {}) {
      let el = selectorOrEl;
      if (typeof selectorOrEl === 'string') {
        el = this.find(selectorOrEl);
      }
      if (!el) {
        throw new Error(`trigger: element not found for ${String(selectorOrEl)}`);
      }
      return fireEvent(el, eventName, detail);
    },
  };
}

/**
 * Helper to dispatch DOM events synchronously and flush the microtask scheduler.
 * @param {Element} element - Target element to fire event on.
 * @param {string} eventType - Type of event (e.g. 'click', 'input', 'change').
 * @param {object} [detail] - Event detail or options (e.g. { value: 'foo' }).
 * @returns {Promise<void>}
 */
export async function fireEvent(element, eventType, detail = {}) {
  if (!element) {
    throw new Error('fireEvent requires a target Element.');
  }

  if (detail && typeof detail === 'object') {
    if ('value' in detail && 'value' in element) {
      element.value = detail.value;
    }
    if ('checked' in detail && 'checked' in element) {
      element.checked = detail.checked;
    }
  }

  AvenxMock.trigger(element, eventType, detail);
  await nextTick();
}
