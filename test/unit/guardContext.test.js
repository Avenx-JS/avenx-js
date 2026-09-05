/**
 * Route guards and the context they receive.
 *
 * A guard used to be handed nothing but `(to, from)`. Anything else it needed
 * had to be in lexical scope, which for a compiled guard was an accident of
 * concatenation -- and when the compiler stopped emitting the binding, the
 * identifier silently became `undefined`. The ordinary case, "is this visitor
 * signed in?", was therefore unwritable: `AvenxGuard` received no injection and
 * the sandbox refuses `window`.
 *
 * Guards now receive an explicit GuardContext, and the compiler rewires a
 * guard's bridge imports the way it does a component's. This file covers the
 * runtime half; test/system/guardBridges.test.js covers the compiler half.
 */
import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxGuard, GuardContext } from '../../lib/core/runtime/AvenxGuard.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { bridge } from '../../lib/core/runtime/bridge.js';

console.log('🧪 Testing route guard context...');

/**
 * Waits for a navigation to settle.
 *
 * `router.navigate()` starts a navigation and returns nothing: guards may be
 * asynchronous, so the commit happens on a later tick. Tests have to wait for
 * that tick rather than for the call.
 * @returns {Promise<void>} Resolves once pending navigation work has run.
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Builds a page class rendering one marker element.
 * @param {string} id - The test id to render.
 * @returns {Function} A page class.
 */
function makePage(id) {
  return class extends AvenxPage {
    /**
     * @param {object} bridges - Bridge registry.
     * @param {object} registry - Component registry.
     * @param {object} props - Page props.
     */
    constructor(bridges, registry, props) {
      super({}, {}, bridges, `<section data-testid="${id}">${id}</section>`, {}, registry, props, {}, {});
    }
  };
}

/**
 * Creates an app with a mount target and the given routes.
 * @param {object} routes - Route table.
 * @param {object} [bridges] - Bridges to register, by name.
 * @returns {{app: AvenxApp, router: AvenxRouter}} The app and its router.
 */
function makeApp(routes, bridges = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = new AvenxApp({ target: '#app' });
  app.registerPage('Home', makePage('home'));
  app.registerPage('Secret', makePage('secret'));
  app.registerPage('Login', makePage('login'));
  for (const [name, value] of Object.entries(bridges)) {
    app.registerBridge(name, value);
  }
  const router = app.initRouter(routes, { mode: 'memory' });
  return { app, router };
}

/* -------------------------------------------------------------------------
 * The context itself
 * ---------------------------------------------------------------------- */

{
  const context = new GuardContext({ bridges: { session: { signedIn: true } } });
  assert.strictEqual(context.bridge('session').signedIn, true, 'bridge() resolves a registered bridge');
  assert.strictEqual(context.bridge('missing'), undefined, 'and returns undefined for an unknown name');

  const empty = new GuardContext();
  assert.deepStrictEqual(empty.bridges, {}, 'a context with no sources still has a bridge registry');
  assert.strictEqual(empty.bridge('anything'), undefined);
}

{
  // A guard that declares no constructor still gets one, so existing guards
  // written before contexts existed keep working and gain $context.
  class Legacy extends AvenxGuard {}
  const guard = new Legacy(new GuardContext({ bridges: { a: 1 } }));
  assert.strictEqual(guard.$bridge('a'), 1, '$bridge reaches the context');
  assert.deepStrictEqual(guard.$bridges, { a: 1 }, '$bridges exposes the registry');

  const bare = new Legacy();
  assert.deepStrictEqual(bare.$bridges, {}, 'a guard constructed without a context does not throw');
  assert.strictEqual(bare.canActivate({}, {}), true, 'and the base guard admits navigation');
}

console.log('  ✅ GuardContext resolves bridges and degrades safely.');

/* -------------------------------------------------------------------------
 * A guard reading shared state
 * ---------------------------------------------------------------------- */

