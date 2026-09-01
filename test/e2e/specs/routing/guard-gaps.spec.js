import { test, expect } from '../../support/fixtures.js';

/**
 * Two guard bugs, pinned rather than worked around silently.
 *
 * Both are driven from the `guard-gaps` fixture app, which exists only for
 * this file: it has two guard modules, and the second one reads a bridge. It
 * is flagged `documentsKnownGaps` in the app registry so the smoke boot loop
 * skips it.
 *
 * Neither bug is reachable from a unit test. The compiler compiles each guard
 * correctly in isolation; the damage appears only once several guards are
 * concatenated into one bundle and that bundle reaches a browser.
 */
test.describe('known gap: an application with more than one guard', () => {
  // Runs and is expected to fail.
  //
  // Each guard module is emitted with its own `const { AvenxGuard } = Avenx;`
  // preamble into a single bundle scope, so a second guard file produces
  // "SyntaxError: Identifier 'AvenxGuard' has already been declared" and the
  // whole bundle fails to parse. The application does not start at all.
  //
  // The build still reports "Build successful", which is the dangerous part:
  // `node --check dist/bundle.js` on the emitted file fails outright. Any real
  // project with two guards -- an auth guard and a role guard, say -- is
  // shipped broken with no diagnostic.
  test.fail();

  test('boots when two guard modules are compiled into one bundle', async ({ page, app }) => {
    // Fails today: app.open() reports that the runtime never reached the page,
    // because the bundle did not parse.
    await app.open('guard-gaps');

    await expect(page.getByTestId('page-home')).toBeVisible();
  });
});

test.describe('known gap: a guard reading a bridge', () => {
  // Runs and is expected to fail.
  //
  // Asking "is this visitor signed in?" from a guard by reading a bridge is
  // the ordinary way to write an auth guard. The compiler strips the relative
  // import out of a guard module without rewiring the binding the way it does
  // for components, so the identifier is undefined and the router reports
  // AVX_R07 on every navigation through the guard.
  //
  // There is no supported alternative today: AvenxGuard receives no injection,
  // and the template sandbox blocks `window` inside actions (AVX_R15), so a
  // guard has no route to shared state at all. The routing app's own AuthGuard
  // works around it by deciding from the `to` route, which only suits
  // decisions the URL already carries.
  //
  // This app also trips the duplicate-declaration bug above, so today the two
  // failures compound. Fixing that one first is what will make this test
  // report on the bridge binding specifically.
  test.fail();

  test('admits a navigation based on state the guard read from a bridge', async ({ page, app, runtimeIssues }) => {
    runtimeIssues.allow(/AVX_R07|session is not defined/);

    await app.open('guard-gaps', { hash: '#/second' });

    await expect(page.getByTestId('page-home')).toBeVisible();
  });
});
