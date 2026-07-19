/**
 * Base class for all route guards in Avenx.
 * Guards determine if a route transition should proceed, abort, or redirect.
 */
export class AvenxGuard {
  /**
   * Determines whether the route can be activated.
   * Can return a boolean (true to allow, false to abort), a string (to redirect),
   * a custom control object (e.g. { cancel: true, silent: true } or { redirect: string, state?: object }),
   * or a Promise resolving to any of these.
   * @returns {boolean|string|object|Promise<boolean|string|object>}
   */
  canActivate() {
    return true;
  }
}
