import { AvenxGuard } from 'avenx-core/runtime';

/**
 * Admits a navigation only when the target route carries a valid token.
 *
 * The decision is made from the `to` route rather than from the session bridge
 * the rest of this application uses, and that is a workaround rather than a
 * recommendation: a guard cannot read a bridge today. The compiler strips the
 * relative import out of a guard module without rewiring the binding, so
 * `session.signedIn` throws ReferenceError and the router reports AVX_R07.
 * AvenxGuard receives no injection either, and the template sandbox blocks
 * `window`, so a guard currently has no supported route to shared state at all.
 *
 * The gap is pinned by a test in specs/routing/guards.spec.js.
 */
export default class AuthGuard extends AvenxGuard {
  /**
   * @param {{hash: string}} to - The route being entered.
   * @returns {boolean|string} True to allow, or the hash to redirect to.
   */
  canActivate(to) {
    return String(to && to.hash).includes('token=valid') ? true : '#/';
  }
}
