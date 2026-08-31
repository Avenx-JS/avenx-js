import { AvenxGuard } from 'avenx-core/runtime';
import session from '../bridges/session.bridge.js';

/** The second guard, and one that reads a bridge. Both are broken today. */
export default class SecondGuard extends AvenxGuard {
  canActivate() {
    return session.signedIn ? true : '#/';
  }
}
