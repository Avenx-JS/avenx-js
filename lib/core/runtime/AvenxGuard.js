/**
 * @file AvenxGuard.js
 * @description The base class for route guards, and the context they receive.
 *
 * ## Why a guard has a context
 *
 * A guard used to receive nothing. It answered `canActivate(to, from)` from the
 * route alone, and anything else it needed had to be reached through whatever
 * happened to be in lexical scope. For a guard compiled into the application
 * bundle that was an accident of concatenation, and when the compiler stopped
 * emitting a binding the guard's identifier silently became `undefined`.
 *
 * That left the ordinary case unwritable. "Is this visitor signed in?" is the
 * reason route guards exist, and the answer lives in a bridge — which a guard
 * had no supported way to read: it received no injection, and the template
 * sandbox refuses `window`. The only decisions a guard could make were the ones
 * the URL already carried.
 *
 * The context makes that dependency explicit rather than lexical. A guard is
 * handed the framework-level capabilities it is allowed to use, by the router
 * that invoked it, at the moment it runs.
 *
 * ## What the context deliberately does not carry
 *
 * Browser globals. The context exposes the application's bridges and the
 * router that is asking; it is not an escape hatch to `document`,
 * `localStorage` or `fetch`. A guard that genuinely needs a browser API should
 * read it through a bridge, which is the same rule the rest of the framework
 * follows and the reason a bridge read is traceable at all.
 * @module lib/core/runtime/AvenxGuard
 */

/**
 * The capabilities a guard is given when it runs.
 *
 * Constructed per navigation by the router. Nothing here is mutable state: the
 * bridges are the live reactive objects the rest of the application uses, so a
 * guard reading `context.bridge('session').signedIn` sees exactly what a
 * component reading the same bridge sees.
 */
export class GuardContext {
  /**
   * @param {object} [options] - Context sources.
   * @param {object} [options.bridges] - The application's bridge registry.
   * @param {object} [options.app] - The application instance.
   * @param {object} [options.router] - The router performing the navigation.
   */
  constructor({ bridges = {}, app = null, router = null } = {}) {
    /**
     * Registered bridges, by name.
     * @type {object}
     */
    this.bridges = bridges;
    /**
     * The application instance.
     * @type {object|null}
     */
    this.app = app;
    /**
     * The router performing this navigation.
     * @type {object|null}
     */
    this.router = router;
  }

  /**
   * Looks a bridge up by name.
   *
   * Returns `undefined` rather than throwing for an unknown name, so a guard
   * can decide what an absent bridge means. A guard that imports its bridge
   * directly does not need this; it exists for guards registered as plain
   * functions, and for looking a bridge up dynamically.
   * @param {string} name - The registered bridge name.
   * @returns {any} The bridge, or undefined when it is not registered.
   */
  bridge(name) {
    return this.bridges ? this.bridges[name] : undefined;
  }
}

/**
 * Base class for all route guards in Avenx.
 * Guards determine if a route transition should proceed, abort, or redirect.
 */
export class AvenxGuard {
  /**
   * Guards are constructed by the router, once per navigation, with the
   * context for that navigation.
   *
   * Subclasses that declare no constructor get this one, so an existing guard
   * written before contexts existed keeps working unchanged and simply gains
   * `this.$context`.
   * @param {GuardContext} [context] - The capabilities for this navigation.
   */
  constructor(context = new GuardContext()) {
    /**
     * The capabilities this guard was given.
     * @type {GuardContext}
     */
    this.$context = context;
  }

  /**
   * The application's bridges, by name.
   * @returns {object} The bridge registry.
   */
  get $bridges() {
    return this.$context ? this.$context.bridges : {};
  }

  /**
   * Looks a bridge up by name.
   * @param {string} name - The registered bridge name.
   * @returns {any} The bridge, or undefined.
   */
  $bridge(name) {
    return this.$context ? this.$context.bridge(name) : undefined;
  }

  /**
   * Determines whether the route can be activated.
   * Can return a boolean (true to allow, false to abort), a string (to redirect),
   * a custom control object (e.g. { cancel: true, silent: true } or { redirect: string, state?: object }),
   * or a Promise resolving to any of these.
   * @param {object} [to] - The target route.
   * @param {object} [from] - The route being left.
   * @param {GuardContext} [context] - The capabilities for this navigation, also
   *   available as `this.$context`. Passed as a third argument so that a guard
   *   registered as a plain function can reach it too.
   * @returns {boolean|string|object|Promise<boolean|string|object>} The decision.
   */
  // The parameters document what a subclass receives; the base implementation
  // admits every navigation and reads none of them.
  // eslint-disable-next-line no-unused-vars
  canActivate(to, from, context) {
    return true;
  }
}
