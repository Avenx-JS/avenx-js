import { ProxyHandlerFactory } from './proxyHandler.js';

/**
 * Factory for creating reactive state objects.
 */
export class StateFactory {
  /**
   * @param {typeof ProxyHandlerFactory} [handlerFactoryClass] - The factory class to create proxy handlers.
   */
  constructor(handlerFactoryClass = ProxyHandlerFactory) {
    /** @type {typeof ProxyHandlerFactory} */
    this.handlerFactoryClass = handlerFactoryClass;
  }

  /**
   * Creates a reactive proxy for the given initial state.
   * @param {object} [initialState] - The initial state object.
   * @param {object} [options] - Configuration options for the proxy handler.
   * @returns {Proxy} The reactive state proxy.
   */
  create(initialState = {}, options = {}) {
    const handlerFactory = new this.handlerFactoryClass(options);
    return new Proxy(initialState, handlerFactory.create());
  }
}
