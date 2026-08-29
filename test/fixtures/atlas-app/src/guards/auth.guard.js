import { AvenxGuard } from 'avenx-core/runtime';

/** Blocks checkout for anonymous visitors. */
export default class AuthGuard extends AvenxGuard {
  /**
   * @param {object} to - Target route.
   * @returns {boolean|string} Whether navigation may proceed.
   */
  canActivate(to) {
    return Boolean(to) || '#/';
  }
}
