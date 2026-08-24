import { AvenxRouter } from './AvenxRouter.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from './AvenxError.js';
import { initInspector } from '../tooling/inspect.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';
import { isBridge } from './bridge.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { VirtualList } from './VirtualList.js';
import { AvenxComponent } from './AvenxComponent.js';
import { LruCache } from '../utils/LruCache.js';

import { logger } from './AvenxLogger.js';

/**
 * The main application class for Avenx.
 * Manages component registration, bridge registration, and mounting.
 */
export class AvenxApp {
  /** @type {AvenxComponent[]} */
  #activeComponents = [];
  /** @type {Element|null} */
  #target = null;
  /** @type {Function[]} */
  #errorHandlers = [];
  /** @type {Function[]} */
  #warnHandlers = [];
  /** @type {Set<any>} */
  #installedPlugins = new Set();
  /** @type {LruCache|null} */
  #pageCache = null;

  /**
   * @param {object} config - Application configuration.
   * @param {string} config.target - Selector for the main application container.
   */
  constructor(config) {
    this.#target = document.querySelector(config.target);
    if (!this.#target) {
      throw new AvenxError(AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND, config.target);
    }
    /** @type {Map<string, Function>} */
    this.components = new Map();
    this.components.set('VirtualList', VirtualList);
    /** @type {Map<string, Function>} */
    this.pages = new Map();
    /** @type {Map<string, object>} */
    this.directives = new Map();
    /** @type {object} */
    this.bridges = {};
    /** @type {AvenxRouter|null} */
    this.router = null;
    this.updateAll = this.updateAll.bind(this);
    if (config.logging) {
      logger.configure(config.logging);
    }
    if (config.errorHandler) {
      this.onError(config.errorHandler);
    }
    if (config.warnHandler) {
      this.onWarn(config.warnHandler);
    }
    /** @type {boolean} */
    this.enableProfiling = !!config.enableProfiling;
    if (this.enableProfiling && typeof window !== 'undefined') {
      window.__avenx_enable_profiling = true;
    }
    initInspector(this);

    const keepAliveLimit = config.keepAliveLimit !== undefined ? config.keepAliveLimit : 5;
    this.#pageCache = new LruCache(keepAliveLimit, (pageName, cachedVal) => {
      if (cachedVal && cachedVal.pageInstance && typeof cachedVal.pageInstance.unmount === 'function') {
        cachedVal.pageInstance.unmount();
      }
    });
  }

  /**
   * Registers a plugin with the application. Supports synchronous plugins, async installer functions,
   * dynamic import loader functions, or Promises.
   * @param {object | Function | Promise} plugin - The plugin to install or async loader function.
   * @param {object} [options] - Optional configurations for the plugin.
   * @returns {AvenxApp | Promise<AvenxApp>} The app instance or a Promise resolving to the app instance.
   */
  use(plugin, options = {}) {
    if (this.#installedPlugins.has(plugin)) {
      logger.warn('Plugin already installed.');
      return this;
    }

    const installResolved = (resolvedPlugin) => {
      let target = resolvedPlugin;
      if (target && target.__esModule && target.default !== undefined) {
        target = target.default;
      } else if (
        target &&
        typeof target === 'object' &&
        'default' in target &&
        (typeof target.default === 'function' || (target.default && typeof target.default.install === 'function'))
      ) {
        target = target.default;
      }

      if (!target) return this;

      if (this.#installedPlugins.has(target)) {
        logger.warn('Plugin already installed.');
        return this;
      }
      this.#installedPlugins.add(target);

      if (typeof target === 'function') {
        return target(this, options);
      } else if (target && typeof target.install === 'function') {
        return target.install(this, options);
      } else {
        throw new Error('Plugin must be a function or an object with an install method.');
      }
    };

    if (plugin && typeof plugin.then === 'function') {
      this.#installedPlugins.add(plugin);
      return plugin.then((res) => {
        const out = installResolved(res);
        return out && typeof out.then === 'function' ? out.then(() => this) : this;
      });
    }

    if (typeof plugin === 'function') {
      this.#installedPlugins.add(plugin);

      // The plugin is invoked exactly once. Retrying it after a failure — which
      // this previously did — replayed whatever side effects it had already
      // performed (registered directives, components, bridges) and discarded
      // the original error, leaving no way to debug a broken plugin.
      const res = plugin(this, options);

      if (res && typeof res.then === 'function') {
        return res.then((resolved) => {
          if (resolved !== undefined && resolved !== null) {
            const out = installResolved(resolved);
            return out && typeof out.then === 'function' ? out.then(() => this) : this;
          }
          return this;
        });
      }
      return this;
    }

    if (plugin && typeof plugin.install === 'function') {
      this.#installedPlugins.add(plugin);
      const res = plugin.install(this, options);
      if (res && typeof res.then === 'function') {
        return res.then(() => this);
      }
      return this;
    }

    throw new Error('Plugin must be a function or an object with an install method.');
  }

  /**
   * Registers a global mixin.
   * @param {object} mixin - The mixin definition.
   * @returns {AvenxApp} The app instance.
   */
  mixin(mixin) {
    AvenxComponent.mixin(mixin);
    return this;
  }

  /**
   * Registers an application-wide error handler.
   * @param {function(Error, AvenxComponent, string): void} callback - The error callback.
   * @returns {AvenxApp} The app instance.
   */
  onError(callback) {
    if (typeof callback === 'function') {
      this.#errorHandlers.push(callback);
    }
    return this;
  }

  /**
   * Invokes all registered error handlers safely.
   * @param {Error} error - The error that occurred.
   * @param {AvenxComponent} component - The component instance where the error occurred.
   * @param {string} origin - Description of the origin/lifecycle/event.
   * @private
   */
  _handleError(error, component, origin) {
    for (const handler of this.#errorHandlers) {
      try {
        handler(error, component, origin);
      } catch (e) {
        logger.error(`Error in global error handler: ${e.message || e}`);
      }
    }
  }

  /**
   * Registers an application-wide warning handler.
   * @param {function(string, AvenxComponent, string): void} callback - The warning callback.
   * @returns {AvenxApp} The app instance.
   */
  onWarn(callback) {
    if (typeof callback === 'function') {
      this.#warnHandlers.push(callback);
      logger.configure({
        warnHandler: (msg, context) => {
          this._handleWarn(msg, context);
        },
      });
    }
    return this;
  }

  /**
   * Invokes all registered warning handlers safely.
   * @param {string} msg - The warning message.
   * @param {object} context - Context metadata or component instance.
   * @private
   */
  _handleWarn(msg, context) {
    const comp = context && (context.component || (context instanceof AvenxComponent ? context : null));
    const codeMatch = msg && typeof msg === 'string' ? msg.match(/\[(AVX_[A-Z0-9]+)\]/) : null;
    const code = codeMatch ? codeMatch[1] : undefined;
    for (const handler of this.#warnHandlers) {
      try {
        handler(msg, comp, code);
      } catch (e) {
        logger.error(`Error in global warning handler: ${e.message || e}`);
      }
    }
  }

  /**
   * Registers a component with the application.
   * @param {string} name - The name of the component.
   * @param {Function} compClass - The component class.
   */
  register(name, compClass) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      const msg = `Component name must be a non-empty string. received: "${JSON.stringify(name)}"`;
      logger.warn(msg);
      throw new Error(msg);
    }

    const isFunction = typeof compClass === 'function';
    const extendsBase = isFunction && (compClass === AvenxComponent || compClass.prototype instanceof AvenxComponent);

    if (!isFunction || !extendsBase) {
      const receivedType = isFunction ? (compClass.name || 'anonymous function') : typeof compClass;
      const msg = `Component "${name}" must be a class extending AvenxComponent. received: "${receivedType}"`;
      logger.warn(msg);
      throw new Error(msg);

    }

    if (this.components.has(name)) {
      throw new AvenxError(AvenxErrorCodes.COMPILER_DUPLICATE_COMPONENT_NAME, `  "${name}"`);
    }
    this.components.set(name, compClass);
  }

  /**
   * Registers a page with the application.
   * @param {string} name - The name of the page.
   * @param {Function} pageClass - The page class.
   */
  registerPage(name, pageClass) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      const msg = `Page name must be a non-empty string. received: "${JSON.stringify(name)}"`;
      logger.warn(msg);
      throw new Error(msg);
    }

    const isFunction = typeof pageClass === 'function';
    const extendsBase = isFunction && (pageClass === AvenxComponent || pageClass.prototype instanceof AvenxComponent);

    if (!isFunction || !extendsBase) {
      const receivedType = isFunction ? (pageClass.name || 'anonymous function') : typeof pageClass;
      const msg = `Page "${name}" must be a class extending AvenxComponent. received: "${receivedType}"`;
      logger.warn(msg);
      throw new Error(msg);

    }

    if (this.pages.has(name)) {
      logger.warn(formatMessage(AvenxErrorCodes.PAGE_ALREADY_REGISTERED, name));
    }

    this.pages.set(name, pageClass);
  }

  /**
   * Returns the names of all registered components.
   * @returns {string[]} Registered component names.
   */
  getRegisteredComponents() {
    return Array.from(this.components.keys());
  }

  /**
   * Returns the names of all registered pages.
   * @returns {string[]} Registered page names.
   */
  getRegisteredPages() {
    return Array.from(this.pages.keys());
  }



  /**
   * Retrieves the currently active page component instance.
   * @returns {AvenxComponent|null}
   */
  get activePage() {
    return this.#activeComponents[this.#activeComponents.length - 1] || null;
  }

  /**
   * Registers a custom directive with the application.
   * @param {string} name - The name of the directive.
   * @param {object} definition - The directive definition with lifecycle hooks.
   * @returns {AvenxApp} The app instance.
   */
  directive(name, definition) {
    this.directives.set(name, definition);
    return this;
  }

  /**
   * Initializes the router for the application.
   * @param {Object<string, string>} routes - Route mapping.
   * @param {object} [options] - Router options.
   * @returns {AvenxRouter} The router instance.
   */
  initRouter(routes, options = {}) {
    this.router = new AvenxRouter(this, routes, options);
    this.router.start();
    return this.router;
  }

  /**
   * Registers a bridge with the application.
   * Bridges provide shared state and logic across components.
   * @param {string} name - The name of the bridge.
   * @param {object | Function} bridgeData - A bridge() instance, a plain object, or a legacy bridge constructor.
   */
  registerBridge(name, bridgeData) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      const msg = `Bridge name must be a non-empty string. received: "${JSON.stringify(name)}"`;
      logger.warn(msg);
      throw new Error(msg);
    }

    if (Object.prototype.hasOwnProperty.call(this.bridges, name)) {
      const availableBridges = Object.keys(this.bridges).join(',');
      const suggestion = `Please use a unique name`;
      throw new AvenxError(AvenxErrorCodes.BRIDGE_ALREADY_EXISTS, name, availableBridges || 'none', suggestion);
    }

    // A bridge() instance is already reactive and already read-only for
    // consumers. Wrapping it again would defeat both, so it is indexed as-is;
    // registration exists only so devtools can enumerate bridges.
    if (isBridge(bridgeData)) {
      this.bridges[name] = bridgeData;
      return;
    }

    let instance = bridgeData;

    if (typeof bridgeData === 'function') {
      try {
        instance = new bridgeData();
      } catch (err) {
        throw new AvenxError(AvenxErrorCodes.BRIDGE_CONSTRUCTION_FAILED, name, err.message || err);
      }
    }

    const handlerFactory = new ProxyHandlerFactory({
      onChange: () => { },
    });
    const reactiveState = new Proxy(instance, handlerFactory.create());
    this.bridges[name] = reactiveState;
  }

  /**
   * Updates all active components in the application.
   */
  updateAll() {
    this.#activeComponents.forEach((comp) => comp.update());
  }

  /**
   * Mounts a page to the main application container.
   * @param {string} name - The name of the page to mount.
   * @param {object} [params] - Dynamic route parameters to inject.
   * @param {object} [options] - Mount options, e.g., transition options.
   */
  mountPage(name, params = {}, options = {}) {
    const PageClass = this.pages.get(name);
    if (!PageClass) {
      throw new AvenxError(AvenxErrorCodes.PAGE_NOT_FOUND, name);
    }
    const LayoutClass = options.layout ? this.pages.get(options.layout) : null;
    if (options.layout && !LayoutClass) {
      throw new AvenxError(AvenxErrorCodes.PAGE_NOT_FOUND, options.layout);
    }

    if (this.#target) {
      const activeLayout = this.#activeComponents[0];
      const activeLayoutName = activeLayout ? activeLayout.$pageName : null;
      const activeChild = this.#activeComponents[1];

      const isSameLayout = activeLayout && LayoutClass && activeLayout instanceof LayoutClass;
      const isSamePage = !options.layout && activeLayout && activeLayout instanceof PageClass;

      const targetToUpdate = isSameLayout ? (activeChild && activeChild instanceof PageClass ? activeChild : null) : (isSamePage ? activeLayout : null);

      if (targetToUpdate) {
        targetToUpdate.$app = this;
        if (targetToUpdate.params) {
          for (const key of Object.keys(targetToUpdate.params)) {
            if (!(key in params)) {
              delete targetToUpdate.state[key];
              delete targetToUpdate.params[key];
            }
          }
        } else {
          targetToUpdate.params = {};
        }

        for (const [key, val] of Object.entries(params)) {
          targetToUpdate.state[key] = val;
          targetToUpdate.params[key] = val;
        }

        if (typeof targetToUpdate.onActivate === 'function') {
          try {
            targetToUpdate.onActivate(params);
          } catch (err) {
            logger.error('Error in onActivate hook:', err);
          }
        }
        return;
      }

      const transitionName = options.transition;
      let unmountPromise = null;
      const toUnmount = [];
      if (isSameLayout) {
        if (activeChild) toUnmount.push(activeChild);
      } else {
        if (activeChild) toUnmount.push(activeChild);
        if (activeLayout) toUnmount.push(activeLayout);
      }

      const unmountPromises = [];
      for (const comp of toUnmount) {
        if (comp === activeLayout && comp._isKeepAlive && this.#pageCache && activeLayoutName) {
          const domFragment = document.createDocumentFragment();
          const children = Array.from(this.#target.childNodes);
          children.forEach((child) => domFragment.appendChild(child));

          delete this.#target.__avenx_comp_instance;
          comp.__setMountTarget(domFragment, true);

          if (typeof comp.onDeactivate === 'function') {
            try {
              comp.onDeactivate();
            } catch (err) {
              logger.error('Error in onDeactivate hook:', err);
            }
          }

          this.#pageCache.set(activeLayoutName, {
            pageInstance: comp,
            domFragment: domFragment
          });
        } else {
          if (typeof comp.unmount === 'function') {
            const res = comp.unmount();
            if (res instanceof Promise) {
              unmountPromises.push(res);
            }
          }
        }
      }

      if (unmountPromises.length > 0) {
        unmountPromise = Promise.all(unmountPromises);
      }

      const proceed = () => {
        if (!isSameLayout) {
          this.#activeComponents = [];
        } else {
          this.#activeComponents = [activeLayout];
        }

        let mountTarget = this.#target;
        let wrapper = null;

        if (isSameLayout) {
          wrapper = activeLayout.$element ? activeLayout.$element.querySelector('[data-ax-router-view]') : null;
          if (wrapper) {
            mountTarget = wrapper;
          } else {
            // Fallback if slot wasn't rendered yet
            wrapper = document.createElement('div');
            wrapper.setAttribute('data-ax-router-view', 'true');
            activeLayout.$element.appendChild(wrapper);
            mountTarget = wrapper;
          }
        }

        let exitWrapper = null;
        if (transitionName && mountTarget.childNodes.length > 0 && mountTarget.parentNode) {
          exitWrapper = document.createElement('div');
          exitWrapper.className = 'ax-page-exit-wrapper';
          const children = Array.from(mountTarget.childNodes);
          children.forEach((child) => exitWrapper.appendChild(child));
          mountTarget.parentNode.insertBefore(exitWrapper, mountTarget);
        }

        if (!isSameLayout) {
          mountTarget.innerHTML = '';
        }

        const setupPage = (PClass, pName, pParams, mTarget, isTopLevel) => {
          let inst;
          const isCached = isTopLevel && this.#pageCache && this.#pageCache.has(pName);
          if (isCached) {
            const cached = this.#pageCache.get(pName);
            this.#pageCache.delete(pName);
            inst = cached.pageInstance;
            const domFragment = cached.domFragment;

            mTarget.appendChild(domFragment);
            inst.__setMountTarget(mTarget, true);
          } else {
            inst = new PClass(this.bridges, this.components);
            inst.$app = this;
            inst.$pageName = pName;
            inst._isKeepAlive = !!options.keepAlive;

            inst.params = pParams;
            for (const [key, val] of Object.entries(pParams)) {
              inst.state[key] = val;
            }

            inst.mount(mTarget);
          }

          if (isCached) {
            inst.params = pParams;
            for (const [key, val] of Object.entries(pParams)) {
              inst.state[key] = val;
            }
          }

          if (typeof inst.onActivate === 'function') {
            try {
              inst.onActivate(pParams);
            } catch (err) {
              logger.error('Error in onActivate hook:', err);
            }
          }
          this.#activeComponents.push(inst);
          return inst;
        };

        if (LayoutClass && !isSameLayout) {
          wrapper = document.createElement('div');
          wrapper.setAttribute('data-ax-router-view', 'true');
          this.#target.appendChild(wrapper);
          const layoutInst = setupPage(LayoutClass, options.layout, params, this.#target, true);

          // Re-find wrapper in case it moved to slot
          wrapper = layoutInst.$element ? layoutInst.$element.querySelector('[data-ax-router-view]') : wrapper;
          setupPage(PageClass, name, params, wrapper, false);
        } else if (LayoutClass && isSameLayout) {
          wrapper.innerHTML = '';
          setupPage(PageClass, name, params, wrapper, false);
        } else {
          setupPage(PageClass, name, params, this.#target, true);
        }

        if (transitionName) {
          const patcher = new DomPatcher();
          if (exitWrapper) {
            patcher.leave(exitWrapper, transitionName, () => {
              if (exitWrapper.parentNode) {
                exitWrapper.parentNode.removeChild(exitWrapper);
              }
            });
          }
          const targetForTransition = wrapper || this.#target;
          const newPageChildren = Array.from(targetForTransition.childNodes).filter(
            (node) => node.nodeType === Node.ELEMENT_NODE,
          );
          newPageChildren.forEach((child) => {
            patcher.enter(child, transitionName);
          });
        }
      };

      if (unmountPromise) {
        unmountPromise.then(proceed);
      } else {
        proceed();
      }
    }
  }
  /**
   * Mounts a component to a target element.
   * @param {string} name - The name of the component to mount.
   * @param {string|null} [targetSelector] - Optional selector for the mount target.
   */
  mount(name, targetSelector = null) {
    const Comp = this.components.get(name);
    if (!Comp) {
      const registeredList = Array.from(this.components.keys()).join(', ');
      throw new AvenxError(AvenxErrorCodes.COMPONENT_NOT_FOUND, name, registeredList);
    }
    const target = targetSelector ? document.querySelector(targetSelector) : this.#target;
    if (!target) {
      throw new AvenxError(AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND, targetSelector || 'default target');
    }
    const compInstance = new Comp(this.bridges);
    compInstance.$app = this;
    compInstance.mount(target);
    this.#activeComponents.push(compInstance);
  }

  /**
   * Programmatically clears cached KeepAlive component instances.
   * If componentName is specified, invalidates only that cached instance.
   * If omitted, purges all cached entries.
   * Unmounts cached instances and destroys their cached DOM trees.
   * @param {string} [componentName] - Optional name of component/page to clear from cache.
   * @returns {boolean} True if cache entries were evicted, false otherwise.
   */
  clearKeepAliveCache(componentName) {
    if (!this.#pageCache) return false;

    let evicted = false;
    if (componentName !== undefined && componentName !== null && componentName !== '') {
      let keyToRemove = null;
      if (this.#pageCache.has(componentName)) {
        keyToRemove = componentName;
      } else {
        for (const [key, cached] of this.#pageCache.cache.entries()) {
          if (
            cached &&
            cached.pageInstance &&
            (cached.pageInstance.$pageName === componentName ||
              cached.pageInstance.constructor?.name === componentName)
          ) {
            keyToRemove = key;
            break;
          }
        }
      }

      if (keyToRemove) {
        const cached = this.#pageCache.get(keyToRemove);
        this.#pageCache.delete(keyToRemove);
        if (cached && cached.pageInstance && typeof cached.pageInstance.unmount === 'function') {
          cached.pageInstance.unmount();
        }
        evicted = true;
      }
    } else {
      const entries = Array.from(this.#pageCache.cache.entries());
      if (entries.length > 0) {
        evicted = true;
      }
      for (const [key, cached] of entries) {
        this.#pageCache.delete(key);
        if (cached && cached.pageInstance && typeof cached.pageInstance.unmount === 'function') {
          cached.pageInstance.unmount();
        }
      }
      this.#pageCache.clear();
    }
    return evicted;
  }
}

