/**
 * Routing diagnostic catalogue entries.
 */
export default {
  AVX_W59: {
    code: 'AVX_W59',
    name: 'DuplicateRoutePattern',
    severity: 'warning',
    category: 'routing',
    summary: 'A route pattern is declared multiple times in initRouter(). The last declaration shadows earlier ones.',
    causes: [
      'The same route pattern path (e.g. "/dup") was defined more than once in the router configuration object.',
      'Two keys normalize to the same route — for example, a hash-prefixed key like "#/foo" alongside "/foo", or "" alongside "/". A leading "#" is display syntax and is stripped during normalization.',
      'A copy-paste error occurred when defining route paths.'
    ],
    remedies: [
      'Remove or rename the duplicate route pattern in app.initRouter() (prefer the unprefixed "/foo" form over "#/foo").',
      'Ensure each route pattern points to a unique or intended target page class.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w59-compiler-duplicate-route-pattern'
  },
  AVX_W76: {
    code: 'AVX_W76',
    name: 'CompilerGuardAsString',
    severity: 'warning',
    category: 'routing',
    summary: 'A route guard is given as a name string in initRouter(). String guards are not resolved to a guard class, so the route is not guarded.',
    causes: [
      'A guards entry in initRouter() is a quoted string (e.g. guards: [\'AuthGuard\']) instead of the imported guard class or an object with a canActivate method.'
    ],
    remedies: [
      'Pass the guard class itself (e.g. guards: [AuthGuard]) after importing it, or an object with a canActivate method.',
      'Silence with "warnings": { "AVX_W76": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w76-compiler-guard-as-string'
  },
  AVX_W07: {
    code: 'AVX_W07',
    name: 'PageAlreadyRegistered',
    severity: 'warning',
    category: 'routing',
    summary: 'A page name was registered twice, and the second registration overwrites the first.',
    causes: [
      'Two pages are registered under the same name, usually after a copy or rename.'
    ],
    remedies: [
      'Give each page a unique name and remove the duplicate registration.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w07-page-already-registered'
  },
  AVX_W08: {
    code: 'AVX_W08',
    name: 'RoutePathMissingLeadingSlash',
    severity: 'warning',
    category: 'routing',
    summary: 'A route path lacks a leading slash.',
    causes: [
      'The route was defined as "products" instead of "/products", which can prevent hash paths from resolving properly.'
    ],
    remedies: [
      'Start every route path with a slash.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w08-route-path-missing-leading-slash'
  },
  AVX_W09: {
    code: 'AVX_W09',
    name: 'RouteParamDecodeFailed',
    severity: 'warning',
    category: 'routing',
    summary: 'A route parameter could not be URI-decoded.',
    causes: [
      'The hash contains a malformed percent sequence, so decoding throws and the router falls back to the raw parameter string.'
    ],
    remedies: [
      'Encode route parameters when building links, for example with encodeURIComponent.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w09-route-param-decode-failed'
  },
  AVX_W10: {
    code: 'AVX_W10',
    name: 'RouteNotFound',
    severity: 'warning',
    category: 'routing',
    summary: 'No route is defined for the current hash.',
    causes: [
      'Navigation targeted a path that no registered route matches.'
    ],
    remedies: [
      'Add a route for the path, fix the link that points to it, or add a fallback route.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w10-route-not-found'
  },
  AVX_W11: {
    code: 'AVX_W11',
    name: 'RouteTitleEvaluationFailed',
    severity: 'warning',
    category: 'routing',
    summary: 'Evaluating a route title threw an error.',
    causes: [
      'The title() function for the route threw while the router was applying it.'
    ],
    remedies: [
      'Fix the error inside title() and make sure every value it reads is defined.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w11-route-title-evaluation-failed'
  },
  AVX_W27: {
    code: 'AVX_W27',
    name: 'RouterGuardUndefinedReturn',
    severity: 'warning',
    category: 'routing',
    summary: 'A navigation guard returned undefined, so the transition defaults to allow.',
    causes: [
      'The guard has a missing return statement or an unhandled branch, which usually indicates a logic bug.'
    ],
    remedies: [
      'Return true, false, a redirect string, or a control object explicitly from every guard branch.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w27-router-guard-undefined-return'
  }
};
