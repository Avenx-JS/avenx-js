import { ComputedRegistry } from '../reactive/createComputed.js';
import { styleMountManager } from './StyleMountManager.js';

import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { EventBinder } from '../events/bindEvents.js';
import { EventExecutor } from '../events/eventExecutor.js';
import { DynamicEvaluator } from '../security/evaluator.js';
import { LifecycleManager } from './lifecycle.js';
import { ListManager } from '../renderer/listManager.js';
import { DeferManager } from '../renderer/deferManager.js';
import { DeadlockManager } from '../renderer/deadlockManager.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from './AvenxError.js';
import { logger } from './AvenxLogger.js';
import { queueJob, nextTick as schedulerNextTick } from '../reactive/scheduler.js';
import { AvenxSandbox } from '../security/sandbox.js';

import { AvenxWatcher } from '../reactive/watcher.js';
import { DisposalScope, runInScope } from '../reactive/scope.js';
import { Resource } from '../reactive/Resource.js';
import { ProxyHandlerFactory, RAW_SYMBOL, toRaw } from '../reactive/proxyHandler.js';
import { processBindDirectives } from '../utils/templateUtils.js';
import { profile } from '../utils/profiler.js';
import { parseValidationRules, validateValue, getFieldName, updateValidationState } from '../validation/validator.js';
import { serializeSafe } from '../tooling/inspect.js';

export const RESERVED_INSTANCE_KEYS = [
  'mount',
  'unmount',
  'update',
  'destroy',
  'scheduleUpdate',
  'onBeforeMount',
  'onMount',
  'onBeforeUpdate',
  'onUpdate',
  'onUnmount',
  'onActivate',
  'onDeactivate',
  'onErrorCaptured',
];

const globalMixins = [];
let componentUid = 0;

/**
 * Base class for all Avenx components.
 * Manages state, reactivity, rendering, and lifecycle.
 */
export class AvenxComponent {
  /** @type {Element|null} */
  #element = null;

  /** @type {string} */
  #template = '';

  /** @type {object} */
  #methods = {};

  /** @type {object} */
  #bridges = {};

  /** @type {ComputedRegistry} */
  #computed;

  /** @type {TemplateRenderer} */
  #renderer;

  /** @type {DomPatcher} */
  #patcher;

  /** @type {ListManager} */
  #listManager;

  /** @type {DeferManager} */
  #deferManager;

  /** @type {DeadlockManager} */
  #deadlockManager;

  /** @type {EventBinder} */
  #eventBinder;

  /** @type {EventExecutor} */
  #eventExecutor;

  /** @type {DynamicEvaluator} */
  #evaluator;

  /** @type {LifecycleManager} */
  #lifecycle;

  /** @type {boolean} */
  #isMounted = false;

  /** @type {boolean} */
  #isUpdating = false;

  /** @type {Set<string>} */
  #evaluating = new Set();

  /** @type {object | null} */
  #transcludedGroups = null;

  /** @type {boolean} */
  #updateQueued = false;

