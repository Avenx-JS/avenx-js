import { AvenxErrorCodes, formatMessage, AvenxError } from './AvenxError.js';
import { logger } from './AvenxLogger.js';
import { ProxyHandlerFactory } from '../reactive/proxyHandler.js';
import { RouteMatcher } from './RouteMatcher.js';
import { createNavigationDelegate } from './navigation/index.js';
import { tracer } from '../trace/tracer.js';
import { TraceNodeType } from '../trace/schema.js';
import { announce, manageFocus } from './navigation/A11yManager.js';

// This is declared for controlling the depth of a redirected loop
const MAX_REDIRECT = 10;

/**
 * AvenxRouter handles routing for the application.
 * Matches URL route definitions to specific Page components using pluggable navigation delegates.
 */
export class AvenxRouter {
  /** @type {Map<string, { x: number, y: number }>} */
  #scrollPositions = new Map();

  /**
   * Monotonic id identifying the most recently started navigation.
   *
   * Route guards may be asynchronous, so two navigations can be in flight at
   * once and resolve out of order. Each attempt captures the id it started
   * with and only commits if it is still the current one, so a guard belonging
   * to an abandoned route cannot mount its page over the route the user
   * actually asked for.
   * @type {number}
   */
  #navigationId = 0;

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
    /** @type {{ chain: string[], count: number } | null} */
    this.redirectContext = null; // The context that is used to prevent the redirect loop using redirect chain and a maxRedirect limit
    /** @type {string|null} */
    this.hashToIgnore = null;

    /** @type {Array<Function|object>} */
    this.beforeHooks = [];
    /** @type {Array<Function>} */
    this.afterHooks = [];

    /** @type {object} */
    this.a11y = {
      focusOnNavigate: true,
      announceRouteChanges: true,
      focusTarget: '[data-ax-page-heading]',
      ...(options.a11y || {}),
    };
    this._isInitialLoad = true;

    /** @type {object} */
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
   * Registers a global guard callback that executes before route guards on navigation transitions.
   * @param {Function|object} callback - The guard callback or guard instance/class.
   * @returns {Function} Unregister function.
   */
  beforeEach(callback) {
    if (typeof callback === 'function' || (callback && typeof callback.canActivate === 'function')) {
      this.beforeHooks.push(callback);
    }
    return () => {
      const idx = this.beforeHooks.indexOf(callback);
      if (idx !== -1) {
        this.beforeHooks.splice(idx, 1);
      }
    };
  }

