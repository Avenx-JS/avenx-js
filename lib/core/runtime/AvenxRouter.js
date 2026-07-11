import { AvenxErrorCodes, formatMessage, AvenxError } from './AvenxError.js';
import { logger } from './AvenxLogger.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';

/**
 * AvenxRouter handles hash-based routing for the application.
 * It maps URL hashes to specific Page components.
 */
export class AvenxRouter {
  /**
   * @param {AvenxApp} app - The main application instance.
   * @param {Object<string, string | object>} routes - A map of hash routes to page names or route definitions.
   * @param {object} [options] - Optional router configurations (e.g. prefix).
   */
  constructor(app, routes = {}, options = {}) {
    /** @type {AvenxApp} */
    this.app = app;
    /** @type {Object<string, string | object>} */
    this.routes = routes;
    /** @type {object} */
    this.options = options;
    this.currentRoute = null;
    /** @type {string|null} @private */
    this.hashToIgnore = null;

    for (const routePattern of Object.keys(routes)) {
      if (routePattern === '*') continue;

      // Normalize by stripping leading '#' if present
      const path = routePattern.startsWith('#') ? routePattern.slice(1) : routePattern;

      if (!path.startsWith('/')) {
        logger.warn(
          `[AvenxRouter] Route path "${routePattern}" lacks a leading slash. This may prevent hash paths from resolving properly.`,
        );
      }
    }

    // Register router globally to coordinate multiple routers
    if (!window.__avenx_routers) {
      window.__avenx_routers = new Set();
    }
    window.__avenx_routers.add(this);

    this.hashChangeHandler = () => this.#handleRoute();
    window.addEventListener('hashchange', this.hashChangeHandler);
  }

  /**
   * Starts the router and handles the initial route.
   */
  start() {
    this.#handleRoute();
  }

  /**
   * Navigates to a specific hash route.
   * @param {string} hash - The target hash (e.g., '#/about').
   */
  navigate(hash) {
    let targetHash = hash;
    if (this.options && this.options.prefix) {
      const prefix = this.options.prefix;
      if (targetHash.startsWith('#/')) {
        targetHash = '#' + prefix + targetHash.substring(1);
      } else if (targetHash.startsWith('#')) {
        targetHash = '#' + prefix + '/' + targetHash.substring(1);
      }
    }
    window.location.hash = targetHash;
  }

  /**
   * Destroys the router and cleans up event listeners.
   */
  destroy() {
    window.removeEventListener('hashchange', this.hashChangeHandler);
    if (window.__avenx_routers) {
      window.__avenx_routers.delete(this);
    }
  }

