/**
 * The runtime names published as bare globals in a compiled application.
 *
 * A compiled bundle is one concatenated script. The compiler strips the
 * `import` statements from `main.app.js`, guard modules and bridge modules,
 * and rewrites them into destructuring from the `Avenx` namespace — so an
 * import is not what makes a name reachable. Two things still need a bare
 * identifier:
 *
 * 1. Code the compiler generates itself. Components and pages are emitted as
 *    `class X extends AvenxComponent`, so that name must resolve on its own.
 * 2. Authoring entry points a project may reference without importing, which
 *    older projects and older examples do.
 *
 * Everything else the runtime exports lives on `globalThis.Avenx` and nowhere
 * else. It used to be that every export was copied onto `globalThis` —
 * 67 names, including `html`, `logger`, `profile` and `nextTick` — which
 * collided with ordinary page scripts for no benefit.
 *
 * Adding a name here is a public API decision: it is a global that Avenx then
 * owns in every application, forever.
 * @type {string[]}
 */
export const PUBLIC_GLOBALS = [
  // Emitted by the compiler into every application.
  'AvenxComponent',
  'AvenxPage',
  'defineBridgeName',
  // Authoring entry points referenced from main.app.js, guards and bridges.
  'AvenxApp',
  'AvenxGuard',
  'AvenxRouter',
  'bridge',
];

/**
 * The name of the namespace object carrying the complete runtime surface.
 * @type {string}
 */
export const NAMESPACE_GLOBAL = 'Avenx';
