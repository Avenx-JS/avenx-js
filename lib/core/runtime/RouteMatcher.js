/**
 * Pure environment-agnostic module for compiling route patterns and matching URLs.
 */
export class RouteMatcher {
  /**
   * Brings a declared route pattern into the form a normalized hash has.
   *
   * A hash is normalized to `#/path` before matching, but the pattern used to
   * be compiled exactly as written -- so only a pattern spelled `#/...`
   * could ever match. `''`, `'/'` and `'/about'` compiled to regexes
   * (`^$`, `^/$`, `^/about$`) that no normalized hash can satisfy, and the
   * route was silently dead: no match, no error, an empty container.
   *
   * The scaffolded routing template hid this by declaring the root twice,
   * `'': 'Home'` next to `'#/': 'Home'`, so the working spelling carried the
   * dead one. The compiler already treats all four forms as the same route
   * (`normalizeRoute` in lib/compiler/atlas/routes.js), so this is also what
   * makes Atlas's model and the runtime agree about what a route table says.
   * @param {string} routePattern - The pattern as declared.
   * @returns {string} The pattern in `#/path` form.
   */
  static normalizePattern(routePattern) {
    let path = String(routePattern);
    if (path.startsWith('#')) path = path.slice(1);
    if (!path.startsWith('/')) path = '/' + path;
    return '#' + path;
  }

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

    // A bare '#' is what every `<a href="#">` in a page puts in the URL, and
    // what a browser leaves behind when a hash is cleared. It means the root,
    // so it has to normalize to the root rather than to a path of its own that
    // no pattern can match.
    if (normalized === '#') {
      normalized = '#/';
    }

    if (prefix) {
      const expectedStart = '#' + prefix;
      if (!normalized.startsWith(expectedStart)) {
        return null;
      }
      // The prefix names a path segment, so it only owns a hash that ends
      // there or continues with a separator. Matching on the string alone made
      // `/widget` claim `#/widgets/list`: the router stripped seven characters
      // off an unrelated host route, matched the remainder against its own
      // table and, finding nothing, mounted its `*` fallback over a page it
      // does not own.
      const rest = normalized.substring(expectedStart.length);
      if (!expectedStart.endsWith('/') && rest !== '' && !rest.startsWith('/') && !rest.startsWith('?')) {
        return null;
      }
      normalized = '#' + rest;
      if (!normalized.startsWith('#/')) {
        normalized = '#/' + normalized.substring(1);
      }
    }
    return normalized;
  }

  /**
   * Recursively finds a route match.
   * @param {Object} routes - The routes configuration
   * @param {string} decodedPath - The decoded path to match against
   * @param {string} basePath - The accumulated base path
   * @param {Object|null} parentDef - The parent route definition, if any
   * @returns {Object|null} The match result or null if not found
   */
  static _findMatch(routes, decodedPath, basePath = '', parentDef = null) {
    for (const [routePattern, routeDef] of Object.entries(routes)) {
      if (routePattern === '*') continue;

      let fullPattern = routePattern;
      if (basePath) {
        if (basePath.endsWith('/') && routePattern.startsWith('/')) {
          fullPattern = basePath + routePattern.slice(1);
        } else if (!basePath.endsWith('/') && !routePattern.startsWith('/')) {
          fullPattern = basePath + '/' + routePattern;
        } else {
          fullPattern = basePath + routePattern;
        }
      }

      // Normalized here rather than per declared pattern, so a nested child
      // joins to its parent as written and the join is normalized once.
      fullPattern = RouteMatcher.normalizePattern(fullPattern);

      const { regex, paramNames } = RouteMatcher.compileRoute(fullPattern);
      const match = decodedPath.match(regex);
      if (match) {
        return {
          pattern: fullPattern,
          definition: routeDef,
          parent: parentDef,
          match,
          paramNames
        };
      }

      if (routeDef && typeof routeDef === 'object' && routeDef.children) {
        let childRoutes = routeDef.children;
        if (Array.isArray(childRoutes)) {
          childRoutes = childRoutes.reduce((acc, child) => {
            acc[child.path] = child;
            return acc;
          }, {});
        }

        const nestedMatch = this._findMatch(childRoutes, decodedPath, fullPattern, {
          pattern: fullPattern,
          definition: routeDef
        });

        if (nestedMatch) return nestedMatch;
      }
    }
    return null;
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

    const [pathPart] = normalizedHash.split('?');
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      decodedPath = pathPart;
    }

    return !!this._findMatch(routes, decodedPath);
  }

  /**
   * Matches a hash string against a collection of routes.
   * @param {Object<string, any>} routes - Map of route patterns to definitions.
   * @param {string} hash - The URL hash.
   * @param {object} [options] - Router options (e.g. prefix).
   * @param {Iterable<object>} [activeRouters] - Active router instances to check for fallback wildcard resolution.
   * @param {object} [currentRouter] - The current router instance.
   * @returns {object}
   */
  static matchRoute(routes, hash, options = {}, activeRouters = [], currentRouter = null) {
    const normalizedHash = RouteMatcher.normalizeHash(hash, options.prefix);
    if (normalizedHash === null) {
      return { matchedRoute: null, params: {}, otherRouterMatches: false, normalizedHash: null };
    }

    let matchedRoute = null;
    const params = {};
    const query = {};

    const [pathPart, queryPart] = normalizedHash.split('?');
    let decodedPath;

    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      decodedPath = pathPart;
    }

    if (queryPart) {
      const queryParams = new URLSearchParams(queryPart);
      for (const [key, value] of queryParams.entries()) {
        if (value === 'true') {
          query[key] = true;
        } else if (value === 'false') {
          query[key] = false;
        } else if (/^\d+$/.test(value)) {
          query[key] = Number(value);
        } else {
          query[key] = value;
        }
      }
    }

    const found = this._findMatch(routes, decodedPath);
    if (found) {
      matchedRoute = { pattern: found.pattern, definition: found.definition };
      if (found.parent) {
        matchedRoute.parent = found.parent;
      }

      found.paramNames.forEach((name, idx) => {
        const value = found.match[idx + 1];
        try {
          params[name] = decodeURIComponent(value);
        } catch {
          params[name] = value;
        }
      });

      if (Object.keys(query).length > 0) {
        params.query = { ...query };
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

    return { matchedRoute, params, query, path: pathPart, otherRouterMatches, normalizedHash };
  }
}