  /**
   * Checks if this router has a matching route (excluding fallback) for the given hash.
   * @param {string} hash - The URL hash.
   * @returns {boolean} True if a non-fallback route matches.
   */
  matches(hash) {
    let normalizedHash = hash || '#/';

    // Strip any secondary anchor (e.g. #/profile#details)
    const secondHashIndex = normalizedHash.indexOf('#', 1);
    if (secondHashIndex !== -1) {
      normalizedHash = normalizedHash.substring(0, secondHashIndex);
    }

    // Handle router prefix if specified
    if (this.options && this.options.prefix) {
      const prefix = this.options.prefix;
      const expectedStart = '#' + prefix;
      if (!normalizedHash.startsWith(expectedStart)) {
        return false;
      }
      normalizedHash = '#' + normalizedHash.substring(expectedStart.length);
      if (!normalizedHash.startsWith('#/')) {
        normalizedHash = '#/' + normalizedHash.substring(1);
      }
    }

    for (const routePattern of Object.keys(this.routes)) {
      if (routePattern === '*') continue;

      const regexStr = routePattern.replace(/[.*+^${}()|[\]\\]/g, '\\$&').replace(/:([a-zA-Z0-9_$]+)/g, '([^/]+)');
      const regex = new RegExp(`^${regexStr}$`);

      const [pathPart] = normalizedHash.split('?');
      if (pathPart.match(regex)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sequentially executes an array of guards for a route transition.
   * @param {Array<typeof AvenxGuard|AvenxGuard>} guards - Route guards.
   * @param {object} to - Target route details.
   * @param {object | null} from - Current route details.
   * @returns {Promise<boolean|string>} Result of the guard checks (true, false, or redirect path).
   * @private
   */
  #runGuards(guards, to, from) {
    return new Promise((resolve, reject) => {
      const nextGuard = (index) => {
        if (index >= guards.length) {
          resolve(true);
          return;
        }
        const Guard = guards[index];
        const instance = typeof Guard === 'function' ? new Guard() : Guard;

        const guardTimeout = this.options && this.options.guardTimeout !== undefined ? this.options.guardTimeout : 5000;

        let timeoutId;
        const timeoutPromise = new Promise((_, reqReject) => {
          timeoutId = setTimeout(() => {
            reqReject(new AvenxError(AvenxErrorCodes.ROUTER_GUARD_TIMEOUT, guardTimeout, to.hash));
          }, guardTimeout);
        });

        Promise.race([Promise.resolve(instance.canActivate(to, from)), timeoutPromise])
          .then((result) => {
            clearTimeout(timeoutId);
            if (result === false || typeof result === 'string') {
              resolve(result);
            } else {
              nextGuard(index + 1);
            }
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            if (err.code === AvenxErrorCodes.ROUTER_GUARD_TIMEOUT) {
              reject(err);
            } else {
              logger.error(formatMessage(AvenxErrorCodes.ROUTER_GUARD_ERROR, to.hash, err));
              resolve(false);
            }
          });
      };
      nextGuard(0);
    });
  }

  /**
   * Handles the current route by matching it against patterns, executing guards,
   * and mounting the corresponding page.
   * @private
   */
  #handleRoute() {
    let hash = window.location.hash || '#/';

    // Strip any secondary anchor (e.g. #/profile#details)
    const secondHashIndex = hash.indexOf('#', 1);

    if (secondHashIndex !== -1) {
      hash = hash.substring(0, secondHashIndex);
    }

    // Handle router prefix if specified
    if (this.options && this.options.prefix) {
      const prefix = this.options.prefix; // e.g. "/app1"
      const expectedStart = '#' + prefix; // e.g. "#/app1"
      if (!hash.startsWith(expectedStart)) {
        // This route is not for this router namespace
        return;
      }
      // Strip prefix for matching
      hash = '#' + hash.substring(expectedStart.length);
      if (!hash.startsWith('#/')) {
        hash = '#/' + hash.substring(1);
      }
    }

    if (this.hashToIgnore === hash) {
      this.hashToIgnore = null;
      return;
    }

    let matchedRoute = null;
    const params = {};

    for (const [routePattern, routeDef] of Object.entries(this.routes)) {
      if (routePattern === '*') continue;

      const paramNames = [];
      const regexStr = routePattern.replace(/[.*+^${}()|[\]\\]/g, '\\$&').replace(/:([a-zA-Z0-9_$]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      });
      const regex = new RegExp(`^${regexStr}$`);

      const [pathPart, queryPart] = hash.split('?');
      const match = pathPart.match(regex);

      if (match) {
        matchedRoute = { pattern: routePattern, definition: routeDef };
        paramNames.forEach((name, idx) => {
          const value = match[idx + 1];

          try {
            params[name] = decodeURIComponent(value);
          } catch {
            logger.warn(`[AvenxRouter] Failed to decode route parameter "${name}": ${value}`);

            params[name] = value;
          }
        });
        if (queryPart) {
          const queryParams = new URLSearchParams(queryPart);
          params.query = Object.fromEntries(queryParams.entries());
        }
        break;
      }
    }

    // Fallback to '*' if no route matched
    let otherRouterMatches = false;
    if (!matchedRoute && this.routes['*']) {
      // Check if any other active router matches this hash
      const rawHash = window.location.hash || '#/';
      otherRouterMatches = Array.from(window.__avenx_routers || []).some((r) => r !== this && r.matches(rawHash));

      if (!otherRouterMatches) {
        matchedRoute = { pattern: '*', definition: this.routes['*'] };
      }
    }

    if (!matchedRoute) {
      if (!otherRouterMatches) {
        logger.warn(`[AvenxRouter] No route defined for hash: ${hash}`);
      }
      return;
    }

    const def = matchedRoute.definition;
    const pageName = typeof def === 'string' ? def : def.page;
    const guards = typeof def === 'object' ? def.guards || [] : [];

    const to = { hash, page: pageName, params };
    const from = this.currentRoute;

    this.#runGuards(guards, to, from)
      .then((result) => {
        if (result === false) {
          logger.warn(formatMessage(AvenxErrorCodes.ROUTER_GUARD_DENIED, to.hash));
          if (from && from.hash !== window.location.hash) {
            this.hashToIgnore = from.hash;
            window.location.hash = from.hash;
          }
        } else if (typeof result === 'string') {
          this.navigate(result);
        } else {
          this.currentRoute = to;
          const transitionName = (typeof def === 'object' && def.transition) || this.options.transition;
          this.app.mountPage(pageName, params, { transition: transitionName });
        }
      })
      .catch((err) => {
        logger.error(err);
        if (this.options && this.options.guardTimeoutRedirect) {
          this.navigate(this.options.guardTimeoutRedirect);
        } else {
          if (from && from.hash !== window.location.hash) {
            this.hashToIgnore = from.hash;
            window.location.hash = from.hash;
          }
        }
      });
  }

  #currentRouteProxy = null;
  #currentRouteIsNull = true;

  /**
   * Getter for currentRoute. Returns null if null was assigned, or the stable reactive proxy.
   * @returns {object|null}
   */
  get currentRoute() {
    return this.#currentRouteIsNull ? null : this.#currentRouteProxy;
  }

  /**
   * Setter for currentRoute. Reactively updates the stable proxy properties.
   * @param {object|null} val
   */
  set currentRoute(val) {
    if (val === null) {
      this.#currentRouteIsNull = true;
      if (this.#currentRouteProxy) {
        this.#currentRouteProxy.hash = '';
        this.#currentRouteProxy.page = '';
        for (const key of Object.keys(this.#currentRouteProxy.params)) {
          delete this.#currentRouteProxy.params[key];
        }
      }
    } else {
      this.#currentRouteIsNull = false;
      if (!this.#currentRouteProxy) {
        const handlerFactory = new ProxyHandlerFactory();
        this.#currentRouteProxy = new Proxy({ hash: '', page: '', params: {} }, handlerFactory.create());
      }
      this.#currentRouteProxy.hash = val.hash;
      this.#currentRouteProxy.page = val.page;
      for (const key of Object.keys(this.#currentRouteProxy.params)) {
        delete this.#currentRouteProxy.params[key];
      }
      for (const [key, v] of Object.entries(val.params || {})) {
        this.#currentRouteProxy.params[key] = v;
      }
    }
  }
}
