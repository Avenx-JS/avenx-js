/**
 * Pure environment-agnostic module for compiling route patterns and matching URLs.
 */
export class RouteMatcher {
  /**
   * Compiles a route pattern into a regular expression, tracking parameter names.
   * @param {string} routePattern - The route pattern (e.g. '/user/:id').
   * @returns {{regex: RegExp, paramNames: string[]}}
   */
  static compileRoute(routePattern) {
    const paramNames = [];
    const escaped = routePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    const regexStr = escaped.replace(/(:[a-zA-Z0-9_$]+)|(\*)/g, (_match, param) => {
      if (param) {
        paramNames.push(param.slice(1));
        return '([^/]+)';
      }
      paramNames.push('wildcard');
      return '(.*)';
    });

    return { regex: new RegExp(`^${regexStr}$`), paramNames };
  }

  /**
   * Normalizes a hash string with an optional namespace prefix.
   * @param {string} hash - Raw hash string (e.g. '#/app1/home').
   * @param {string} [prefix] - Namespace prefix (e.g. '/app1').
   * @returns {string|null} Normalized hash (e.g. '#/home'), or null if prefix does not match.
   */
  static normalizeHash(hash, prefix) {
    let normalized = hash || '#/';
    const secondHashIndex = normalized.indexOf('#', 1);
    if (secondHashIndex !== -1) {
      normalized = normalized.substring(0, secondHashIndex);
    }

    if (prefix) {
      const expectedStart = '#' + prefix;
      if (!normalized.startsWith(expectedStart)) {
        return null;
      }
      normalized = '#' + normalized.substring(expectedStart.length);
      if (!normalized.startsWith('#/')) {
        normalized = '#/' + normalized.substring(1);
      }
    }
    return normalized;
  }

  /**
   * Checks if the route definitions have a non-fallback match for the given hash.
   * @param {Object<string, any>} routes - Map of route patterns.
   * @param {string} hash - The URL hash.
   * @param {object} [options] - Router options (e.g. prefix).
   * @returns {boolean} True if a non-fallback route matches.
   */
  static matches(routes, hash, options = {}) {
    const normalizedHash = RouteMatcher.normalizeHash(hash, options.prefix);
    if (normalizedHash === null) {
      return false;
    }

    for (const routePattern of Object.keys(routes)) {
      if (routePattern === '*') continue;

      const { regex } = RouteMatcher.compileRoute(routePattern);
      const [pathPart] = normalizedHash.split('?');
      if (pathPart.match(regex)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Matches a hash string against a collection of routes.
   * @param {Object<string, any>} routes - Map of route patterns to definitions.
   * @param {string} hash - The URL hash.
   * @param {object} [options] - Router options (e.g. prefix).
   * @param {Iterable<object>} [activeRouters] - Active router instances to check for fallback wildcard resolution.
   * @param {object} [currentRouter] - The current router instance.
   * @returns {{matchedRoute: {pattern: string, definition: any}|null, params: object, otherRouterMatches: boolean, normalizedHash: string|null}}
   */
  static matchRoute(routes, hash, options = {}, activeRouters = [], currentRouter = null) {
    const normalizedHash = RouteMatcher.normalizeHash(hash, options.prefix);
    if (normalizedHash === null) {
      return { matchedRoute: null, params: {}, otherRouterMatches: false, normalizedHash: null };
    }

    let matchedRoute = null;
    const params = {};

    for (const [routePattern, routeDef] of Object.entries(routes)) {
      if (routePattern === '*') continue;

      const { regex, paramNames } = RouteMatcher.compileRoute(routePattern);
      const [pathPart, queryPart] = normalizedHash.split('?');
      let decodedPath;

      try {
        decodedPath = decodeURIComponent(pathPart);
      } catch {
        decodedPath = pathPart;
      }

      const match = decodedPath.match(regex);
      if (match) {
        matchedRoute = { pattern: routePattern, definition: routeDef };
        paramNames.forEach((name, idx) => {
          const value = match[idx + 1];
          try {
            params[name] = decodeURIComponent(value);
          } catch {
            params[name] = value;
          }
        });

        if (queryPart) {
          const queryParams = new URLSearchParams(queryPart);
          const parsedQuery = {};
          for (const [key, value] of queryParams.entries()) {
            if (value === 'true') {
              parsedQuery[key] = true;
            } else if (value === 'false') {
              parsedQuery[key] = false;
            } else if (/^\d+$/.test(value)) {
              parsedQuery[key] = Number(value);
            } else {
              parsedQuery[key] = value;
            }
          }
          params.query = parsedQuery;
        }
        break;
      }
    }

    let otherRouterMatches = false;
    if (!matchedRoute && routes['*']) {
      const rawHash = hash || '#/';
      otherRouterMatches = Array.from(activeRouters || []).some(
        (r) => r !== currentRouter && typeof r.matches === 'function' && r.matches(rawHash),
      );

      if (!otherRouterMatches) {
        matchedRoute = { pattern: '*', definition: routes['*'] };
      }
    }

    return { matchedRoute, params, otherRouterMatches, normalizedHash };
  }
}
