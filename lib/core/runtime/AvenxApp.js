import { AvenxRouter } from './AvenxRouter.js';
import { AvenxError, AvenxErrorCodes } from './AvenxError.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';
import { DomPatcher } from '../renderer/domPatch.js';

import { logger } from './AvenxLogger.js';

/**
 * The main application class for Avenx.
 * Manages component registration, bridge registration, and mounting.
 */
export class AvenxApp {
  /** @type {AvenxComponent[]} @private */
  #activeComponents = [];
  /** @type {Element|null} @private */
  #target = null;

  /**
   * @param {object} config - Application configuration.
   * @param {string} config.target - Selector for the main application container.
   */
  constructor(config) {
    this.#target = document.querySelector(config.target);
    if (!this.#target) {
      throw new AvenxError(AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND, config.target);
    }
    /** @type {Map<string, typeof AvenxComponent>} */
    this.components = new Map();
    /** @type {Map<string, typeof AvenxPage>} */
    this.pages = new Map();
    /** @type {object} */
    this.bridges = {};
    /** @type {AvenxRouter|null} */
    this.router = null;
    this.updateAll = this.updateAll.bind(this);
    if (config.logging) {
      logger.configure(config.logging);
    }
  }

  /**
   * Registers a component with the application.
   * @param {string} name - The name of the component.
   * @param {typeof AvenxComponent} compClass - The component class.
   */
  register(name, compClass) {
    this.components.set(name, compClass);
  }

  /**
   * Registers a page with the application.
   * @param {string} name - The name of the page.
   * @param {typeof AvenxPage} pageClass - The page class.
   */
  registerPage(name, pageClass) {
    if (this.pages.has(name)) {
      logger.warn(`Page "${name}" is already registered and will be overwritten.`);
    }

    this.pages.set(name, pageClass);
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
   * @param {object | Function} bridgeData - The bridge data or constructor.
   */
  registerBridge(name, bridgeData) {
    if (Object.prototype.hasOwnProperty.call(this.bridges, name)) {
      const availableBridges = Object.keys(this.bridges).join(',');
      const suggestion = `Please use a unique name`;
      throw new AvenxError(AvenxErrorCodes.BRIDGE_ALREADY_EXISTS, name, availableBridges || 'none', suggestion);
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
      onChange: () => {},
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
    if (this.#target) {
      const activePage = this.#activeComponents[0];
      if (activePage && activePage instanceof PageClass) {
        // Delete keys from previous params that are not in new params
        if (activePage.params) {
          for (const key of Object.keys(activePage.params)) {
            if (!(key in params)) {
              delete activePage.state[key];
              delete activePage.params[key];
            }
          }
        } else {
          activePage.params = {};
        }

        // Update or set new params
        for (const [key, val] of Object.entries(params)) {
          activePage.state[key] = val;
          activePage.params[key] = val;
        }
        return;
      }

      const transitionName = options.transition;

      // Cleanup current components
      this.#activeComponents.forEach((comp) => {
        if (typeof comp.unmount === 'function') {
          comp.unmount();
        }
      });
      this.#activeComponents = [];

      let exitWrapper = null;
      if (transitionName && this.#target.childNodes.length > 0 && this.#target.parentNode) {
        exitWrapper = document.createElement('div');
        exitWrapper.className = 'ax-page-exit-wrapper';
        const children = Array.from(this.#target.childNodes);
        children.forEach((child) => exitWrapper.appendChild(child));
        this.#target.parentNode.insertBefore(exitWrapper, this.#target);
      }

      this.#target.innerHTML = '';

      // Pages receive both bridges and the component registry for child mounting
      const pageInstance = new PageClass(this.bridges, this.components);

      pageInstance.params = params;
      for (const [key, val] of Object.entries(params)) {
        pageInstance.state[key] = val;
      }

      pageInstance.mount(this.#target);
      this.#activeComponents.push(pageInstance);

      if (transitionName) {
        const patcher = new DomPatcher();
        if (exitWrapper) {
          patcher.leave(exitWrapper, transitionName, () => {
            if (exitWrapper.parentNode) {
              exitWrapper.parentNode.removeChild(exitWrapper);
            }
          });
        }
        const newPageChildren = Array.from(this.#target.childNodes).filter(
          (node) => node.nodeType === Node.ELEMENT_NODE,
        );
        newPageChildren.forEach((child) => {
          patcher.enter(child, transitionName);
        });
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
    compInstance.mount(target);
    this.#activeComponents.push(compInstance);
  }
}
