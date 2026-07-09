import { ComputedRegistry } from '../reactive/createComputed.js';

import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { EventBinder } from '../events/bindEvents.js';
import { EventExecutor } from '../events/eventExecutor.js';
import { DynamicEvaluator } from '../security/evaluator.js';
import { LifecycleManager } from './lifecycle.js';
import { ListManager } from '../renderer/listManager.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from './AvenxError.js';
import { logger } from './AvenxLogger.js';
import { queueJob } from '../reactive/scheduler.js';

import { AvenxWatcher } from '../reactive/watcher.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';

let currentMicrotaskPromise = null;

/**
 * Processes data-ax-bind attributes on input, textarea, and select elements.
 * Converts data-ax-bind="expr" to value="{{ expr }}" and event listener.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
function processBindDirectives(template) {
  if (typeof template !== 'string') return template;
  const tagRegex = /<(input|textarea|select)\b([^>]*?)>/gi;
  return template.replace(tagRegex, (match, tagName, attrs) => {
    const bindRegex = /\bdata-ax-bind\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
    const bindMatch = attrs.match(bindRegex);
    if (!bindMatch) {
      return match;
    }

    const bindExpr = (bindMatch[1] !== undefined ? bindMatch[1] : bindMatch[2]).trim();
    let cleanAttrs = attrs.replace(bindRegex, '').trim();

    let isSelfClosing = false;
    if (cleanAttrs.endsWith('/')) {
      isSelfClosing = true;
      cleanAttrs = cleanAttrs.slice(0, -1).trim();
    }

    const eventName = tagName.toLowerCase() === 'select' ? 'change' : 'input';
    const valueAttr = `value="{{ ${bindExpr} }}"`;
    const eventAttr = `@${eventName}="${bindExpr} = event.target.value"`;

    const suffix = isSelfClosing ? ' />' : '>';
    return `<${tagName} ${cleanAttrs} ${valueAttr} ${eventAttr}`.trim().replace(/\s+/g, ' ') + suffix;
  });
}

/**
 * Base class for all Avenx components.
 * Manages state, reactivity, rendering, and lifecycle.
 */
export class AvenxComponent {
  /** @type {Element|null} @private */
  #element = null;

  /** @type {string} @private */
  #template = '';

  /** @type {object} @private */
  #methods = {};

  /** @type {object} @private */
  #bridges = {};

  /** @type {ComputedRegistry} @private */
  #computed;

  /** @type {TemplateRenderer} @private */
  #renderer;

  /** @type {DomPatcher} @private */
  #patcher;

  /** @type {ListManager} @private */
  #listManager;

  /** @type {EventBinder} @private */
  #eventBinder;

  /** @type {EventExecutor} @private */
  #eventExecutor;

  /** @type {DynamicEvaluator} @private */
  #evaluator;

  /** @type {LifecycleManager} @private */
  #lifecycle;

  /** @type {boolean} @private */
  #isMounted = false;

  /** @type {boolean} @private */
  #isUpdating = false;

  /** @type {Set<string>} @private */
  #evaluating = new Set();

  /** @type {object | null} @private */
  #transcludedGroups = null;

  /** @type {boolean} @private */
  #updateQueued = false;

