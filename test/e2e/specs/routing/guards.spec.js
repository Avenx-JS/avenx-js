import { test, expect } from '../../support/fixtures.js';

/**
 * Guards as the framework defines them: an AvenxGuard subclass registered on a
 * route as `{ page: 'Admin', guards: [AuthGuard] }` and resolved by the router,
 * which decides whether the navigation completes.
 *
 * The suite this replaced used a bare closure that the fixture invoked itself
 * before swapping its own outlet, so the router never ran a guard at all.
 */
test.describe('route guards', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('routing');
  });

  test('redirects a navigation the guard rejects', async ({ page }) => {
    await page.getByTestId('nav-admin').click();

    await expect(page.getByTestId('page-admin')).toHaveCount(0);
    await expect(page.getByTestId('page-home')).toBeVisible();
    // The redirect lands on the hash slightly after the page has been
    // swapped back, so this needs a retrying assertion rather than a single
    // page.url() read.
    await expect(page).toHaveURL(/#\/$/);
  });

  test('completes a navigation the guard admits', async ({ page }) => {
    await page.getByTestId('nav-admin-with-token').click();

    await expect(page.getByTestId('page-admin')).toBeVisible();
    await expect(page).toHaveURL(/#\/admin/);
  });

  test('guards a cold load of the protected route, not only in-app navigation', async ({ page, app }) => {
    // Deep-linking past a guard is the failure that actually leaks a protected
    // page, so it gets its own test rather than being assumed from the in-app
    // case: the guard has to run against a hash that was already in the URL
    // when the bundle first executed.
    await app.open('routing', { hash: '#/admin' });

    await expect(page.getByTestId('page-admin')).toHaveCount(0);
    await expect(page.getByTestId('page-home')).toBeVisible();
  });

  test('admits a cold load that satisfies the guard', async ({ page, app }) => {
    await app.open('routing', { hash: '#/admin?token=valid' });

    await expect(page.getByTestId('page-admin')).toBeVisible();
  });

  test('re-evaluates the guard on every navigation rather than caching the first answer', async ({ page }) => {
    await page.getByTestId('nav-admin-with-token').click();
    await expect(page.getByTestId('page-admin')).toBeVisible();

    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('page-home')).toBeVisible();

    // Same guard, same session, rejecting target: a cached "allow" from the
    // earlier navigation would let this one through.
    await page.getByTestId('nav-admin').click();
    await expect(page.getByTestId('page-admin')).toHaveCount(0);
    await expect(page.getByTestId('page-home')).toBeVisible();
  });
});

test.describe('bridge state shared across the application', () => {
  test('shows a bridge mutation on every page that reads it', async ({ page, app }) => {
    // SiteNav is mounted by each page, so this asserts one shared bridge rather
    // than a fresh copy per page instance.
    await app.open('routing');
    await expect(page.getByTestId('session-status')).toHaveText('false');

    await page.getByTestId('sign-in').click();
    await expect(page.getByTestId('session-status')).toHaveText('true');

    await page.getByTestId('nav-profile-42').click();
    await expect(page.getByTestId('page-profile')).toBeVisible();
    await expect(page.getByTestId('session-status')).toHaveText('true');
  });

  test('reflects a bridge mutation made from a different page', async ({ page, app }) => {
    await app.open('routing');
    await page.getByTestId('nav-dashboard').click();

    await page.getByTestId('sign-in').click();
    await expect(page.getByTestId('session-status')).toHaveText('true');

    await page.getByTestId('sign-out').click();
    await expect(page.getByTestId('session-status')).toHaveText('false');
  });
});
