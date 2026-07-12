import { ComputedRegistry } from '../reactive/createComputed.js';
import { styleMountManager } from './StyleMountManager.js';

import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { EventBinder } from '../events/bindEvents.js';
import { EventExecutor } from '../events/eventExecutor.js';
import { DynamicEvaluator } from '../security/evaluator.js';
import { LifecycleManager } from './lifecycle.js';
import { ListManager } from '../renderer/listManager.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from './AvenxError.js';
import { logger } from './AvenxLogger.js';
import { queueJob, nextTick as schedulerNextTick } from '../reactive/scheduler.js';

import { AvenxWatcher } from '../reactive/watcher.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';

let currentMicrotaskPromise = null;

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

export class AvenxComponent {
  #element = null;

  #template = '';

  #methods = {};

  #bridges = {};

  #computed;

  #renderer;

  #patcher;

  #listManager;

  #eventBinder;

  #eventExecutor;

  #evaluator;

  #lifecycle;

  #isMounted = false;

  #isUpdating = false;

  #evaluating = new Set();

  #transcludedGroups = null;

  #updateQueued = false;

  #updateJob = () => {
    this.#updateQueued = false;
    this.update();
  };

  #lastUpdatedPromise = null;

  constructor(initialState = {}, computed = {}, bridges = {}, template = '', methods = {}, props = {}) {
    this.$parent = null;

    /**
     * DOM elements registered with data-ax-ref, scoped to this component.
     * @type {Record<string, Element>}
     */
    this.$refs = {};

    this.#template = processBindDirectives(template);
    this.#bridges = bridges;
    this.#computed = new ComputedRegistry(computed);
    this.#renderer = new TemplateRenderer();
    this.#patcher = new DomPatcher();
    this.#eventBinder = new EventBinder();
    this.#evaluator = new DynamicEvaluator();
    this.#lifecycle = new LifecycleManager();
    this.#listManager = new ListManager(this.#evaluator, this.#renderer, this.#eventBinder);

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

  watch(getter, callback, options = {}) {
    const watcher = new AvenxWatcher(getter, callback, options);
    this._watchers.push(watcher);
    return watcher;
  }

  #createScope(methods = this.#methods, extras = {}) {
    const injected = {};

    const injectOption =
      this.inject ||
      (typeof this.constructor.inject === 'function' ? this.constructor.inject() : this.constructor.inject);

    if (injectOption) {
      const resolvedOption = typeof injectOption === 'function' ? injectOption.call(this) : injectOption;

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

    return {
      state: this.state,
      ...this.state,
      ...methods,
      ...this.#bridges,
      props: this.props,
      $route: this.$route,
      ...injected,
      ...extras,
    };
  }

  #resolveTemplateExpression(expression) {
    return this.#evaluator.evaluateExpression(expression, this.#createScope(), this.state);
  }

  #runEventHandler(source, event) {
    try {
      return this.#evaluator.executeStatement(source, this.#createScope(this.#methods, { event }), this.state);
    } catch (error) {
      logger.error(formatMessage(AvenxErrorCodes.EVENT_HANDLER_ERROR, source, error));
      return undefined;
    }
  }

  render() {
    return this.#renderer.render(this.#template, (expression) => this.#resolveTemplateExpression(expression));
  }

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
      this.#patcher.patch(
        this.#element,
        this.render(),
        (expression) => this.#resolveTemplateExpression(expression),
      );

      this.#fillSlots();

      this.#listManager.process(this.#element, this.#createScope(), this.state);
      this.#eventBinder.bind(this.#element, this.#eventExecutor);

      this.#collectRefs();

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
            formatMessage(
              AvenxErrorCodes.LIFECYCLE_HOOK_ERROR,
              this.constructor.name,
              'onUpdate',
              error,
            ),
          );
        }
      }
    } finally {
      this.#isUpdating = false;
    }
  }

  nextTick(callback) {
    return schedulerNextTick(callback);
  }

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

  #resolveSlotName(slotEl) {
    const name = slotEl.getAttribute('name');
    return name && name.trim() ? name.trim() : null;
  }

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

  #fillSlots() {
    if (!this.#element || !this.#transcludedGroups) return;

    const slots = this.#getOwnSlots();

    slots.forEach((slotEl) => {
      const name = this.#resolveSlotName(slotEl);

      const nodes = name
        ? this.#transcludedGroups.named[name] || []
        : this.#transcludedGroups.default || [];

      const hasContent = nodes.some((node) => {
        if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') {
          return true;
        }

        if (node.nodeType === 3 && node.textContent.trim().length > 0) {
          return true;
        }

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
   * Collects elements marked with data-ax-ref that belong to this component.
   * Elements inside nested component boundaries are excluded.
   * @private
   */
  #collectRefs() {
    this.$refs = {};

    if (!this.#element) return;

    const refElements = this.#element.querySelectorAll('[data-ax-ref]');
    const root = this.#element;

    Array.from(refElements).forEach((element) => {
      let parent = element.parentNode;

      while (parent && parent !== root) {
        if (parent.hasAttribute && parent.hasAttribute('data-avenx-comp')) {
          return;
        }

        parent = parent.parentNode;
      }

      const refName = element.getAttribute('data-ax-ref');

      if (refName && refName.trim()) {
        this.$refs[refName.trim()] = element;
      }
    });
  }

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
          if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') {
            return true;
          }

          if (node.nodeType === 3 && node.textContent.trim().length > 0) {
            return true;
          }

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

        this.#patcher.patchElement(
          slotEl,
          newSlotWrapper,
          (expression) => this.#resolveTemplateExpression(expression),
        );
      });
    }
  }

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
          formatMessage(
            AvenxErrorCodes.LIFECYCLE_HOOK_ERROR,
            this.constructor.name,
            'onMount',
            error,
          ),
        );
      }
    }
  }

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
          formatMessage(
            AvenxErrorCodes.LIFECYCLE_HOOK_ERROR,
            this.constructor.name,
            'onUnmount',
            error,
          ),
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

    this.$refs = {};

    if (this.#element) {
      delete this.#element.__avenx_comp_instance;
      this.#element.innerHTML = '';
      this.#element = null;
    }

    styleMountManager.unmount(this.constructor);

    this.#isMounted = false;
  }

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

  get $route() {
    if (typeof window !== 'undefined' && window.__avenx_routers) {
      for (const router of window.__avenx_routers) {
        if (router.currentRoute && router.currentRoute.hash) {
          return router.currentRoute;
        }
      }
    }

    return { hash: '', page: '', params: {} };
  }

  _evaluate(expression, extraScope = {}) {
    return this.#evaluator.evaluateExpression(
      expression,
      this.#createScope(this.#methods, extraScope),
      this.state,
    );
  }

  _getElement() {
    return this.#element;
  }

  _getBridges() {
    return this.#bridges;
  }

  mount(target) {
    this.#lifecycle.mount(this, target);
  }

  __initInjection() {
    const injectOption =
      this.inject ||
      (typeof this.constructor.inject === 'function'
        ? this.constructor.inject()
        : this.constructor.inject);

    if (!injectOption) return;

    let injectMap = {};

    const resolvedOption =
      typeof injectOption === 'function'
        ? injectOption.call(this)
        : injectOption;

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
            logger.warn(
              `[AvenxComponent] Injected key "${provideKey}" not found in any ancestor component.`,
            );

            return undefined;
          }

          return this.#getAncestorProvidedValue(ancestor, provideKey);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  #findAncestorProviding(key) {
    const el = this._getElement();

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

  #componentProvides(comp, key) {
    const provideOption =
      comp.provide ||
      (typeof comp.constructor.provide === 'function'
        ? comp.constructor.provide()
        : comp.constructor.provide);

    if (!provideOption) return false;

    const resolved =
      typeof provideOption === 'function'
        ? provideOption.call(comp)
        : provideOption;

    if (Array.isArray(resolved)) {
      return resolved.includes(key);
    }

    if (resolved && typeof resolved === 'object') {
      return key in resolved;
    }

    return false;
  }

  #getAncestorProvidedValue(comp, key) {
    if (comp._providedState && key in comp._providedState) {
      const val = comp._providedState[key];

      if (typeof val === 'function') {
        return val;
      }

      return val;
    }

    const provideOption =
      comp.provide ||
      (typeof comp.constructor.provide === 'function'
        ? comp.constructor.provide()
        : comp.constructor.provide);

    if (!provideOption) return undefined;

    const resolved =
      typeof provideOption === 'function'
        ? provideOption.call(comp)
        : provideOption;

    if (Array.isArray(resolved)) {
      return comp._getScopeValue(key);
    }

    if (resolved && typeof resolved === 'object') {
      const val = resolved[key];

      if (typeof val === 'function') {
        return val.bind(comp);
      }

      return val;
    }

    return undefined;
  }

  __initProvide() {
    const provideOption =
      this.provide ||
      (typeof this.constructor.provide === 'function'
        ? this.constructor.provide()
        : this.constructor.provide);

    if (!provideOption) return;

    const resolved =
      typeof provideOption === 'function'
        ? provideOption.call(this)
        : provideOption;

    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      const handlerFactory = new ProxyHandlerFactory({
        onChange: () => {},
      });

      this._providedState = new Proxy(resolved, handlerFactory.create());
    }
  }

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
