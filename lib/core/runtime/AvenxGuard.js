/**
 * Base class for all route guards in Avenx.
 * Guards determine if a route transition should proceed, abort, or redirect.
 */
export class AvenxGuard {
  /**
   * Determines whether the route can be activated.
   * Can return a boolean (true to allow, false to abort), a string (to redirect),
   * or a Promise resolving to either.
   * @returns {boolean|string|Promise<boolean|string>}
   */
  canActivate() {
    return true;
  }
}
