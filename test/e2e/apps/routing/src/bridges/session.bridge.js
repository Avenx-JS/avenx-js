import { bridge } from 'avenx-core/runtime';

/** Shared sign-in state, read by the route guard and by the navigation. */
export default bridge({
  state: {
    signedIn: false,
  },

  signIn() {
    this.signedIn = true;
  },

  signOut() {
    this.signedIn = false;
  },
});