{
  const session = bridge({
    state: { signedIn: false },
    /**
     * @param {boolean} value - The new signed-in state.
     */
    setSignedIn(value) {
      this.signedIn = value;
    },
  });

  class AuthGuard extends AvenxGuard {
    /**
     * @returns {boolean|string} The decision.
     */
    canActivate() {
      return this.$bridge('session').signedIn ? true : '#/login';
    }
  }

  const { router } = makeApp(
    {
      '#/': 'Home',
      '#/login': 'Login',
      '#/secret': { page: 'Secret', guards: [AuthGuard] },
    },
    { session },
  );

  router.navigate('#/secret');
  await settle();
  assert.ok(document.querySelector('[data-testid="login"]'), 'an unauthenticated visitor is redirected');

  session.setSignedIn(true);
  router.navigate('#/secret');
  await settle();
  assert.ok(document.querySelector('[data-testid="secret"]'), 'an authenticated visitor is admitted');

  // The guard must be re-evaluated per navigation, not cached from the first
  // answer, or signing out would leave the protected page reachable.
  session.setSignedIn(false);
  router.navigate('#/');
  await settle();
  router.navigate('#/secret');
  await settle();
  assert.ok(document.querySelector('[data-testid="login"]'), 'signing out closes the route again');
}

console.log('  ✅ A guard decides from bridge state, re-evaluated per navigation.');

/* -------------------------------------------------------------------------
 * Context delivery shapes
 * ---------------------------------------------------------------------- */

{
  // The context reaches a guard three ways: as a constructor argument, as
  // this.$context, and as the third argument to canActivate -- the last so a
  // guard registered as a plain function can reach it too.
  let sawConstructorArg = null;
  let sawThisContext = null;
  let sawCallArg = null;

  class Observer extends AvenxGuard {
    /**
     * @param {GuardContext} context - The navigation context.
     */
    constructor(context) {
      super(context);
      sawConstructorArg = context;
    }

    /**
     * @param {object} to - Target route.
     * @param {object} from - Current route.
     * @param {GuardContext} context - The navigation context.
     * @returns {boolean} The decision.
     */
    canActivate(to, from, context) {
      sawThisContext = this.$context;
      sawCallArg = context;
      return true;
    }
  }

  const session = bridge({ state: { signedIn: true } });
  const { app, router } = makeApp({ '#/': 'Home', '#/secret': { page: 'Secret', guards: [Observer] } }, { session });

  router.navigate('#/secret');
  await settle();

  assert.ok(sawConstructorArg instanceof GuardContext, 'the constructor receives a GuardContext');
  assert.strictEqual(sawThisContext, sawConstructorArg, 'this.$context is that same context');
  assert.strictEqual(sawCallArg, sawConstructorArg, 'canActivate receives it as a third argument');
  assert.strictEqual(sawConstructorArg.app, app, 'the context carries the application');
  assert.strictEqual(sawConstructorArg.router, router, 'and the router asking');
  assert.ok(sawConstructorArg.bridge('session'), 'and the registered bridges');
}

{
  // A guard registered as a plain function gets the context as its third
  // argument, since it has no `this` to hang one on.
  let received = null;
  const session = bridge({ state: { signedIn: true } });
  const fnGuard = (to, from, context) => {
    received = context;
    return context.bridge('session').signedIn;
  };

  const { router } = makeApp({ '#/': 'Home', '#/secret': { page: 'Secret', guards: [fnGuard] } }, { session });
  router.navigate('#/secret');
  await settle();

  assert.ok(received instanceof GuardContext, 'a function guard receives the context');
  assert.ok(document.querySelector('[data-testid="secret"]'), 'and its decision is honoured');
}

console.log('  ✅ Context reaches class guards and function guards alike.');

/* -------------------------------------------------------------------------
 * Several guards on one route
 * ---------------------------------------------------------------------- */

