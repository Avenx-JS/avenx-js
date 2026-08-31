import { test, expect } from '../../support/fixtures.js';
import { APPS, appUrl } from '../../support/apps.js';

/**
 * The suite's foundation: proof that an Avenx project compiled by the real CLI
 * boots in a real browser. Everything else assumes this, so if it breaks the
 * rest of the failures are noise.
 */
test.describe('compiled application boot', () => {
  test('renders markup that only the compiled bundle could have produced', async ({ page, app }) => {
    await app.open('counter');

    // index.html ships an empty <div id="app">. Anything inside it at this
    // point was mounted by the runtime from the compiled page component.
    await expect(page.getByTestId('heading')).toHaveText('Avenx counter');
    await expect(page.getByTestId('count')).toHaveText('0');

    const runtimeLoaded = await page.evaluate(() => typeof window.Avenx?.AvenxApp === 'function');
    expect(runtimeLoaded, 'the Avenx runtime namespace should be present on the page').toBe(true);
  });

  test('resolves component state and computed values during the first render', async ({ page, app }) => {
    await app.open('counter');

    // Interpolation, a computed value and a bound boolean attribute all have to
    // survive compilation for these three to agree on the initial state.
    await expect(page.getByTestId('count')).toHaveText('0');
    await expect(page.getByTestId('doubled')).toHaveText('0');
    await expect(page.getByTestId('reset')).toBeDisabled();
  });

  // Grows on its own: adding a fixture app to the registry adds a boot check
  // for it, so a new app cannot join the suite already broken.
  for (const fixtureApp of APPS) {
    test(`boots the ${fixtureApp.name} application without runtime errors`, async ({ page, app }) => {
      await app.open(fixtureApp.name);

      // The runtimeIssues guard fails this test on any pageerror or
      // console.error; asserting a mounted root keeps it honest about having
      // actually rendered something.
      await expect(page.locator('#app')).not.toBeEmpty();
    });
  }
});

test.describe('fixture server', () => {
  test('returns 404 for an application page that was never built', async ({ page, runtimeIssues }) => {
    // Guards the harness itself. The previous server answered any unknown path
    // with a routing fixture and HTTP 200, so a mistyped URL produced a
    // confusing assertion failure instead of an obvious missing-file error.
    //
    // The browser logs the failed load, and this is the one test that wants it,
    // so the guard is told to expect exactly that message and nothing else.
    runtimeIssues.allow(/Failed to load resource.*404/);

    const response = await page.goto(appUrl('counter', 'does-not-exist.html'));
    expect(response?.status()).toBe(404);
  });
});