  /**
   * Registers a global after hook callback that executes after successful route navigation.
   * @param {Function} callback - The callback to execute after navigation.
   * @returns {Function} Unregister function.
   */
  afterEach(callback) {
    if (typeof callback === 'function') {
      this.afterHooks.push(callback);
    }
    return () => {
      const idx = this.afterHooks.indexOf(callback);
      if (idx !== -1) {
        this.afterHooks.splice(idx, 1);
      }
    };
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
   * @param {Object} [options] - Navigation options.
   */
  navigate(hash, options = {}) {
    // Force clean paths like '/profile' into hash paths like '#/profile'
    let targetHash = hash.startsWith('#') ? decodeURIComponent(hash) : '#' + decodeURIComponent(hash);

    if (this.options && this.options.prefix) {
      const prefix = this.options.prefix;
      if (targetHash.startsWith('#/')) {
        targetHash = '#' + prefix + targetHash.substring(1);
      } else if (targetHash.startsWith('#')) {
        targetHash = '#' + prefix + '/' + targetHash.substring(1);
      }
    }
    this.delegate.setHash(targetHash, options);
  }

  /**
   * Steps backward in navigation history.
   */
  back() {
    this.delegate.back();
  }

  /**
   * Steps forward in navigation history.
   */
  forward() {
    this.delegate.forward();
  }

  /**
   * Moves to a specific history position relative to current position.
   * @param {number} delta - Relative step count in history (e.g. -1 for back, 1 for forward).
   */
  go(delta) {
    this.delegate.go(delta);
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
   * Returns a snapshot of all registered routes.
   * @returns {Array<{pattern: string, definition: string | object}>}
   */
  getRoutes() {
    return Object.entries(this.routes).map(([pattern, definition]) => ({
      pattern,
      definition: typeof definition === 'object' && definition !== null ? { ...definition } : definition,
    }));
  }

  /**
   * Checks if this router has a matching route (excluding fallback) for the given hash.
   * @param {string} hash - The URL hash.
   * @returns {boolean} True if a non-fallback route matches.
   */
  matches(hash) {
    try {
      return RouteMatcher.matches(this.routes, decodeURIComponent(hash).replace(/%20/g, ' '), this.options);
    } catch {
      return RouteMatcher.matches(this.routes, hash, this.options);
    }
  }

  /**
   * Sequentially executes an array of guards for a route transition.
   * @param {Array<Function|object>} guards - Route guards.
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
        } else {
          const Guard = guards[index];
          let canActivateResult;
          try {
            if (typeof Guard === 'function') {
              if (Guard.prototype && typeof Guard.prototype.canActivate === 'function') {
                const instance = new Guard();
                canActivateResult = instance.canActivate(to, from);
              } else {
                canActivateResult = Guard(to, from);
              }
            } else if (Guard && typeof Guard.canActivate === 'function') {
              canActivateResult = Guard.canActivate(to, from);
            } else {
              canActivateResult = true;
            }
          } catch (err) {
            canActivateResult = Promise.reject(err);
          }

          const guardTimeout = this.options && this.options.guardTimeout !== undefined ? this.options.guardTimeout : 5000;

          let timeoutId;
          const timeoutPromise = new Promise((_, reqReject) => {
            timeoutId = setTimeout(() => {
              reqReject(new AvenxError(AvenxErrorCodes.ROUTER_GUARD_TIMEOUT, guardTimeout, to.hash));
            }, guardTimeout);
          });

          Promise.race([Promise.resolve(canActivateResult), timeoutPromise])
            .then((result) => {
              clearTimeout(timeoutId);
              if (result === undefined) {
                logger.warn(formatMessage(AvenxErrorCodes.ROUTER_GUARD_UNDEFINED_RETURN, to.hash));
                nextGuard(index + 1);
                return;
              }
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
        }
      };
      nextGuard(0);
    });
  }

  /**
   * Sequentially executes all registered global after hooks.
   * @param {object} to - Target route details.
   * @param {object|null} from - Previous route details.
   * @private
   */
  #runAfterHooks(to, from) {
    for (const hook of this.afterHooks) {
      try {
        const res = hook(to, from);
        if (res && typeof res.catch === 'function') {
          res.catch((err) => {
            logger.error(formatMessage(AvenxErrorCodes.ROUTER_GUARD_ERROR, to.hash, err));
          });
        }
      } catch (err) {
        logger.error(formatMessage(AvenxErrorCodes.ROUTER_GUARD_ERROR, to.hash, err));
      }
    }
  }

  /**
   * Handles the current route by matching it against patterns, executing guards,
   * and mounting the corresponding page.
   * @private
   */
  #handleRoute() {
    // Starting a new navigation supersedes any still-pending one.
    const navigationId = ++this.#navigationId;

    let hash = this.delegate.getHash();
    try {
      hash = decodeURIComponent(hash);
    } catch {
      // Fallback
    }

    if (this.hashToIgnore === hash) {
      this.hashToIgnore = null;
      return;
    }

    const activeRouters = this.delegate.getActiveRouters();
    const { matchedRoute, params, query, path, otherRouterMatches, normalizedHash } = RouteMatcher.matchRoute(
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
    const meta = typeof def === 'object' && def.meta && typeof def.meta === 'object' ? def.meta : {};

    if (def && typeof def === 'object' && def.redirect) {
      // Create a new redirect context when the redirect starts
      if (!this.redirectContext) {
        this.redirectContext = {
          chain: [normalizedHash],
          count: 0,
        };
      }

      Promise.resolve()
        .then(() => {
          // If redirect is function then execute it with params
          if (typeof def.redirect === 'function') {
            return def.redirect(params);
          }

          return def.redirect;
        })
        .then((target) => {
          if (typeof target !== 'string' || target.length === 0) {
            logger.error('Invalid redirect target');
            this.redirectContext = null;
            return;
          }

          // Check the maximum redirect limit
          if (this.redirectContext.count >= MAX_REDIRECT) {
            logger.error('Maximum redirect limit exceeded');
            this.redirectContext = null;
            return;
          }

          // Normalize the target hash same like navigate does
          let targetHash = target.startsWith('#') ? decodeURIComponent(target) : '#' + decodeURIComponent(target);

          if (this.options && this.options.prefix) {
            const prefix = this.options.prefix;

            if (targetHash.startsWith('#/')) {
              targetHash = '#' + prefix + targetHash.substring(1);
            } else if (targetHash.startsWith('#')) {
              targetHash = '#' + prefix + '/' + targetHash.substring(1);
            }
          }

          // Check whether the target is already in the redirect chain
          if (this.redirectContext.chain.includes(targetHash)) {
            logger.error(`Redirect loop detected: ${[...this.redirectContext.chain, targetHash].join(' → ')}`);

            this.redirectContext = null;
            return;
          }

          this.redirectContext.chain.push(targetHash);
          this.redirectContext.count++;

          this.navigate(targetHash, { replace: true });
        })
        .catch((err) => {
          logger.error(err);
          this.redirectContext = null;
        });

      // Do not continue to page, guards or mountPage for redirect route
      return;
    }

    const parentDef = matchedRoute.parent;
    const pageName = typeof def === 'string' ? def : def.page;
    const childGuards = typeof def === 'object' ? def.guards || [] : [];
    const parentGuards = parentDef && typeof parentDef === 'object' ? parentDef.guards || [] : [];
    const guards = [...this.beforeHooks, ...parentGuards, ...childGuards];

    const to = {
      hash: normalizedHash,
      path: path || '',
      page: pageName,
      params,
      query: query || {},
      meta,
    };
    const from = this.currentRoute
      ? {
          hash: this.currentRoute.hash,
          path: this.currentRoute.path,
          page: this.currentRoute.page,
          params: { ...this.currentRoute.params },
          query: { ...this.currentRoute.query },
          meta: { ...(this.currentRoute.meta || {}) },
        }
      : null;

    this.#runGuards(guards, to, from)
      .then((result) => {
        // A newer navigation started while these guards were pending; its
        // outcome is the one that must be applied, not this one's.
        if (navigationId !== this.#navigationId) {
          return;
        }

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
          this.redirectContext = null;
          if (tracer.on) {
            tracer.record(TraceNodeType.NAVIGATION, {
              from: from ? from.hash : null,
              to: to.hash,
              page: to.page,
              params: to.params,
              query: to.query,
            });
          }
          this.currentRoute = to;
          this.#applyTitle(def, params);
          const transitionName = (typeof def === 'object' && def.transition) || this.options.transition;
          const keepAlive =
            typeof def === 'object' && def.keepAlive !== undefined ? !!def.keepAlive : !!this.options.keepAlive;
          if (this.app && typeof this.app.mountPage === 'function') {
            const layoutName = parentDef && typeof parentDef === 'object' ? parentDef.page : null;
            this.app.mountPage(pageName, params, { transition: transitionName, keepAlive, layout: layoutName });
          }
          this.#runAfterHooks(to, from);
          this.#applyScrollRestoration(to, from);

          // Accessibility management (announcements & focus shift)
          this.#applyA11y();
        }
      })
      .catch((err) => {
        if (navigationId !== this.#navigationId) {
          return;
        }

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
   * Applies focus management and live-region announcements after successful navigation.
   * @private
   */
  #applyA11y() {
    if (typeof document === 'undefined') return;

    if (this.a11y.announceRouteChanges) {
      announce(document.title);
    }

    if (this.a11y.focusOnNavigate && !this._isInitialLoad) {
      const schedule =
        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? (cb) => window.requestAnimationFrame(cb)
          : (cb) => setTimeout(cb, 0);

      schedule(() => {
        const pageRoot =
          (this.app && this.app.currentPageInstance && this.app.currentPageInstance.$el) ||
          document.querySelector('[data-ax-page]') ||
          document.querySelector('main') ||
          document.body;

        manageFocus(pageRoot, this.a11y.focusTarget);
      });
    }

    this._isInitialLoad = false;
  }

  /**
   * Applies scroll restoration after a successful navigation.
   * Modes: 'top' (default) scrolls to 0,0; 'auto' restores saved position for the target
   * hash or scrolls to top; 'manual' is a no-op.
   * @param {{ hash: string }} to - Target route.
   * @param {{ hash: string } | null} from - Previous route.
   * @private
   */
  #applyScrollRestoration(to, from) {
    if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') {
      return;
    }

    const mode = this.options?.scrollRestoration ?? 'top';
    if (mode === 'manual') {
      return;
    }

    if (mode === 'auto' && from?.hash) {
      this.#scrollPositions.set(from.hash, {
        x: window.scrollX || 0,
        y: window.scrollY || 0,
      });
    }

    const apply = () => {
      if (mode === 'top') {
        window.scrollTo(0, 0);
        return;
      }

      if (mode === 'auto') {
        const saved = this.#scrollPositions.get(to.hash);
        if (saved) {
          window.scrollTo(saved.x, saved.y);
        } else {
          window.scrollTo(0, 0);
        }
      }
    };

    // Double rAF so layout has settled after mountPage
    const schedule =
      typeof window.requestAnimationFrame === 'function'
        ? (cb) => window.requestAnimationFrame(cb)
        : (cb) => setTimeout(cb, 0);

    schedule(() => schedule(apply));
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
        this.#currentRouteProxy.path = '';
        this.#currentRouteProxy.page = '';
        this.#currentRouteProxy.meta = {};
        for (const key of Object.keys(this.#currentRouteProxy.params)) {
          delete this.#currentRouteProxy.params[key];
        }
        for (const key of Object.keys(this.#currentRouteProxy.query)) {
          delete this.#currentRouteProxy.query[key];
        }
      }
    } else {
      this.#currentRouteIsNull = false;
      if (!this.#currentRouteProxy) {
        const handlerFactory = new ProxyHandlerFactory();
        this.#currentRouteProxy = new Proxy(
          { hash: '', path: '', page: '', params: {}, query: {}, meta: {} },
          handlerFactory.create(),
        );
      }
      this.#currentRouteProxy.hash = val.hash || '';
      this.#currentRouteProxy.path = val.path !== undefined ? val.path : val.hash ? val.hash.split('?')[0] : '';
      this.#currentRouteProxy.page = val.page || '';
      this.#currentRouteProxy.meta = { ...(val.meta || {}) };
      for (const key of Object.keys(this.#currentRouteProxy.params)) {
        delete this.#currentRouteProxy.params[key];
      }
      for (const [key, v] of Object.entries(val.params || {})) {
        this.#currentRouteProxy.params[key] = v;
      }
      for (const key of Object.keys(this.#currentRouteProxy.query)) {
        delete this.#currentRouteProxy.query[key];
      }
      const incomingQuery = val.query || (val.params && val.params.query) || {};
      for (const [key, v] of Object.entries(incomingQuery)) {
        this.#currentRouteProxy.query[key] = v;
      }
    }
  }
}