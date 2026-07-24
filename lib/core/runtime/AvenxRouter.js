import { AvenxErrorCodes, formatMessage, AvenxError } from './AvenxError.js';
import { logger } from './AvenxLogger.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';
import { RouteMatcher } from './RouteMatcher.js';
import { createNavigationDelegate } from './navigation/index.js';

/**
 * AvenxRouter handles routing for the application.
 * Matches URL route definitions to specific Page components using pluggable navigation delegates.
 */
export class AvenxRouter {
  /**
   * @param {AvenxApp} app - The main application instance.
   * @param {Object<string, string | object>} routes - A map of hash routes to page names or route definitions.
   * @param {object} [options] - Optional router configurations (e.g. prefix, delegate, mode).
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

    /** @type {import('./navigation/NavigationDelegate.js').NavigationDelegate} */
    this.delegate = createNavigationDelegate(options);

    for (const routePattern of Object.keys(routes)) {
      if (routePattern === '*') continue;

      // Normalize by stripping leading '#' if present
      const path = routePattern.startsWith('#') ? routePattern.slice(1) : routePattern;

      if (!path.startsWith('/')) {
        logger.warn(formatMessage(AvenxErrorCodes.ROUTE_PATH_MISSING_LEADING_SLASH, routePattern));
      }
    }

    this.delegate.registerRouter(this);

    this.unsubscribeHashChange = this.delegate.onHashChange(() => this.#handleRoute());
    this.unsubscribeLinkClick = this.delegate.onLinkClick((route) => this.navigate(route));
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
    // Force clean paths like '/profile' into hash paths like '#/profile'
    let targetHash = hash.startsWith('#') ? hash : '#' + hash;

    if (this.options && this.options.prefix) {
      const prefix = this.options.prefix;
      if (targetHash.startsWith('#/')) {
        targetHash = '#' + prefix + targetHash.substring(1);
      } else if (targetHash.startsWith('#')) {
        targetHash = '#' + prefix + '/' + targetHash.substring(1);
      }
    }
    this.delegate.setHash(targetHash);
  }

  /**
   * Destroys the router and cleans up event listeners.
   */
  destroy() {
    if (this.unsubscribeHashChange) this.unsubscribeHashChange();
    if (this.unsubscribeLinkClick) this.unsubscribeLinkClick();
    this.delegate.unregisterRouter(this);
    this.delegate.destroy();
  }

  /**
   * Checks if this router has a matching route (excluding fallback) for the given hash.
   * @param {string} hash - The URL hash.
   * @returns {boolean} True if a non-fallback route matches.
   */
  matches(hash) {
    return RouteMatcher.matches(this.routes, decodeURIComponent(hash), this.options);
  }

  /**
   * Sequentially executes an array of guards for a route transition.
   * @param {Array<typeof AvenxGuard|AvenxGuard>} guards - Route guards.
   * @param {object} to - Target route details.
   * @param {object | null} from - Current route details.
   * @returns {Promise<boolean|string|object>} Result of the guard checks.
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
            const isControlObject =
              typeof result === 'object' &&
              result !== null &&
              (result.cancel === true || typeof result.redirect === 'string');

            if (result === false || typeof result === 'string' || isControlObject) {
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
    const hash = this.delegate.getHash();

    if (this.hashToIgnore === hash) {
      this.hashToIgnore = null;
      return;
    }

    const activeRouters = this.delegate.getActiveRouters();
    const { matchedRoute, params, otherRouterMatches, normalizedHash } = RouteMatcher.matchRoute(
      this.routes,
      hash,
      this.options,
      activeRouters,
      this,
    );

    if (!matchedRoute) {
      if (!otherRouterMatches) {
        logger.warn(formatMessage(AvenxErrorCodes.ROUTE_NOT_FOUND, hash));
      }
      return;
    }

    const def = matchedRoute.definition;
    const pageName = typeof def === 'string' ? def : def.page;
    const guards = typeof def === 'object' ? def.guards || [] : [];

    const to = { hash: normalizedHash, page: pageName, params };
    const from = this.currentRoute;

    this.#runGuards(guards, to, from)
      .then((result) => {
        if (result === false) {
          logger.warn(formatMessage(AvenxErrorCodes.ROUTER_GUARD_DENIED, to.hash));
          if (from && from.hash !== this.delegate.getHash()) {
            this.hashToIgnore = from.hash;
            this.delegate.setHash(from.hash);
          }
        } else if (typeof result === 'string') {
          this.navigate(result);
        } else if (
          typeof result === 'object' &&
          result !== null &&
          (result.cancel === true || typeof result.redirect === 'string')
        ) {
          if (result.cancel) {
            if (!result.silent) {
              logger.warn(formatMessage(AvenxErrorCodes.ROUTER_GUARD_DENIED, to.hash));
            }
            if (from && from.hash !== this.delegate.getHash()) {
              this.hashToIgnore = from.hash;
              this.delegate.setHash(from.hash);
            }
          } else if (result.redirect) {
            let redirectPath = result.redirect;
            const paramsToAppend = { ...result.state, ...result.query };
            if (Object.keys(paramsToAppend).length > 0) {
              const [pathPart, queryPart] = redirectPath.split('?');
              const searchParams = new URLSearchParams(queryPart || '');
              for (const [key, value] of Object.entries(paramsToAppend)) {
                if (value !== undefined && value !== null) {
                  searchParams.set(key, String(value));
                }
              }
              redirectPath = pathPart + '?' + searchParams.toString();
            }
            this.navigate(redirectPath);
          }
        } else {
          this.currentRoute = to;
          this.#applyTitle(def, params);
          const transitionName = (typeof def === 'object' && def.transition) || this.options.transition;
          if (this.app && typeof this.app.mountPage === 'function') {
            this.app.mountPage(pageName, params, { transition: transitionName });
          }
        }
      })
      .catch((err) => {
        logger.error(err);
        if (this.options && this.options.guardTimeoutRedirect) {
          this.navigate(this.options.guardTimeoutRedirect);
        } else {
          if (from && from.hash !== this.delegate.getHash()) {
            this.hashToIgnore = from.hash;
            this.delegate.setHash(from.hash);
          }
        }
      });
  }

  /**
   * Resolves the title from a route definition and updates current title.
   * @param {string | object} def - The route definition.
   * @param {object} params - Parsed route parameters.
   * @private
   */
  #applyTitle(def, params) {
    const rawTitle = typeof def === 'object' ? def.title : undefined;
    if (rawTitle === undefined) return;

    let resolved;
    if (typeof rawTitle === 'function') {
      try {
        resolved = rawTitle(params);
      } catch (err) {
        logger.warn(formatMessage(AvenxErrorCodes.ROUTE_TITLE_EVALUATION_FAILED, err));
        return;
      }
    } else {
      resolved = rawTitle;
    }

    if (typeof resolved !== 'string') return;

    const prefix = this.options.titlePrefix || '';
    const suffix = this.options.titleSuffix || '';
    this.delegate.setTitle(prefix + resolved + suffix);
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