  /** @type {Function} @private */
  #updateJob = () => {
    this.#updateQueued = false;
    this.update();
  };

  /** @type {Promise|null} @private */
  #lastUpdatedPromise = null;

  /**
   * @param {object} [initialState] - The initial state of the component.
   * @param {object} [computed] - Computed properties definitions.
   * @param {object} [bridges] - External bridges accessible to the component.
   * @param {string} [template] - The HTML template string.
   * @param {object} [methods] - Component methods.
   * @param {object} [props] - Component properties.
   */
  constructor(initialState = {}, computed = {}, bridges = {}, template = '', methods = {}, props = {}) {
    this.#template = processBindDirectives(template);
    this.#bridges = bridges;
    this.#computed = new ComputedRegistry(computed);
    this.#renderer = new TemplateRenderer();
    this.#patcher = new DomPatcher();
    this.#eventBinder = new EventBinder();
    this.#evaluator = new DynamicEvaluator();
    this.#lifecycle = new LifecycleManager();
    this.#listManager = new ListManager(this.#evaluator, this.#renderer, this.#eventBinder);

    /** @type {AvenxWatcher[]} @private */
    this._watchers = [];

    this._stateHandler = new ProxyHandlerFactory({
      computedKeys: this.#computed.keys(),
      onChange: () => this.scheduleUpdate(),
      getComputedValue: (key) => {
        if (this.#evaluating.has(key)) {
          logger.warn(formatMessage(AvenxErrorCodes.COMPUTED_CIRCULAR_DEPENDENCY, key));
          return undefined;
        }

        this.#evaluating.add(key);
        const expression = this.#computed.get(key);

        try {
          return this.#evaluator.evaluateExpression(expression, this.#createScope(), this.state);
        } catch (error) {
          if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
            throw error;
          }

          logger.warn(formatMessage(AvenxErrorCodes.COMPUTED_EVALUTION_FAILED, key, expression, error));
          return undefined;
        } finally {
          this.#evaluating.delete(key);
        }
      },
    });

    this.state = new Proxy(initialState, this._stateHandler.create());

    this._propsHandler = new ProxyHandlerFactory({
      onChange: () => this.scheduleUpdate(),
    });

    this.props = new Proxy(props, this._propsHandler.create());

    this.#methods = this.#evaluator.createMethodMap(
      methods,
      (executableMethods) => this.#createScope(executableMethods),
      () => this.state,
    );

    for (const [name, fn] of Object.entries(this.#methods)) {
      if (!(name in this)) {
        this[name] = fn;
      }
    }

    this.#eventExecutor = new EventExecutor((source, event) => this.#runEventHandler(source, event));
  }

  /**
   * Programmatically registers a watcher on a reactive expression/function.
   * @param {function(): any} getter - Evaluation function returning the value to watch.
   * @param {function(any, any): void} callback - Triggered when the value changes.
   * @param {object} [options] - Config options.
   * @returns {AvenxWatcher}
   */
  watch(getter, callback, options = {}) {
    const watcher = new AvenxWatcher(getter, callback, options);
    this._watchers.push(watcher);
    return watcher;
  }

  /**
   * Creates a scope object for expression evaluation.
   * @param {object} [methods] - Methods to include in the scope.
   * @param {object} [extras] - Additional variables to include.
   * @returns {object} The combined scope.
   * @private
   */
  #createScope(methods = this.#methods, extras = {}) {
    const injected = {};
    const injectOption = this.inject || (typeof this.constructor.inject === 'function' ? this.constructor.inject() : this.constructor.inject);
    if (injectOption) {
      let resolvedOption = typeof injectOption === 'function' ? injectOption.call(this) : injectOption;
      let keys = [];
      if (Array.isArray(resolvedOption)) {
        keys = resolvedOption;
      } else if (resolvedOption && typeof resolvedOption === 'object') {
        keys = Object.keys(resolvedOption);
      }
      for (const key of keys) {
        if (key in this) {
          injected[key] = this[key];
        }
      }
    }
    return { state: this.state, ...this.state, ...methods, ...this.#bridges, props: this.props, ...injected, ...extras };
  }

  /**
   * Resolves an expression within the template.
   * @param {string} expression - The expression to evaluate.
   * @returns {any} The result of the evaluation.
   * @private
   */
  #resolveTemplateExpression(expression) {
    return this.#evaluator.evaluateExpression(expression, this.#createScope(), this.state);
  }

  /**
   * Runs an event handler.
   * @param {string} source - The source code of the handler.
   * @param {Event} event - The event object.
   * @returns {any} The result of the execution.
   * @private
   */
  #runEventHandler(source, event) {
    try {
      return this.#evaluator.executeStatement(source, this.#createScope(this.#methods, { event }), this.state);
    } catch (error) {
      logger.error(formatMessage(AvenxErrorCodes.EVENT_HANDLER_ERROR, source, error));
      return undefined;
    }
  }

  /**
   * Renders the component template with current state.
   * @returns {string} The rendered HTML string.
   */
  render() {
    return this.#renderer.render(this.#template, (expression) => this.#resolveTemplateExpression(expression));
  }

  /**
   * Triggers a synchronous DOM patch update and registers event/list bindings.
   */
  update() {
    if (!this.renderWatcher) {
      this.renderWatcher = new AvenxWatcher(
        () => this.runUpdate(),
        () => this.scheduleUpdate(),
        { lazy: true },
      );
    }

    this.renderWatcher.evaluate();
  }

  /**
   * Performs the actual update/render of the component.
   */
  runUpdate() {
    if (!currentMicrotaskPromise) {
      currentMicrotaskPromise = Promise.resolve();

      Promise.resolve().then(() => {
        currentMicrotaskPromise = null;
      });
    }

    if (this.#lastUpdatedPromise === currentMicrotaskPromise) {
      return;
    }

    this.#lastUpdatedPromise = currentMicrotaskPromise;

    if (!this.#element) return;

    this.#isUpdating = true;

    try {
      this.#patcher.patch(this.#element, this.render(), (expression) => this.#resolveTemplateExpression(expression));

      // Fill slots with transcluded content.
      this.#fillSlots();

      this.#listManager.process(this.#element, this.#createScope(), this.state);
      this.#eventBinder.bind(this.#element, this.#eventExecutor);

      if (this.#isMounted && this.#element?.dispatchEvent) {
        this.#element.dispatchEvent(new CustomEvent('avenx:update'));
      }

      if (this.#isMounted && this.#methods.onUpdate) {
        try {
          this.#methods.onUpdate();
        } catch (error) {
          if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
            throw error;
          }

          logger.error(
            formatMessage(AvenxErrorCodes.LIFECYCLE_HOOK_ERROR, this.constructor.name, 'onUpdate', error),
          );
        }
      }
    } finally {
      this.#isUpdating = false;
    }
  }

  /**
   * Schedules an update to run asynchronously in a microtask.
   */
  scheduleUpdate() {
    if (this.#isUpdating) {
      throw new AvenxError(AvenxErrorCodes.STATE_MUTATION_IN_UPDATE);
    }

    if (this.renderWatcher) {
      this.renderWatcher.dirty = true;
    }

    if (this.#updateQueued) return;

    this.#updateQueued = true;
    queueJob(this.#updateJob);
  }

  /**
   * Internal method to set the mount target.
   * @param {Element} target - The target element.
   * @private
   */
  __setMountTarget(target) {
    this.#element = target;

    if (target) {
      target.__avenx_comp_instance = this;
      this.__initProvide();
      this.__initInjection();

      const children = Array.from(target.childNodes);

      this.#transcludedGroups = {
        default: [],
        named: {},
      };

      children.forEach((child) => {
        if (child.nodeType === 1 && child.hasAttribute('slot')) {
          const name = child.getAttribute('slot');

          if (!this.#transcludedGroups.named[name]) {
            this.#transcludedGroups.named[name] = [];
          }

          this.#transcludedGroups.named[name].push(child);
        } else {
          this.#transcludedGroups.default.push(child);
        }
      });

      target.innerHTML = '';
    }
  }

  /**
   * Resolves the current name of a slot element.
   * Dynamic slot names are evaluated during template rendering, so the
   * rendered name attribute contains the value used for transclusion.
   * @param {Element} slotEl - The slot element.
   * @returns {string|null} The resolved slot name.
   * @private
   */
  #resolveSlotName(slotEl) {
    const name = slotEl.getAttribute('name');
    return name && name.trim() ? name.trim() : null;
  }

  /**
   * Fills <slot> elements with transcluded child nodes.
   * Supports both static and dynamically rendered slot names.
   * @private
   */
  /**
   * Retrieves default children of a slot by parsing the rendered template.
   * @param {string|null} name - The name of the slot.
   * @returns {Node[]} Cloned child nodes.
   * @private
   */
  #getDefaultSlotChildren(name) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(this.render(), 'text/html');
      const rootDoc = doc.body || doc;

      const defaultSlot = Array.from(rootDoc.querySelectorAll('slot')).find((s) => {
        const sName = this.#resolveSlotName(s);
        return name ? sName === name : !sName;
      });

      if (defaultSlot) {
        return Array.from(defaultSlot.childNodes).map((child) => child.cloneNode(true));
      }
    } catch (e) {
      logger.warn('[AvenxComponent] Failed to restore default slot content', e);
    }
    return [];
  }

  /**
   * Fills <slot> elements with transcluded child nodes.
   * Supports both static and dynamically rendered slot names.
   * @private
   */
  #fillSlots() {
    if (!this.#element || !this.#transcludedGroups) return;

    const slots = this.#getOwnSlots();

    slots.forEach((slotEl) => {
      const name = this.#resolveSlotName(slotEl);

      const nodes = name
        ? this.#transcludedGroups.named[name] || []
        : this.#transcludedGroups.default || [];

      const hasContent = nodes.some((node) => {
        if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
        if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
        return false;
      });

      if (hasContent) {
        slotEl.innerHTML = '';

        nodes.forEach((node) => {
          slotEl.appendChild(node);
        });

        slotEl.setAttribute('data-avenx-transcluded', 'true');
      } else {
        slotEl.removeAttribute('data-avenx-transcluded');
        slotEl.innerHTML = '';
        this.#getDefaultSlotChildren(name).forEach((child) => {
          slotEl.appendChild(child);
        });
      }
    });
  }

  /**
   * Retrieves slot elements belonging to this component.
   * @returns {Element[]}
   * @private
   */
  #getOwnSlots() {
    if (!this.#element) return [];

    const slots = this.#element.querySelectorAll('slot');
    const root = this.#element;

    return Array.from(slots).filter((slot) => {
      let parent = slot.parentNode;

      while (parent && parent !== root) {
        if (parent.hasAttribute && parent.hasAttribute('data-avenx-comp')) {
          return false;
        }

        parent = parent.parentNode;
      }

      return true;
    });
  }

  /**
   * Updates the transcluded content when the parent template updates.
   * @param {NodeList|Array} virtualChildNodes - The new virtual transcluded nodes from parent.
   * @private
   */
  __updateTranscludedContent(virtualChildNodes) {
    const grouped = {
      default: [],
      named: {},
    };

    Array.from(virtualChildNodes || []).forEach((node) => {
      if (node.nodeType === 1 && node.hasAttribute('slot')) {
        const name = node.getAttribute('slot');

        if (!grouped.named[name]) {
          grouped.named[name] = [];
        }

        grouped.named[name].push(node);
      } else {
        grouped.default.push(node);
      }
    });

    this.#transcludedGroups = grouped;

    if (this.#element) {
      const slots = this.#getOwnSlots();

      slots.forEach((slotEl) => {
        const name = this.#resolveSlotName(slotEl);

        const newChildren = name
          ? grouped.named[name] || []
          : grouped.default || [];

        const newSlotWrapper = slotEl.cloneNode(false);

        newChildren.forEach((child) => {
          newSlotWrapper.appendChild(child.cloneNode(true));
        });

        const hasContent = newChildren.some((node) => {
          if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
          if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
          return false;
        });

        if (hasContent) {
          newSlotWrapper.setAttribute('data-avenx-transcluded', 'true');
        } else {
          newSlotWrapper.removeAttribute('data-avenx-transcluded');
          this.#getDefaultSlotChildren(name).forEach((child) => {
            newSlotWrapper.appendChild(child);
          });
        }

        this.#patcher.patchElement(slotEl, newSlotWrapper, (expression) => this.#resolveTemplateExpression(expression));
      });
    }
  }

  /**
   * Internal method called after the component is mounted to the DOM.
   * @private
   */
  __afterMount() {
    this.#isMounted = true;

    if (this.#element?.dispatchEvent) {
      this.#element.dispatchEvent(new CustomEvent('avenx:mount'));
    }

    if (this.#methods.onMount) {
      try {
        this.#methods.onMount();
      } catch (error) {
        logger.error(
          formatMessage(AvenxErrorCodes.LIFECYCLE_HOOK_ERROR, this.constructor.name, 'onMount', error),
        );
      }
    }
  }

  /**
   * Unmounts the component and triggers cleanup.
   */
  unmount() {
    this.#eventBinder.unbind(this.#element);

    if (this.#element?.dispatchEvent) {
      this.#element.dispatchEvent(new CustomEvent('avenx:unmount'));
    }

    if (this.#methods.onUnmount) {
      try {
        this.#methods.onUnmount();
      } catch (error) {
        logger.error(
          formatMessage(AvenxErrorCodes.LIFECYCLE_HOOK_ERROR, this.constructor.name, 'onUnmount', error),
        );
      }
    }

    if (this.renderWatcher) {
      this.renderWatcher.teardown();
    }

    if (this._watchers) {
      for (const watcher of this._watchers) {
        watcher.teardown();
      }

      this._watchers = [];
    }

    if (this._stateHandler) {
      this._stateHandler.teardown();
    }

    if (this._propsHandler) {
      this._propsHandler.teardown();
    }

    if (this.#element) {
      delete this.#element.__avenx_comp_instance;
      this.#element.innerHTML = '';
    }

    this.#isMounted = false;
  }

  /**
   * Updates the component's props and triggers an update if they changed.
   * @param {object} newProps - The new props to apply.
   */
  setProps(newProps) {
    const currentProps = this.props;

    for (const key of Object.keys(newProps)) {
      if (currentProps[key] !== newProps[key]) {
        currentProps[key] = newProps[key];
      }
    }

    for (const key of Object.keys(currentProps)) {
      if (!(key in newProps)) {
        delete currentProps[key];
      }
    }
  }

  /**
   * Evaluates an expression in the component's scope.
   * @param {string} expression - The expression to evaluate.
   * @param {object} [extraScope] - Additional scope variables.
   * @returns {any} The result of the evaluation.
   * @protected
   */
  _evaluate(expression, extraScope = {}) {
    return this.#evaluator.evaluateExpression(expression, this.#createScope(this.#methods, extraScope), this.state);
  }

  /**
   * @returns {Element|null} The component's root element.
   * @protected
   */
  _getElement() {
    return this.#element;
  }

  /**
   * @returns {object} The bridges accessible to the component.
   * @protected
   */
  _getBridges() {
    return this.#bridges;
  }

  /**
   * Mounts the component to a target element.
   * @param {Element|string} target - The target element or selector.
   */
  mount(target) {
    this.#lifecycle.mount(this, target);
  }

  /**
   * Internal method to initialize injected properties from ancestors.
   * @private
   */
  __initInjection() {
    const injectOption = this.inject || (typeof this.constructor.inject === 'function' ? this.constructor.inject() : this.constructor.inject);
    if (!injectOption) return;

    let injectMap = {};
    let resolvedOption = typeof injectOption === 'function' ? injectOption.call(this) : injectOption;
    if (Array.isArray(resolvedOption)) {
      for (const key of resolvedOption) {
        injectMap[key] = key;
      }
    } else if (resolvedOption && typeof resolvedOption === 'object') {
      injectMap = resolvedOption;
    }

    for (const [localKey, provideKey] of Object.entries(injectMap)) {
      Object.defineProperty(this, localKey, {
        get: () => {
          const ancestor = this.#findAncestorProviding(provideKey);
          if (!ancestor) {
            logger.warn(`[AvenxComponent] Injected key "${provideKey}" not found in any ancestor component.`);
            return undefined;
          }
          return this.#getAncestorProvidedValue(ancestor, provideKey);
        },
        enumerable: true,
        configurable: true
      });
    }
  }

  /**
   * Finds the nearest ancestor component that provides the specified key.
   * @param {string} key - The provided key to search for.
   * @returns {AvenxComponent|null} The ancestor component instance, or null.
   * @private
   */
  #findAncestorProviding(key) {
    let el = this._getElement();
    if (!el) return null;
    let parentEl = el.parentNode;
    while (parentEl) {
      if (parentEl.__avenx_comp_instance) {
        const comp = parentEl.__avenx_comp_instance;
        if (this.#componentProvides(comp, key)) {
          return comp;
        }
      }
      parentEl = parentEl.parentNode;
    }
    return null;
  }

  /**
   * Checks if a component provides the specified key.
   * @param {AvenxComponent} comp - The component to check.
   * @param {string} key - The provided key.
   * @returns {boolean} True if the component provides the key.
   * @private
   */
  #componentProvides(comp, key) {
    const provideOption = comp.provide || (typeof comp.constructor.provide === 'function' ? comp.constructor.provide() : comp.constructor.provide);
    if (!provideOption) return false;

    let resolved = typeof provideOption === 'function' ? provideOption.call(comp) : provideOption;

    if (Array.isArray(resolved)) {
      return resolved.includes(key);
    } else if (resolved && typeof resolved === 'object') {
      return key in resolved;
    }
    return false;
  }

  /**
   * Retrieves the provided value for a key from an ancestor component.
   * @param {AvenxComponent} comp - The ancestor component instance.
   * @param {string} key - The provided key.
   * @returns {any} The value.
   * @private
   */
  #getAncestorProvidedValue(comp, key) {
    if (comp._providedState && key in comp._providedState) {
      const val = comp._providedState[key];
      if (typeof val === 'function') {
        return val;
      }
      return val;
    }

    const provideOption = comp.provide || (typeof comp.constructor.provide === 'function' ? comp.constructor.provide() : comp.constructor.provide);
    if (!provideOption) return undefined;

    let resolved = typeof provideOption === 'function' ? provideOption.call(comp) : provideOption;

    if (Array.isArray(resolved)) {
      return comp._getScopeValue(key);
    } else if (resolved && typeof resolved === 'object') {
      const val = resolved[key];
      if (typeof val === 'function') {
        return val.bind(comp);
      }
      return val;
    }
    return undefined;
  }

  /**
   * Internal method to initialize provided properties as a reactive proxy.
   * @private
   */
  __initProvide() {
    const provideOption = this.provide || (typeof this.constructor.provide === 'function' ? this.constructor.provide() : this.constructor.provide);
    if (!provideOption) return;

    let resolved = typeof provideOption === 'function' ? provideOption.call(this) : provideOption;

    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      // Create a reactive proxy of the provided object
      const handlerFactory = new ProxyHandlerFactory({
        onChange: () => {
          // Do not call scheduleUpdate of this component
        }
      });
      this._providedState = new Proxy(resolved, handlerFactory.create());
    }
  }

  /**
   * Retrieves a property or method from the component's scope.
   * Used for array-based provide to resolve keys dynamically.
   * @param {string} key - The key to retrieve.
   * @returns {any} The value.
   * @protected
   */
  _getScopeValue(key) {
    if (this.state && key in this.state) {
      return this.state[key];
    }
    if (this.props && key in this.props) {
      return this.props[key];
    }
    if (this.#methods && key in this.#methods) {
      return this.#methods[key];
    }
    if (this.#bridges && key in this.#bridges) {
      return this.#bridges[key];
    }
    if (key in this) {
      return this[key];
    }
    return undefined;
  }
}
