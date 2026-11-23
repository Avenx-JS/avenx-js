import { AvenxError, AvenxErrorCodes } from './AvenxError.js';

/** @type {Function|null} The constructor installed by the router entry point. */
let routerClass = null;

/**
 * Registers the router without making it a dependency of the application class.
 * @param {{AvenxRouter: Function}} capability - The router implementation.
 */
export function installRouter(capability) {
  routerClass = capability.AvenxRouter;
}

/**
 * Returns the linked router or an actionable missing-capability diagnostic.
 * @returns {Function} The router constructor.
 */
export function requireRouter() {
  if (!routerClass) throw new AvenxError(AvenxErrorCodes.ROUTER_UNAVAILABLE);
  return routerClass;
}
