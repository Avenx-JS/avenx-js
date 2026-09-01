import { AvenxGuard } from 'avenx-core/runtime';

/** One of two guards, which is the whole point of this app. */
export default class FirstGuard extends AvenxGuard {
  canActivate() {
    return true;
  }
}
