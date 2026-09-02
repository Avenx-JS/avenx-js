import { ProxyHandlerFactory, IS_REACTIVE_PROXY, PROXY_REF_SYMBOL } from './proxyHandler.js';

export { toRaw, isReactive, markRaw } from './proxyHandler.js';

/**
 * Factory for creating reactive state objects.
 */
export class StateFactory {
  /**
   * @param {Function} [handlerFactoryClass] - The factory class to create proxy handlers.
   */
  constructor(handlerFactoryClass = ProxyHandlerFactory) {
    /** @type {Function} */
    this.handlerFactoryClass = handlerFactoryClass;
  }

  /**
   * Creates a reactive proxy for the given initial state.
   * @param {object} [initialState] - The initial state object.
   * @param {object} [options] - Configuration options for the proxy handler.
   * @returns {Proxy} The reactive state proxy.
   */
  create(initialState = {}, options = {}) {
    if (initialState && initialState[IS_REACTIVE_PROXY]) {
      return initialState;
    }

    if (initialState && initialState[PROXY_REF_SYMBOL]) {
      return initialState[PROXY_REF_SYMBOL];
    }

    const persistKeys = new Set(options.persist || []);

    if (
      persistKeys.size > 0 &&
      typeof localStorage !== 'undefined' &&
      initialState &&
      typeof initialState === 'object'
    ) {
      for (const key of persistKeys) {
        try {
          const storedValue = localStorage.getItem(key);

          if (storedValue !== null) {
            initialState[key] = JSON.parse(storedValue);
          }
        } catch {
          // Ignore corrupted or unavailable persisted values.
          // The original initial state will be used instead.
        }
      }
    }

    const handlerFactory = new this.handlerFactoryClass(options);
    const proxy = new Proxy(initialState, handlerFactory.create());

    if (Object.isExtensible(initialState)) {
      Object.defineProperty(initialState, PROXY_REF_SYMBOL, {
        value: proxy,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }

    return proxy;
  }
}