  /** @type {Function} */
  #updateJob = () => {
    this.#updateQueued = false;
    this.update();
  };



  /** @type {boolean} */
  #isUnmounting = false;

  /** @type {Promise<void>|null} */
  #unmountPromise = null;

  /** @type {boolean} */
  #isUnmounted = false;

  /** @type {Record<string, Element>} */
  #refsCache = {};

  /** @type {boolean} */
  #refsDirty = false;

  /** @type {boolean} */
  #isBeforeMounting = false;

  /** @type {Object<string, object>} */
  #resources = {};

  /** @type {Error|null} */
  #componentError = null;

  /** @type {Set<string>} */
  #contracts = new Set();

  /**
   * @param {object} [initialState] - The initial state of the component.
   * @param {object} [computed] - Computed properties definitions.
   * @param {object} [bridges] - External bridges accessible to the component.
   * @param {string} [template] - The HTML template string.
   * @param {object} [methods] - Component methods.
   * @param {object} [props] - Component properties.
   * @param {object} [styles] - Component CSS variables.
   * @param {object} [resources] - Reactive resources.
   * @param {object} [options] - Component options and compiler contracts.
   */
  constructor(initialState = {}, computed = {}, bridges = {}, template = '', methods = {}, props = {}, styles = {}, resources = {}, options = {}) {
    this.uid = componentUid++;
    this.#updateJob.id = this.uid;

    if (options && options.contracts) {
      this.#contracts = new Set(options.contracts);
    } else if (Array.isArray(options)) {
      this.#contracts = new Set(options);
    } else if (options instanceof Set) {
      this.#contracts = options;
    }

    /** @type {AvenxComponent|null} */
    this.$parent = null;

    // Merge global mixins options
    const mergedState = {};
    const mergedComputed = {};
    const mergedMethods = {};
    const mergedProps = {};
    const mergedStyles = {};

    for (const mixin of globalMixins) {
      const mixinState = typeof mixin.state === 'function' ? mixin.state.call(this) : mixin.state;
      if (mixinState && typeof mixinState === 'object') {
        Object.assign(mergedState, mixinState);
      }
      const mixinData = typeof mixin.data === 'function' ? mixin.data.call(this) : mixin.data;
      if (mixinData && typeof mixinData === 'object') {
        Object.assign(mergedState, mixinData);
      }

      if (mixin.computed && typeof mixin.computed === 'object') {
        Object.assign(mergedComputed, mixin.computed);
      }
      if (mixin.methods && typeof mixin.methods === 'object') {
        Object.assign(mergedMethods, mixin.methods);
      }
      if (mixin.props && typeof mixin.props === 'object') {
        Object.assign(mergedProps, mixin.props);
      }
      if (mixin.styles && typeof mixin.styles === 'object') {
        Object.assign(mergedStyles, mixin.styles);
      }
    }

    Object.assign(mergedState, initialState);
    Object.assign(mergedComputed, computed);
    Object.assign(mergedMethods, methods);
    Object.assign(mergedProps, props);
    Object.assign(mergedStyles, styles);

    this._mixinProps = {};
    const reservedKeys = ['state', 'data', 'methods', 'computed', 'props', 'styles', 'onBeforeMount', 'onMount', 'onBeforeUpdate', 'onUpdate', 'onUnmount', 'onActivate', 'onDeactivate', 'onErrorCaptured'];
    for (const mixin of globalMixins) {
      for (const key of Object.keys(mixin)) {
        if (!reservedKeys.includes(key)) {
          let value = mixin[key];
          if (typeof value === 'function') {
            value = value.bind(this);
          }
          if (!(key in this)) {
            this[key] = value;
          }
          this._mixinProps[key] = value;
        }
      }
    }

    const isIsolated = this.#contracts.has('isolated');
    this.#template = processBindDirectives(template);
    this.#bridges = isIsolated ? {} : bridges;
    this.#computed = new ComputedRegistry(mergedComputed);
    this.#renderer = new TemplateRenderer();
    this.#patcher = new DomPatcher();
    this.#eventBinder = new EventBinder();
    this.#evaluator = new DynamicEvaluator();
    this.#lifecycle = new LifecycleManager();
    this.#listManager = new ListManager(this.#evaluator, this.#renderer, this.#eventBinder, this.constructor.name);
    this.#deferManager = new DeferManager(this.#evaluator, this.#renderer, this.#eventBinder, this.constructor.name);
    this.#deadlockManager = new DeadlockManager(this.#evaluator, this.#renderer, this.#eventBinder, this.constructor.name);

    /** @type {AvenxWatcher[]} */
    this._watchers = [];

    /**
     * Owns teardown callbacks created while this component runs its own code
     * (lifecycle hooks, actions, event handlers). Bridge subscriptions register
     * here and are released in __performTeardown().
     * @type {DisposalScope}
     */
    this._scope = new DisposalScope(this.constructor.name);

    this._stateHandler = new ProxyHandlerFactory({
      computedKeys: this.#computed.keys(),
      onChange: () => this.scheduleUpdate(),
      instance: this,
      getComputedValue: (key) => {
        if (this.#evaluating.has(key)) {
          logger.warn(formatMessage(AvenxErrorCodes.COMPUTED_CIRCULAR_DEPENDENCY, key), this.$logContext);
          return undefined;
        }

        this.#evaluating.add(key);
        const definition = this.#computed.get(key);

        try {
          if (typeof definition === 'function') {
            return definition.call(this);
          }

          return this.#evaluator.evaluateExpression(
            definition,
            this.#createScope(),
            this.state
          );
        } catch (error) {
          if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
            throw error;
          }

          logger.warn(formatMessage(AvenxErrorCodes.COMPUTED_EVALUTION_FAILED, key, definition, error), this.$logContext);
          return undefined;
        } finally {
          this.#evaluating.delete(key);
        }
      },
    });

    this.state = new Proxy(mergedState, this._stateHandler.create());

    this._propsHandler = new ProxyHandlerFactory({
      onChange: () => this.scheduleUpdate(),
    });

    this.props = new Proxy(mergedProps, this._propsHandler.create());

    this._stylesHandler = new ProxyHandlerFactory({
      onChange: () => this.scheduleUpdate(),
    });

    this.styles = new Proxy(mergedStyles, this._stylesHandler.create());

    this.#methods = this.#evaluator.createMethodMap(
      mergedMethods,
      (executableMethods) => this.#createScope(executableMethods),
      () => this.state,
    );

    for (const [name, fn] of Object.entries(this.#methods)) {
      if (RESERVED_INSTANCE_KEYS.includes(name)) {
        logger.warn(
          formatMessage(
            AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION,
            name,
            this.constructor && this.constructor.name !== 'AvenxComponent' && this.constructor.name !== 'Object'
              ? this.constructor.name
              : 'Component'
          ),
          this.$logContext
        );
      }
      if (!(name in this)) {
        this[name] = fn;
      }
    }

    const activeResources = typeof resources === 'object' && resources !== null ? resources : {};
    for (const [name, resDef] of Object.entries(activeResources)) {
      const handler = typeof resDef === 'object' && resDef !== null ? resDef.handler : resDef;
      const pollInterval = typeof resDef === 'object' && resDef !== null ? resDef.pollInterval : 0;

      let handlerFn = typeof handler === 'function' ? handler : null;
      if (!handlerFn) {
        const cleanHandler = typeof handler === 'string' && handler.trim().startsWith('return') ? handler : `return ${handler}`;
        handlerFn = this.#evaluator.createMethodMap(
          { [name]: cleanHandler },
          () => ({
            ...this.#createScope(),
            setTimeout: typeof setTimeout !== 'undefined' ? setTimeout : undefined,
            clearTimeout: typeof clearTimeout !== 'undefined' ? clearTimeout : undefined,
            setInterval: typeof setInterval !== 'undefined' ? setInterval : undefined,
            clearInterval: typeof clearInterval !== 'undefined' ? clearInterval : undefined,
            fetch: typeof fetch !== 'undefined' ? fetch : undefined,
            Promise: typeof Promise !== 'undefined' ? Promise : undefined,
          }),
          () => this.state
        )[name];
      }
      this.#resources[name] = new Resource(name, handlerFn, this, { pollInterval });

      Object.defineProperty(this, name, {
        get: () => this.#resources[name].read(),
        enumerable: true,
        configurable: true
      });
    }

    // Process declarative watch options from mixins and initialState options
    const mergedWatch = {};
    for (const mixin of globalMixins) {
      if (mixin.watch && typeof mixin.watch === 'object') {
        Object.assign(mergedWatch, mixin.watch);
      }
    }
    const optionWatch =
      (initialState && typeof initialState === 'object' && initialState.watch && typeof initialState.watch === 'object'
        ? initialState.watch
        : null) ||
      (options && typeof options === 'object' && options.watch && typeof options.watch === 'object'
        ? options.watch
        : null);

    if (optionWatch) {
      Object.assign(mergedWatch, optionWatch);
    }

    for (const [key, handler] of Object.entries(mergedWatch)) {
      if (typeof handler === 'function') {
        this.$watch(key, handler);
      } else if (typeof handler === 'object' && handler !== null && typeof handler.handler === 'function') {
        const { handler: fn, ...watchOpts } = handler;
        this.$watch(key, fn, watchOpts);
      } else if (typeof handler === 'string' && typeof this[handler] === 'function') {
        this.$watch(key, this[handler]);
      }
    }

    /** @type {boolean} */
    this._isFirstRender = true;

    this.#eventExecutor = new EventExecutor((source, event, slotScope) => this.#runEventHandler(source, event, slotScope));
    this.#eventExecutor.validate = (el) => this.$validateElement(el);

    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      let initialized = false;
      const originalProto = Object.getPrototypeOf(this);
      const protoProxy = new Proxy(originalProto, {
        getPrototypeOf(target) {
          return target;
        },
        set(target, key, value, receiver) {
          if (initialized && typeof key === 'string' && !key.startsWith('$') && !key.startsWith('_') && key !== 'renderWatcher') {
            const hasKey = (key in receiver);
            if (!hasKey) {
              const compName = receiver.constructor?.name || 'Component';
              console.warn(
                `[Avenx Warning] Direct assignment to "this.${key} = ${value}" on component <${compName}> is non-reactive and will not trigger DOM updates. Declare "${key}" in <state> instead.`
              );
            }
          }
          return Reflect.set(target, key, value, receiver);
        }
      });
      Object.setPrototypeOf(this, protoProxy);

      Promise.resolve().then(() => {
        initialized = true;
      });
    }
  }

  /**
   * Evaluates validation rules for an element and updates this.state.$validation.
   * @param {Element} el - The element to validate.
   * @returns {string[]} Validation errors for the field.
   */
  $validateElement(el) {
    if (!el || typeof el.getAttribute !== 'function' || !el.hasAttribute('data-ax-validate')) {
      return [];
    }
    const ruleStr = el.getAttribute('data-ax-validate');
    const rules = parseValidationRules(ruleStr);
    const fieldName = getFieldName(el);
    let value = el.value;
    if (el.type === 'checkbox') {
      value = el.checked;
    }
    let customMessages = {};
    if (el.hasAttribute('data-ax-validate-messages')) {
      try {
        customMessages = JSON.parse(el.getAttribute('data-ax-validate-messages'));
      } catch {
        // Ignored
      }
    }
    const errors = validateValue(value, rules, { state: this.state, customMessages });
    updateValidationState(this.state, fieldName, errors);
    return errors;
  }

  /**
   * Programmatically registers a watcher on a reactive expression/function.
   * @param {Function} getter - Evaluation function returning the value to watch.
   * @param {Function} callback - Triggered when the value changes.
   * @param {object} [options] - Config options.
   * @returns {AvenxWatcher}
   */
  watch(getter, callback, options = {}) {
    const watcher = new AvenxWatcher(getter, callback, options);
    if (this.#isUnmounted) {
      watcher.teardown();
      return watcher;
    }
    this._watchers.push(watcher);
    return watcher;
  }

  /**
   * Trips a named deadlock boundary inside this component's DOM tree, rendering its fallback template.
   * @param {string|null} [boundaryName] - Name of the deadlock boundary (or null for first boundary).
   * @param {Error|object} [error] - Error context to pass to fallback template.
   */
  $tripDeadlockBoundary(boundaryName = null, error = {}) {
    if (!this.#element) return;
    const boundaries = this.#deadlockManager.findBoundaries(this.#element);
    for (const b of boundaries) {
      const name = b.getAttribute('data-ax-deadlock-name');
      if (!boundaryName || name === boundaryName) {
        this.#deadlockManager.trip(b, error, this.#createScope());
        return;
      }
    }
  }

  /**
   * Resets a named deadlock boundary inside this component's DOM tree.
   * @param {string|null} [boundaryName]
   */
  $resetDeadlockBoundary(boundaryName = null) {
    if (!this.#element) return;
    const boundaries = this.#deadlockManager.findBoundaries(this.#element);
    for (const b of boundaries) {
      const name = b.getAttribute('data-ax-deadlock-name');
      if (!boundaryName || name === boundaryName) {
        this.#deadlockManager.reset(b);
        return;
      }
    }
  }

  /**
   * Returns component context metadata for diagnostic logging.
   * @returns {{ componentName: string, fileName: string|null, component: AvenxComponent }}
   */
  get $logContext() {
    return {
      componentName: this.constructor && this.constructor.name !== 'AvenxComponent' && this.constructor.name !== 'Object' ? this.constructor.name : (this.name || 'Component'),
      fileName: this.__filename || (this.options && this.options.__filename) || null,
      component: this,
    };
  }

  /**
   * Whether the component is currently mounted in the DOM.
   * @returns {boolean}
   */
  get $isMounted() {
    return this.#isMounted;
  }

  /**
   * Whether the component has been unmounted.
   * @returns {boolean}
   */
  get $isUnmounted() {
    return this.#isUnmounted;
  }

  /**
   * Getter for the component's root element.
   * @returns {Element|null}
   */
  get $element() {
    return this.#element;
  }

  /**
   * Getter for component reference elements marked with data-ax-ref.
   * Lazily resolves references if marked dirty.
   * @returns {Record<string, Element>}
   */
  get $refs() {
    if (this.#refsDirty) {
      this.#collectRefs();
    }
    return this.#refsCache;
  }

  /**
   * Slot helpers for checking whether the parent provided content for a slot.
   * Available after mount target setup populates `#transcludedGroups`.
   * @returns {object}
   */
  get $slots() {
    const groups = this.#transcludedGroups;
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
   * Returns a diagnostic snapshot of the component for runtime debugging.
   * Props and state are sanitized clones (safe to log, serialize, or diff);
   * `element` is intentionally the live root element so it stays inspectable
   * in browser devtools. Computed properties are listed by key only, so
   * inspecting never evaluates them.
   * @returns {{ componentName: string, props: object, state: object, computed: string[], slots: string[], element: Element|null }}
   */
  $inspect() {
    const groups = this.#transcludedGroups;
    const slots = [
      ...(Array.isArray(groups?.default) && groups.default.length > 0 ? ['default'] : []),
      ...Object.keys(groups?.named || {}),
    ];

    // Serialize the raw targets: enumerating the reactive proxies would
    // evaluate computed properties as a side effect.
    return {
      componentName: this.$logContext.componentName,
      props: serializeSafe(toRaw(this.props)),
      state: serializeSafe(toRaw(this.state)),
      computed: this.#computed.keys(),
      slots,
      element: this.$element,
    };
  }

  /**
   * KeepAlive invalidation API for clearing cached components.
   * @returns {object}
   */
  get $keepAlive() {
    return {
      clear: (componentName) => {
        if (this.$app && typeof this.$app.clearKeepAliveCache === 'function') {
          return this.$app.clearKeepAliveCache(componentName);
        }
        return false;
      },
    };
  }

  /**
   * Helper method to clear cached KeepAlive component instances.
   * @param {string} [pageName] - Optional component or page name to clear from cache.
   * @returns {boolean} True if cache entries were evicted, false otherwise.
   */
  clearKeepAliveCache(pageName) {
    if (this.$app && typeof this.$app.clearKeepAliveCache === 'function') {
      return this.$app.clearKeepAliveCache(pageName);
    }
    return false;
  }

  /**
   * Emits a custom event up to parent components with unified bubble options.
   * @param {string} eventName - Name of the event to emit.
   * @param {object} [detail] - Event details payload.
   * @param {object} [options] - Optional custom event options.
   */
  emit(eventName, detail = {}, options = {}) {
    if (typeof CustomEvent === 'undefined') {
      return;
    }
    const event = new CustomEvent(eventName, {
      detail,
      bubbles: options.bubbles !== undefined ? options.bubbles : true,
      cancelable: options.cancelable !== undefined ? options.cancelable : true,
      ...options
    });
    if (this.$element) {
      this.$element.dispatchEvent(event);
    }
  }

  /**
   * Emits a custom event to the parent component.
   * @param {string} eventName - Name of the event to emit.
   * @param {object} [detail] - Event details.
   */
  $emit(eventName, detail = {}) {
    this.emit(eventName, detail, { composed: true });
  }

  /**
   * Reactively listens to changes in specific state values or getters.
   * @param {string|Function|Array<string|Function>} source - State property key string, getter function, or array of sources.
   * @param {Function} callback - Triggered when the value changes.
   * @param {object} [options] - Config options.
   * @param {boolean} [options.immediate] - Run callback immediately on watcher creation.
   * @param {boolean} [options.deep] - Deeply watch nested properties.
   * @returns {AvenxWatcher}
   */
  $watch(source, callback, options = {}) {
    const resolveSource = (src) => {
      if (typeof src === 'string') {
        return () => {
          const segments = src.split('.');
          let val = this.state;
          for (const seg of segments) {
            if (val === null || val === undefined) return undefined;
            val = val[seg];
          }
          return val;
        };
      } else if (typeof src === 'function') {
        return () => src.call(this);
      } else {
        throw new Error('source element must be a string or a function');
      }
    };

    let getter;
    if (Array.isArray(source)) {
      getter = source.map((src) => resolveSource(src));
    } else if (typeof source === 'string' || typeof source === 'function') {
      getter = resolveSource(source);
    } else {
      throw new Error('source must be a string, function, or array of sources');
    }

    const watcher = new AvenxWatcher(getter, callback, options);
    if (this.#isUnmounted) {
      watcher.teardown();
      return watcher;
    }
    this._watchers.push(watcher);
    return watcher;
  }

  /**
   * Reactively runs an immediate effect hook that automatically tracks dependencies and re-runs on state mutation.
   * Automatically registers the watcher in this._watchers and tears it down when the component unmounts.
   * @param {Function} effect - Effect function to run immediately and track.
   * @param {object} [options] - Config options.
   * @returns {Function} Stop handle function () => watcher.teardown().
   */
  $watchEffect(effect, options = {}) {
    if (typeof effect !== 'function') {
      throw new Error('effect must be a function');
    }
    const getter = () => effect.call(this);
    const watcher = new AvenxWatcher(getter, null, options);
    if (this.#isUnmounted) {
      watcher.teardown();
      const stop = () => watcher.teardown();
      stop.watcher = watcher;
      return stop;
    }
    this._watchers.push(watcher);
    const stop = () => {
      watcher.teardown();
      const idx = this._watchers.indexOf(watcher);
      if (idx !== -1) {
        this._watchers.splice(idx, 1);
      }
    };
    stop.watcher = watcher;
    return stop;
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
    const isIsolated = this.#contracts.has('isolated');
    const scope = {
      state: this.state,
      ...this._mixinProps,
      // Bridges come first so a component's own declarations always win. A
      // bridge silently shadowing a <state> key or an action would be a very
      // hard bug to see; the compiler reports the collision separately.
      ...(isIsolated ? {} : this.#bridges),
      ...this.state,
      ...methods,
      props: this.props,
      styles: this.styles,
      $route: this.$route,
      $emit: (eventName, detail) => this.$emit(eventName, detail),
      $watch: (source, callback, options) => this.$watch(source, callback, options),
      $watchEffect: (effect, options) => this.$watchEffect(effect, options),
      $nextTick: (callback) => this.$nextTick(callback),
      ...injected,
      ...extras,
    };

    if (this.#resources) {
      for (const key of Object.keys(this.#resources)) {
        if (!(key in scope)) {
          Object.defineProperty(scope, key, {
            get: () => this.#resources[key].read(),
            enumerable: true,
            configurable: true,
          });
        }
      }
    }

    return scope;
  }

  /**
   * Resolves an expression within the template.
   * @param {string} expression - The expression to evaluate.
   * @param {object} [extraScope] - Additional scope variables.
   * @returns {any} The result of the evaluation.
   * @private
   */
  #resolveTemplateExpression(expression, extraScope = {}) {
    return this.#evaluator.evaluateExpression(expression, this.#createScope(this.#methods, extraScope), this.state);
  }

  /**
   * Runs an event handler.
   * @param {string | Function} compiledFnOrSource - The source code of the handler or its compiled function.
   * @param {Event} event - The event object.
   * @param {object|null} [slotScope] - Optional slot scope variables.
   * @returns {any} The result of the execution.
   * @private
   */
  #runEventHandler(compiledFnOrSource, event, slotScope = null) {
    try {
      // Subscriptions opened by a handler belong to this component, so the
      // handler runs inside the component's disposal scope.
      if (typeof compiledFnOrSource === 'function') {
        const scope = this.#createScope(this.#methods, { event, ...slotScope });
        const sandbox = AvenxSandbox.createProxy(scope, this.state, true);
        const args = scope.args || [];
        return runInScope(this._scope, () => compiledFnOrSource(sandbox, this.#methods, event, args));
      }
      return runInScope(this._scope, () =>
        this.#evaluator.executeStatement(compiledFnOrSource, this.#createScope(this.#methods, { event, ...slotScope }), this.state),
      );
    } catch (error) {
      const sourceStr = typeof compiledFnOrSource === 'function' ? (compiledFnOrSource.source || compiledFnOrSource.toString()) : compiledFnOrSource;
      logger.error(formatMessage(AvenxErrorCodes.EVENT_HANDLER_ERROR, sourceStr, error), this.$logContext);
      this.#reportError(error, sourceStr);
      return undefined;
    }
  }

  /**
   * Renders the component template with current state.
   * @returns {string} The rendered HTML string.
   */
  render() {
    const enableProfiling = !!(this.$app?.enableProfiling || (typeof window !== 'undefined' && window.__avenx_enable_profiling));
    return profile(enableProfiling, this.constructor.name, 'render', () => {
      return this.#renderer.render(this.#template, (expression) => this.#resolveTemplateExpression(expression));
    });
  }

  /**
   * Triggers a synchronous DOM patch update and registers event/list bindings.
   */
  update() {
    if (!this.renderWatcher) {
      this.renderWatcher = new AvenxWatcher(
        () => this.runUpdate(),
        () => this.scheduleUpdate(),
        { lazy: true, name: `${this.constructor.name}#render` },
      );
    }

    this.renderWatcher.evaluate();
  }

  /**
   * Performs the actual update/render of the component.
   */
  runUpdate() {
    if (!this.#element) return;

    if (this.#componentError) {
      this.#handleComponentError(this.#componentError);
      return;
    }

    this.#isUpdating = true;

    try {
      if (this.#isMounted) {
        this.#triggerLifecycle('onBeforeUpdate');
      }

      this.__updateProvidedState();

      this.#patcher.patch(this.#element, this.render(), (expression, slotScope) => this.#resolveTemplateExpression(expression, slotScope), this.$app);

      // Fill slots with transcluded content.
      this.#fillSlots();

      this.#listManager.process(this.#element, this.#createScope(), this.state, this.$app);
      this.#deferManager.process(this.#element, this.#createScope(), this.state, this.$app);
      this.#eventBinder.bind(this.#element, this.#eventExecutor);

      this.#refsDirty = true;
      this.#syncSelectElements();

      if (this.#isMounted && typeof CustomEvent !== 'undefined' && this.#element?.dispatchEvent) {
        this.#element.dispatchEvent(new CustomEvent('avenx:update'));
      }

      if (this.#isMounted) {
        this.#resolveRefs();
        this.#triggerLifecycle('onUpdate');
      }

      this.__notifyInjectingChildren();
    } catch (error) {
      if (error instanceof Promise) {
        this.#suspend(error);
        return;
      }
      if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
        throw error;
      }
      this.#handleComponentError(error);
    } finally {
      this.#isUpdating = false;
      this.#validateFormElements();
    }
  }

  /**
   * Validates all form input elements in the component that have data-ax-validate.
   * @private
   */
  #validateFormElements() {
    if (!this.$element || typeof this.$element.querySelectorAll !== 'function') return;
    const elements = Array.from(this.$element.querySelectorAll('[data-ax-validate]'));
    if (this.$element.hasAttribute && this.$element.hasAttribute('data-ax-validate')) {
      elements.unshift(this.$element);
    }
    for (const el of elements) {
      this.$validateElement(el);
    }
  }

  /**
   * Executes a callback (or resolves a Promise) after the current reactive
   * update cycle has finished flushing pending DOM updates.
   * @param {Function} [callback] - Optional callback to run after the flush.
   * @returns {Promise<void>|void} A promise resolving after the flush, if no callback was given.
   */
  $nextTick(callback) {
    return schedulerNextTick(callback);
  }

  /**
   * Alias for {@link AvenxComponent#$nextTick}.
   * @param {Function} [callback] - Optional callback to run after the flush.
   * @returns {Promise<void>|void}
   */
  nextTick(callback) {
    return this.$nextTick(callback);
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

    if (this.#isBeforeMounting) {
      return;
    }

    if (this.#updateQueued) return;

    this.#updateQueued = true;
    queueJob(this.#updateJob);
  }

  /**
   * Internal method to set the mount target.
   * @param {Element} target - The target element.
   * @param {boolean} [isRestore] - Whether the component is being restored from keep-alive.
   * @private
   */
  __setMountTarget(target, isRestore = false) {
    this.#element = target;
    this.#isUnmounted = false;

    // A component instance may be mounted again after teardown. Its disposal
    // scope is single-use, so give the new lifetime a fresh one.
    if (this._scope && this._scope.disposed) {
      this._scope = new DisposalScope(this.constructor.name);
    }

    if (target) {
      target.__avenx_comp_instance = this;
      this.__initProvide();
      this.__initInjection();

      if (isRestore) {
        return;
      }

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
      logger.warn(
        formatMessage(AvenxErrorCodes.COMPONENT_RESTORE_SLOT_CONTENT_FAILED, e.message || e),
        this.$logContext
      );
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

      const nodes = name ? this.#transcludedGroups.named[name] || [] : this.#transcludedGroups.default || [];

      const hasContent = nodes.some((node) => {
        if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
        if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
        return false;
      });

      if (hasContent) {
        slotEl.innerHTML = '';

        const templateEl = nodes.find(
          (node) => node.nodeType === 1 && node.tagName.toLowerCase() === 'template' && node.hasAttribute('data-slot-props')
        );

        if (templateEl) {
          const renderedNodes = this.#renderScopedSlot(slotEl, templateEl);
          renderedNodes.forEach((node) => {
            slotEl.appendChild(node);
          });
        } else {
          nodes.forEach((node) => {
            slotEl.appendChild(node);
          });
        }

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
   * Resolves reference elements if marked dirty.
   * @private
   */
  #resolveRefs() {
    if (this.#refsDirty) {
      this.#collectRefs();
    }
  }

  /**
   * Collects elements marked with data-ax-ref that belong to this component.
   * Elements inside nested component boundaries are excluded.
   * @private
   */
  #collectRefs() {
    this.#refsCache = {};
    this.#refsDirty = false;

    if (!this.#element) return;

    const refElements = this.#element.querySelectorAll('[data-ax-ref]');
    const root = this.#element;

    Array.from(refElements).forEach((element) => {
      let parent = element.parentNode;

      while (parent && parent !== root) {
        if (
          parent.hasAttribute &&
          (parent.hasAttribute('data-avenx-comp') || parent.hasAttribute('data-avenx-comp-dynamic'))
        ) {
          return;
        }

        parent = parent.parentNode;
      }

      const refName = element.getAttribute('data-ax-ref');

      if (refName && refName.trim()) {
        // Prefer the mounted component instance when present (Vue-like $refs behavior)
        this.#refsCache[refName.trim()] = element.__avenx_comp_instance || element;
      }
    });
  }

  /**
   * Renders the content of a scoped slot template using child-exposed properties
   * merged into the parent component's evaluation scope.
   * @param {Element} slotEl - The slot element.
   * @param {Element} templateEl - The transcluded template element.
   * @returns {Node[]} Array of rendered and tagged child nodes.
   * @private
   */
  #renderScopedSlot(slotEl, templateEl) {
    const slotPropsName = templateEl.getAttribute('data-slot-props');
    if (!slotPropsName) return [];

    const exposedProps = {};
    for (const attr of slotEl.attributes) {
      if (attr.name.startsWith(':')) {
        const propName = attr.name.slice(1);
        exposedProps[propName] = this._evaluate(attr.value);
      } else if (attr.name.startsWith('data-props-')) {
        const propName = attr.name.slice('data-props-'.length);
        exposedProps[propName] = this._evaluate(attr.value);
      }
    }

    const extraScope = { [slotPropsName]: exposedProps };
    let templateHtml = templateEl.innerHTML;
    templateHtml = templateHtml
      .replace(/_AX_LBRACE3_/g, '{{{')
      .replace(/_AX_RBRACE3_/g, '}}}')
      .replace(/_AX_LBRACE_/g, '{{')
      .replace(/_AX_RBRACE_/g, '}}');

    const parentComp = this.$parent || this;
    const renderedHtml = this.#renderer.render(templateHtml, (expr) => {
      return parentComp._evaluate(expr, extraScope);
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(renderedHtml, 'text/html');
    const nodes = Array.from((doc.body || doc).childNodes);

    const assignScope = (node) => {
      if (node.nodeType === 1) {
        /* eslint-disable-next-line camelcase */
        node.__avenx_slot_scope = extraScope;
        Array.from(node.childNodes).forEach(assignScope);
      }
    };
    nodes.forEach(assignScope);

    nodes.forEach((node) => {
      if (node.nodeType === 1) {
        this.#patcher.applyDirectives(node, (expr) => {
          return parentComp._evaluate(expr, extraScope);
        }, this.$app);
      }
    });

    return nodes;
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

        const newChildren = name ? grouped.named[name] || [] : grouped.default || [];

        const newSlotWrapper = slotEl.cloneNode(false);

        const templateEl = newChildren.find(
          (node) => node.nodeType === 1 && node.tagName.toLowerCase() === 'template' && node.hasAttribute('data-slot-props')
        );

        let finalChildren = newChildren;
        let isScoped = false;
        if (templateEl) {
          finalChildren = this.#renderScopedSlot(slotEl, templateEl);
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
          this.#getDefaultSlotChildren(name).forEach((child) => {
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
                exposedProps[propName] = this._evaluate(attr.value);
              } else if (attr.name.startsWith('data-props-')) {
                const propName = attr.name.slice('data-props-'.length);
                exposedProps[propName] = this._evaluate(attr.value);
              }
            }
            const extraScope = { [slotPropsName]: exposedProps };
            const parentComp = this.$parent || this;
            return parentComp._evaluate(expr, extraScope);
          }
          return this.#resolveTemplateExpression(expr);
        };

        this.#patcher.patchElement(slotEl, newSlotWrapper, slotEvaluator, this.$app);
      });
    }
  }

  /**
   * Internal method called before the component is mounted to the DOM.
   * @private
   */
  __beforeMount() {
    this.#isBeforeMounting = true;
    try {
      this.#triggerLifecycle('onBeforeMount');
    } catch (error) {
      this.#reportError(error, '__beforeMount');
    } finally {
      this.#isBeforeMounting = false;
    }
  }

  /**
   * Internal method called after the component is mounted to the DOM.
   * @private
   */
  __afterMount() {
    this.#isMounted = true;

    try {
      this.#resolveRefs();

      if (typeof CustomEvent !== 'undefined' && this.#element?.dispatchEvent) {
        this.#element.dispatchEvent(new CustomEvent('avenx:mount'));
      }

      this.#triggerLifecycle('onMount');
    } catch (error) {
      this.#reportError(error, '__afterMount');
    }
  }

  /**
   * Unmounts the component and triggers cleanup.
   * @returns {Promise<void>|void}
   */
  unmount() {
    if (this.#isUnmounted) return;
    if (this.#isUnmounting) return this.#unmountPromise;

    this.#isUnmounting = true;
    const res = this.#lifecycle.unmount(this);
    if (res instanceof Promise) {
      this.#unmountPromise = res;
      return res;
    }
  }

  /**
   * Destroys/unmounts the component and performs teardown of watchers and resources.
   * Alias for unmount().
   * @returns {Promise<void>|void}
   */
  destroy() {
    return this.unmount();
  }

  /**
   * Destroys/unmounts the component and performs teardown of watchers and resources.
   * Alias for unmount().
   * @returns {Promise<void>|void}
   */
  $destroy() {
    return this.unmount();
  }

  /**
   * Performs the actual synchronous teardown and DOM clearing of the component.
   * @private
   */
  __performTeardown() {
    try {
      this.#eventBinder.unbind(this.#element);
      this.#eventBinder.teardown();
      this.#eventExecutor.teardown();

      if (typeof CustomEvent !== 'undefined' && this.#element?.dispatchEvent) {
        this.#element.dispatchEvent(new CustomEvent('avenx:unmount'));
      }

      this.#triggerLifecycle('onUnmount');

      if (this.renderWatcher) {
        this.renderWatcher.teardown();
      }

      if (this._injectedAncestors) {
        for (const { ancestor, key } of this._injectedAncestors) {
          ancestor.__unregisterInjectingChild(key, this);
        }
        this._injectedAncestors = [];
      }

      if (this._watchers) {
        for (const watcher of this._watchers) {
          watcher.teardown();
        }

        this._watchers = [];
      }

      // Releases bridge subscriptions (and anything else scope-owned) opened
      // by this component's hooks and handlers.
      if (this._scope) {
        this._scope.dispose();
      }

      if (this._stateHandler) {
        this._stateHandler.teardown();
      }

      if (this._propsHandler) {
        this._propsHandler.teardown();
      }

      if (this.#resources) {
        for (const res of Object.values(this.#resources)) {
          if (res && typeof res.teardown === 'function') {
            res.teardown();
          }
        }
      }

      this.#refsCache = {};
      this.#refsDirty = false;

      if (this.#element) {
        this.#patcher.triggerUnmounted(this.#element, this.$app);
        delete this.#element.__avenx_comp_instance;
        this.#element.innerHTML = '';
        this.#element = null;
      }
    } catch (error) {
      this.#reportError(error, '__performTeardown');
    }

    // Decrement runtime style reference count for this component class
    styleMountManager.unmount(this.constructor);

    this.#isMounted = false;
    this.#isUnmounting = false;
    this.#isUnmounted = true;
    this.#unmountPromise = null;
  }

  /**
   * Called before the component leaves the DOM.
   * Can return a Promise to postpone DOM removal.
   * @returns {Promise<void>|void}
   */
  onBeforeLeave() {}

  /**
   * Called when the component is mounted to the DOM and enters.
   */
  onEnter() {}

  /**
   * Called when the component is unmounted and leaves the DOM.
   */
  onLeave() {}

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
   * The current active route metadata.
   * @returns {{hash: string, path: string, page: string, params: Record<string, any>, query: Record<string, string | boolean | number>}} The route details.
   */
  get $route() {
    if (typeof window !== 'undefined' && window.__avenx_routers) {
      for (const router of window.__avenx_routers) {
        if (router.currentRoute && router.currentRoute.hash) {
          return router.currentRoute;
        }
      }
    }
    return { hash: '', path: '', page: '', params: {}, query: {}, meta: {} };
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
   * Returns the set of active compiler contracts for this component.
   * @returns {Set<string>}
   */
  get contracts() {
    return this.#contracts;
  }

  /**
   * Retrieves the transcluded groups for this component.
   * @returns {object} The transcluded groups.
   * @protected
   */
  _getTranscludedGroups() {
    return this.#transcludedGroups;
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
    const injectOption =
      this.inject ||
      (typeof this.constructor.inject === 'function' ? this.constructor.inject() : this.constructor.inject);
    if (!injectOption) return;

    let injectMap = {};
    const resolvedOption = typeof injectOption === 'function' ? injectOption.call(this) : injectOption;
    if (Array.isArray(resolvedOption)) {
      for (const key of resolvedOption) {
        injectMap[key] = key;
      }
    } else if (resolvedOption && typeof resolvedOption === 'object') {
      injectMap = resolvedOption;
    }

    for (const [localKey, injectDef] of Object.entries(injectMap)) {
      let provideKey = injectDef;
      let defaultValue;
      let hasDefault = false;

      if (injectDef && typeof injectDef === 'object' && !Array.isArray(injectDef)) {
        provideKey = injectDef.from != null ? injectDef.from : localKey;
        if (Object.prototype.hasOwnProperty.call(injectDef, 'default')) {
          hasDefault = true;
          defaultValue = injectDef.default;
        }
      }

      Object.defineProperty(this, localKey, {
        get: () => {
          const ancestor = this.#findAncestorProviding(provideKey);
          if (!ancestor) {
            if (hasDefault) {
              return typeof defaultValue === 'function' ? defaultValue.call(this) : defaultValue;
            }
            logger.warn(
              formatMessage(AvenxErrorCodes.COMPONENT_INJECT_KEY_NOT_FOUND, provideKey),
              this.$logContext
            );
            return undefined;
          }

          if (!this._injectedAncestors) {
            this._injectedAncestors = [];
          }
          const alreadyRegistered = this._injectedAncestors.some(
            (reg) => reg.ancestor === ancestor && reg.key === provideKey
          );
          if (!alreadyRegistered) {
            ancestor.__registerInjectingChild(provideKey, this);
            this._injectedAncestors.push({ ancestor, key: provideKey });
          }

          return this.#getAncestorProvidedValue(ancestor, provideKey);
        },
        enumerable: true,
        configurable: true,
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

  /**
   * Checks if a component provides the specified key.
   * @param {AvenxComponent} comp - The component to check.
   * @param {string} key - The provided key.
   * @returns {boolean} True if the component provides the key.
   * @private
   */
  #componentProvides(comp, key) {
    const provideOption =
      comp.provide ||
      (typeof comp.constructor.provide === 'function' ? comp.constructor.provide() : comp.constructor.provide);
    if (!provideOption) return false;

    const resolved = typeof provideOption === 'function' ? provideOption.call(comp) : provideOption;

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

    const provideOption =
      comp.provide ||
      (typeof comp.constructor.provide === 'function' ? comp.constructor.provide() : comp.constructor.provide);
    if (!provideOption) return undefined;

    const resolved = typeof provideOption === 'function' ? provideOption.call(comp) : provideOption;

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
    const provideOption =
      this.provide ||
      (typeof this.constructor.provide === 'function' ? this.constructor.provide() : this.constructor.provide);
    if (!provideOption) return;

    const resolved = typeof provideOption === 'function' ? provideOption.call(this) : provideOption;

    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      // Create a reactive proxy of the provided object
      const handlerFactory = new ProxyHandlerFactory({
        onChange: () => {
          this.__notifyInjectingChildren();
        },
      });
      this._providedState = new Proxy(resolved, handlerFactory.create());
    }
  }

  /**
   * Registers a child component that is injecting a provided key.
   * @param {string} key - The provided key.
   * @param {AvenxComponent} child - The child component.
   */
  __registerInjectingChild(key, child) {
    if (!this._injectingChildren) {
      this._injectingChildren = new Map();
    }
    let children = this._injectingChildren.get(key);
    if (!children) {
      children = new Set();
      this._injectingChildren.set(key, children);
    }
    children.add(child);
  }

  /**
   * Unregisters an injecting child component.
   * @param {string} key - The provided key.
   * @param {AvenxComponent} child - The child component.
   */
  __unregisterInjectingChild(key, child) {
    if (this._injectingChildren) {
      const children = this._injectingChildren.get(key);
      if (children) {
        children.delete(child);
      }
    }
  }

  /**
   * Notifies all registered injecting child components that a provided value has shifted.
   */
  __notifyInjectingChildren() {
    if (this._injectingChildren) {
      for (const children of this._injectingChildren.values()) {
        for (const child of children) {
          child.scheduleUpdate();
        }
      }
    }
  }

  /**
   * Dynamically re-evaluates the provide option and updates providedState.
   */
  __updateProvidedState() {
    if (!this._providedState) return;
    const provideOption =
      this.provide ||
      (typeof this.constructor.provide === 'function' ? this.constructor.provide() : this.constructor.provide);
    if (!provideOption) return;

    const resolved = typeof provideOption === 'function' ? provideOption.call(this) : provideOption;
    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      const rawProvided = this._providedState[RAW_SYMBOL] || this._providedState;
      for (const [k, v] of Object.entries(resolved)) {
        if (rawProvided[k] !== v) {
          this._providedState[k] = v;
        }
      }
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

  /**
   * Resolves the app instance associated with this component.
   * @returns {AvenxApp|null}
   */
  get $app() {
    if (this._app) {
      return this._app;
    }
    if (this.$parent) {
      return this.$parent.$app;
    }
    const el = this.$element;
    if (el) {
      let parentEl = el.parentNode;
      while (parentEl) {
        if (parentEl.__avenx_comp_instance) {
          const comp = parentEl.__avenx_comp_instance;
          if (comp._app) return comp._app;
          if (comp.$parent) {
            const app = comp.$parent.$app;
            if (app) return app;
          }
        }
        parentEl = parentEl.parentNode;
      }
    }
    return null;
  }

  /**
   * Sets the app instance associated with this component.
   * @param {AvenxApp} app - The app instance.
   */
  set $app(app) {
    this._app = app;
  }

  /**
   * Invokes all registered lifecycle hooks for the specified event.
   * @param {string} hookName - The name of the lifecycle hook.
   * @private
   */
  #triggerLifecycle(hookName) {
    const hooks = [];
    for (const mixin of globalMixins) {
      if (mixin[hookName] && typeof mixin[hookName] === 'function') {
        hooks.push(mixin[hookName].bind(this));
      } else if (mixin.methods && mixin.methods[hookName] && typeof mixin.methods[hookName] === 'function') {
        hooks.push(mixin.methods[hookName].bind(this));
      }
    }
    const selfHook = this.#methods[hookName] || (typeof this[hookName] === 'function' ? this[hookName].bind(this) : null);
    if (selfHook) {
      hooks.push(selfHook);
    }

    for (const hook of hooks) {
      try {
        const enableProfiling = !!(this.$app?.enableProfiling || (typeof window !== 'undefined' && window.__avenx_enable_profiling));
        profile(enableProfiling, this.constructor.name, hookName, () => {
          runInScope(this._scope, hook);
        });
      } catch (error) {
        if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
          throw error;
        }
        logger.error(formatMessage(AvenxErrorCodes.LIFECYCLE_HOOK_ERROR, this.constructor.name, hookName, error), this.$logContext);
        this.#reportError(error, hookName);
      }
    }
  }

  /**
   * Reports an error to the global application error handler, if registered.
   * If a parent component defines an onErrorCaptured hook, it is invoked first.
   * If onErrorCaptured returns false, the error propagation is stopped.
   * @param {Error} error - The error that occurred.
   * @param {string} origin - Description of where the error occurred.
   * @private
   */
  #reportError(error, origin) {
    let current = this;
    let currentError = error;

    while (current) {
      const hooks = [];
      for (const mixin of globalMixins) {
        if (mixin['onErrorCaptured'] && typeof mixin['onErrorCaptured'] === 'function') {
          hooks.push(mixin['onErrorCaptured'].bind(current));
        } else if (mixin.methods && mixin.methods['onErrorCaptured'] && typeof mixin.methods['onErrorCaptured'] === 'function') {
          hooks.push(mixin.methods['onErrorCaptured'].bind(current));
        }
      }
      
      const selfHook = current.#methods['onErrorCaptured'] || (typeof current['onErrorCaptured'] === 'function' ? current['onErrorCaptured'].bind(current) : null);
      if (selfHook) {
        hooks.push(selfHook);
      }

      if (hooks.length > 0) {
        let stopPropagation = false;
        for (const hook of hooks) {
          try {
            const result = hook(currentError, this, origin);
            if (result === false) {
              stopPropagation = true;
            }
          } catch (hookError) {
            currentError = hookError;
            origin = 'onErrorCaptured hook';
          }
        }
        
        if (stopPropagation) {
          return;
        }
      }

      current = current.$parent;
    }

    const app = this.$app;
    if (app && typeof app._handleError === 'function') {
      app._handleError(currentError, this, origin);
    }
  }

  /**
   * Syncs the value property of select elements to match their value attribute
   * after child nodes and lists are fully patched/rendered.
   * @private
   */
  #syncSelectElements() {
    if (!this.#element || typeof this.#element.querySelectorAll !== 'function') return;
    const selects = this.#element.querySelectorAll('select') || [];
    const isSelect = typeof this.#element.getAttribute === 'function' && this.#element.tagName === 'SELECT';
    const allSelects = isSelect ? [this.#element, ...selects] : selects;
    for (const select of allSelects) {
      if (typeof select.getAttribute === 'function') {
        const valueAttr = select.getAttribute('value');
        if (valueAttr !== null) {
          if (select.value !== valueAttr) {
            select.value = valueAttr;
          }
        }
      }
    }
  }

  /**
   * Suspends the component rendering and shows the fallback UI if available.
   * @param {Promise<any>} promise 
   * @private
   */
  #suspend(promise) {
    if (!this.#element) return;
    
    const fallbackMatch = this.#template.match(/<template data-ax-fallback[^>]*>([\s\S]*?)<\/template>/i);
    if (!fallbackMatch) {
      if (this.$parent) {
        this.$parent.#suspend(promise);
      }
      return;
    }

    const fallbackHtml = fallbackMatch[1].replace(/\{%/g, '{{').replace(/%\}/g, '}}');

    try {
      const renderedFallback = this.#renderer.render(fallbackHtml, (expression) => this.#resolveTemplateExpression(expression));
      this.#patcher.patch(this.#element, renderedFallback, (expression, slotScope) => this.#resolveTemplateExpression(expression, slotScope), this.$app);
      this.#fillSlots();
      this.#listManager.process(this.#element, this.#createScope(), this.state, this.$app);
      this.#eventBinder.bind(this.#element, this.#eventExecutor);
    } catch (error) {
      if (error instanceof Promise) {
        if (this.$parent) {
          this.$parent.#suspend(error);
        }
      } else {
        this.#handleComponentError(error);
      }
    }

    promise.finally(() => {
      this.update();
    });
  }

  /**
   * Handles component rendering errors using error boundaries.
   * @param {Error} error 
   * @private
   */
  #handleComponentError(error) {
    if (!this.#element) return;
    this.#componentError = error;
    
    let errorAs = 'error';
    const asMatch = this.#template.match(/data-ax-error-as="([^"]*)"/i);
    if (asMatch) {
      errorAs = asMatch[1];
    }

    const fallbackMatch = this.#template.match(/<template data-ax-error-fallback[^>]*>([\s\S]*?)<\/template>/i);
    if (!fallbackMatch) {
      if (this.$parent) {
        this.$parent.#handleComponentError(error);
      } else {
        this.#reportError(error, 'runUpdate');
      }
      return;
    }

    const fallbackHtml = fallbackMatch[1].replace(/\{%/g, '{{').replace(/%\}/g, '}}');
    const extraScope = { [errorAs]: error };

    try {
      const renderedFallback = this.#renderer.render(fallbackHtml, (expression) => this.#resolveTemplateExpression(expression, extraScope));
      this.#patcher.patch(this.#element, renderedFallback, (expression, slotScope) => this.#resolveTemplateExpression(expression, { ...extraScope, ...slotScope }), this.$app);
      this.#fillSlots();
      this.#listManager.process(this.#element, this.#createScope(this.#methods, extraScope), this.state, this.$app);
      this.#eventBinder.bind(this.#element, this.#eventExecutor);
    } catch (e) {
      if (this.$parent) {
        this.$parent.#handleComponentError(e);
      } else {
        this.#reportError(e, 'ErrorBoundary');
      }
    }
  }

  /**
   * Registers a global mixin.
   * @param {object} mixin - The mixin definition.
   */
  static mixin(mixin) {
    if (mixin && typeof mixin === 'object') {
      globalMixins.push(mixin);
    }
  }

  /**
   * Resets/clears the global mixins list.
   * Useful for testing environments.
   */
  static clearMixins() {
    globalMixins.length = 0;
  }

  /**
   * Helper method to programmatically create component subclasses without ES class boilerplate.
   * @param {object} [options] - Component definition options.
   * @returns {Function} The generated component subclass.
   */
  static extend(options = {}) {
    const SuperClass = this;
    const parentOptions = SuperClass.__options || {};

    const componentName =
      options.name ||
      (SuperClass.name && SuperClass.name !== 'AvenxComponent'
        ? `${SuperClass.name}Extended`
        : 'ExtendedComponent');

    const reservedKeys = new Set([
      'name',
      'state',
      'data',
      'computed',
      'template',
      'methods',
      'props',
      'styles',
      'resources',
      'contracts',
      'watch',
      'provide',
      'inject',
      'options',
    ]);

    const lifecycleHookNames = new Set([
      'onBeforeMount',
      'onMount',
      'onBeforeUpdate',
      'onUpdate',
      'onUnmount',
      'onActivate',
      'onDeactivate',
      'onErrorCaptured',
      'onEnter',
      'onLeave',
      'onBeforeLeave',
    ]);

    // Merge methods
    const explicitMethods = {
      ...(parentOptions.methods || {}),
      ...(options.methods || {}),
    };

    // Extract top-level methods & lifecycle hooks
    for (const [key, value] of Object.entries(options)) {
      if (!reservedKeys.has(key) && typeof value === 'function') {
        explicitMethods[key] = value;
      }
    }

    // Separate regular methods (for #methods/super) and lifecycle hooks
    const regularMethods = {};
    for (const [key, fn] of Object.entries(explicitMethods)) {
      if (!lifecycleHookNames.has(key)) {
        regularMethods[key] = fn;
      }
    }

    const finalComputed = {
      ...(parentOptions.computed || {}),
      ...(options.computed || {}),
    };

    const finalTemplate =
      options.template !== undefined
        ? options.template
        : (parentOptions.template !== undefined ? parentOptions.template : '');

    const finalProps = {
      ...(parentOptions.props || {}),
      ...(options.props || {}),
    };

    const finalStyles = {
      ...(parentOptions.styles || {}),
      ...(options.styles || {}),
    };

    const finalResources = {
      ...(parentOptions.resources || {}),
      ...(options.resources || {}),
    };

    const finalWatch = {
      ...(parentOptions.watch || {}),
      ...(options.watch || {}),
    };

    const parentContracts = Array.isArray(parentOptions.contracts)
      ? parentOptions.contracts
      : (parentOptions.contracts instanceof Set ? Array.from(parentOptions.contracts) : []);
    const childContracts = Array.isArray(options.contracts)
      ? options.contracts
      : (options.contracts instanceof Set ? Array.from(options.contracts) : []);
    const finalContracts = Array.from(new Set([...parentContracts, ...childContracts]));

    const finalOptions = {
      ...(parentOptions.options || {}),
      ...(options.options || {}),
      contracts: finalContracts,
      watch: finalWatch,
    };

    /**
     * Resolves and clones initial state from a state/data definition.
     * @param {object|Function} stateDef - The state definition.
     * @returns {object} The resolved state object.
     */
    function resolveState(stateDef) {
      if (typeof stateDef === 'function') {
        return stateDef();
      }
      if (stateDef && typeof stateDef === 'object') {
        try {
          if (typeof globalThis !== 'undefined' && typeof globalThis.structuredClone === 'function') {
            return globalThis.structuredClone(stateDef);
          }
          return JSON.parse(JSON.stringify(stateDef));
        } catch {
          return { ...stateDef };
        }
      }
      return {};
    }

    const ExtendedComponent = {
      [componentName]: class extends SuperClass {
        /**
         * @param {...any} args - Constructor arguments.
         */
        constructor(...args) {
          let runtimeBridges = {};
          let runtimeProps = {};

          if (args.length >= 8) {
            const [cState, cComputed, cBridges, cTemplate, cMethods, cProps, cStyles, cResources, cOptions] = args;
            const parentDefState = resolveState(parentOptions.state || parentOptions.data);
            const childDefState = resolveState(options.state || options.data);
            const mergedState = { ...parentDefState, ...childDefState, ...(cState || {}) };
            const mergedComputed = { ...finalComputed, ...(cComputed || {}) };
            const mergedTemplate = cTemplate !== undefined ? cTemplate : finalTemplate;
            const mergedMethods = { ...regularMethods, ...(cMethods || {}) };
            const mergedProps = { ...finalProps, ...(cProps || {}) };
            const mergedStyles = { ...finalStyles, ...(cStyles || {}) };
            const mergedResources = { ...finalResources, ...(cResources || {}) };
            const mergedOptions = { ...finalOptions, ...(cOptions || {}) };

            super(
              mergedState,
              mergedComputed,
              cBridges || {},
              mergedTemplate,
              mergedMethods,
              mergedProps,
              mergedStyles,
              mergedResources,
              mergedOptions
            );
            return;
          }

          if (args.length === 1) {
            if (args[0] && typeof args[0] === 'object') {
              runtimeBridges = args[0];
              runtimeProps = args[0];
            }
          } else if (args.length >= 2) {
            runtimeBridges = args[0] || {};
            runtimeProps = args[1] || {};
          }

          const parentDefState = resolveState(parentOptions.state || parentOptions.data);
          const childDefState = resolveState(options.state || options.data);
          const mergedState = { ...parentDefState, ...childDefState };
          const mergedProps = { ...finalProps, ...runtimeProps };

          super(
            mergedState,
            finalComputed,
            runtimeBridges,
            finalTemplate,
            regularMethods,
            mergedProps,
            finalStyles,
            finalResources,
            finalOptions
          );
        }
      },
    }[componentName];

    Object.defineProperty(ExtendedComponent, 'name', {
      value: componentName,
      configurable: true,
    });

    ExtendedComponent.__isExtendedComponent = true;
    ExtendedComponent.__options = {
      name: componentName,
      state: options.state || options.data || parentOptions.state || parentOptions.data,
      computed: finalComputed,
      methods: explicitMethods,
      template: finalTemplate,
      props: finalProps,
      styles: finalStyles,
      resources: finalResources,
      watch: finalWatch,
      contracts: finalContracts,
      options: finalOptions,
      provide: options.provide || parentOptions.provide,
      inject: options.inject || parentOptions.inject,
    };

    // Attach all methods & lifecycle hooks to ExtendedComponent.prototype
    for (const [name, fn] of Object.entries(explicitMethods)) {
      if (typeof fn === 'function') {
        ExtendedComponent.prototype[name] = fn;
      }
    }

    // Attach computed getters to ExtendedComponent.prototype
    for (const name of Object.keys(finalComputed)) {
      if (!(name in ExtendedComponent.prototype)) {
        Object.defineProperty(ExtendedComponent.prototype, name, {
          get() {
            return this.state ? this.state[name] : undefined;
          },
          configurable: true,
          enumerable: true,
        });
      }
    }

    // Attach provide & inject
    if (options.provide || parentOptions.provide) {
      ExtendedComponent.prototype.provide = options.provide || parentOptions.provide;
    }
    if (options.inject || parentOptions.inject) {
      ExtendedComponent.prototype.inject = options.inject || parentOptions.inject;
    }

    // Copy any custom non-function / extra properties from options to prototype
    for (const [key, value] of Object.entries(options)) {
      if (!reservedKeys.has(key) && typeof value !== 'function') {
        ExtendedComponent.prototype[key] = value;
      }
    }

    return ExtendedComponent;
  }
}