{
  const session = bridge({
    state: { signedIn: true, role: 'user' },
    /**
     * @param {boolean} value - The new signed-in state.
     */
    setSignedIn(value) {
      this.signedIn = value;
    },
    /**
     * @param {string} value - The new role.
     */
    setRole(value) {
      this.role = value;
    },
  });
  const order = [];

  class AuthGuard extends AvenxGuard {
    /**
     * @returns {boolean|string} The decision.
     */
    canActivate() {
      order.push('auth');
      return this.$bridge('session').signedIn ? true : '#/login';
    }
  }

  class RoleGuard extends AvenxGuard {
    /**
     * @returns {boolean|string} The decision.
     */
    canActivate() {
      order.push('role');
      return this.$bridge('session').role === 'admin' ? true : '#/';
    }
  }

  const { router } = makeApp(
    {
      '#/': 'Home',
      '#/login': 'Login',
      '#/secret': { page: 'Secret', guards: [AuthGuard, RoleGuard] },
    },
    { session },
  );

  router.navigate('#/secret');
  await settle();
  assert.deepStrictEqual(order, ['auth', 'role'], 'guards run in declaration order');
  assert.ok(document.querySelector('[data-testid="home"]'), 'the role guard redirects a non-admin');

  order.length = 0;
  session.setRole('admin');
  router.navigate('#/secret');
  await settle();
  assert.deepStrictEqual(order, ['auth', 'role'], 'both guards run again');
  assert.ok(document.querySelector('[data-testid="secret"]'), 'and an admin is admitted');

  // A guard that rejects short-circuits the chain.
  order.length = 0;
  session.setSignedIn(false);
  router.navigate('#/');
  await settle();
  router.navigate('#/secret');
  await settle();
  assert.deepStrictEqual(order, ['auth'], 'a rejecting guard stops the chain');
  assert.ok(document.querySelector('[data-testid="login"]'), 'and its redirect wins');
}

console.log('  ✅ Multiple guards compose, in order, with short-circuiting.');

/* -------------------------------------------------------------------------
 * Guards that need no shared state, and guards that fail
 * ---------------------------------------------------------------------- */

{
  class UrlOnlyGuard extends AvenxGuard {
    /**
     * @param {object} to - Target route.
     * @returns {boolean} The decision.
     */
    canActivate(to) {
      return !String(to.hash || '').includes('blocked');
    }
  }

  const { router } = makeApp({ '#/': 'Home', '#/secret': { page: 'Secret', guards: [UrlOnlyGuard] } });
  router.navigate('#/secret');
  await settle();
  assert.ok(document.querySelector('[data-testid="secret"]'), 'a guard needing no bridges still works');
}

{
  class AsyncGuard extends AvenxGuard {
    /**
     * @returns {Promise<boolean>} The decision.
     */
    async canActivate() {
      await Promise.resolve();
      return this.$bridge('session').signedIn;
    }
  }

  const session = bridge({ state: { signedIn: true } });
  const { router } = makeApp({ '#/': 'Home', '#/secret': { page: 'Secret', guards: [AsyncGuard] } }, { session });
  router.navigate('#/secret');
  await settle();
  assert.ok(document.querySelector('[data-testid="secret"]'), 'an async guard reading a bridge is admitted');
}

{
  class ThrowingGuard extends AvenxGuard {
    /**
     * Always throws, to prove a failing guard denies the navigation.
     * @throws {Error} Always.
     */
    canActivate() {
      throw new Error('guard exploded');
    }
  }

  const { router } = makeApp({ '#/': 'Home', '#/secret': { page: 'Secret', guards: [ThrowingGuard] } });
  router.navigate('#/');
  await settle();
  router.navigate('#/secret');
  await settle();
  assert.ok(!document.querySelector('[data-testid="secret"]'), 'a throwing guard does not admit the navigation');
}

console.log('  ✅ Stateless, async, and failing guards behave.');
console.log('✅ Route guard context tests passed!');
