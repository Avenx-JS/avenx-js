import { test, expect } from '../../support/fixtures.js';

/**
 * The real router, configured the way an application configures it: a hash-to-
 * page map passed to app.initRouter(), with pages compiled from src/pages.
 *
 * The suite this replaced hand-rolled its own updateView(), history handling
 * and outlet, and modelled path routing (/user/42) where Avenx routes on the
 * hash -- so it tested forty lines of fixture code, not AvenxRouter.
 */
test.describe('hash routing', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('routing');
  });

  test('renders the route matching the initial hash', async ({ page }) => {
    await expect(page.getByTestId('page-home')).toBeVisible();
  });

  test('navigates to another route when a link is followed', async ({ page }) => {
    await page.getByTestId('nav-profile-42').click();

    await expect(page.getByTestId('page-profile')).toBeVisible();
    await expect(page.getByTestId('page-home')).toHaveCount(0);
  });

  test('exposes a dynamic segment to the page as state', async ({ page }) => {
    await page.getByTestId('nav-profile-42').click();

    await expect(page.getByTestId('profile-id')).toHaveText('42');
    // toHaveURL retries: the router settles the hash a beat after it has
    // swapped the page, so a one-shot page.url() read races that update.
    await expect(page).toHaveURL(/#\/profile\/42$/);
  });

  test('updates the parameter in place when moving between two of the same route', async ({ page }) => {
    // Avenx reuses the page instance here rather than remounting, so this is
    // where a stale parameter would survive a navigation.
    await page.getByTestId('nav-profile-42').click();
    await expect(page.getByTestId('profile-id')).toHaveText('42');

    await page.getByTestId('nav-profile-99').click();
    await expect(page.getByTestId('profile-id')).toHaveText('99');
    await expect(page).toHaveURL(/#\/profile\/99$/);
  });

  test('parses the query string into route state', async ({ page }) => {
    await page.getByTestId('nav-dashboard').click();

    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await expect(page.getByTestId('dashboard-tab')).toHaveText('analytics');
    await expect(page.getByTestId('dashboard-page')).toHaveText('2');
  });

  test('falls back to the wildcard route for an unknown hash', async ({ page, app }) => {
    await app.open('routing', { hash: '#/no-such-route' });

    await expect(page.getByTestId('page-not-found')).toBeVisible();
  });

  test('renders the root route for a URL with no hash', async ({ page, app }) => {
    // The blank page this guards: the fixture declares its root as '/', and
    // only a pattern spelled '#/' used to match anything. A URL with no hash at
    // all is what a visitor types, so this is the first thing anyone sees.
    await app.open('routing');

    await expect(page.getByTestId('page-home')).toBeVisible();
  });

  test('renders the root route for a bare "#" URL', async ({ page, app }) => {
    // What any `<a href="#">` on the page leaves in the URL. It used to
    // normalize to '#', which matched no pattern, so the router fell through to
    // the wildcard and showed the not-found page.
    await app.open('routing', { hash: '#' });

    await expect(page.getByTestId('page-home')).toBeVisible();
    await expect(page.getByTestId('page-not-found')).toHaveCount(0);
  });

  test('renders the root route for an explicit "#/" URL', async ({ page, app }) => {
    await app.open('routing', { hash: '#/' });

    await expect(page.getByTestId('page-home')).toBeVisible();
  });

  test('renders the deep-linked route on a cold load', async ({ page, app }) => {
    // Loading straight into a route, rather than navigating to it, is the
    // classic SPA break: the router has to resolve the hash that was already
    // in the URL when the bundle first ran.
    await app.open('routing', { hash: '#/profile/7' });

    await expect(page.getByTestId('page-profile')).toBeVisible();
    await expect(page.getByTestId('profile-id')).toHaveText('7');
  });

  test('keeps a nested route layout and its state across siblings, then removes it on exit', async ({ page }) => {
    await page.getByTestId('nav-layout-dashboard').click();
    await expect(page.getByTestId('admin-layout')).toBeVisible();
    await expect(page.getByTestId('page-dashboard')).toBeVisible();

    await page.getByTestId('layout-select-users').click();
    await expect(page.getByTestId('layout-active-tab')).toHaveText('users');

    await page.getByTestId('nav-layout-users').click();
    await expect(page.getByTestId('page-admin')).toBeVisible();
    await expect(page.getByTestId('layout-active-tab')).toHaveText('users');
    await expect(page.getByTestId('admin-layout')).toHaveCount(1);

    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('page-home')).toBeVisible();
    await expect(page.getByTestId('admin-layout')).toHaveCount(0);
  });
});

test.describe('browser history', () => {
  test('restores earlier routes on back and replays them on forward', async ({ page, app }) => {
    await app.open('routing');

    await page.getByTestId('nav-profile-42').click();
    await expect(page.getByTestId('profile-id')).toHaveText('42');

    await page.getByTestId('nav-profile-99').click();
    await expect(page.getByTestId('profile-id')).toHaveText('99');

    await page.goBack();
    await expect(page.getByTestId('profile-id')).toHaveText('42');

    await page.goForward();
    await expect(page.getByTestId('profile-id')).toHaveText('99');
  });

  test('returns to the home route when navigating back past the first link', async ({ page, app }) => {
    await app.open('routing');

    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('page-dashboard')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('page-home')).toBeVisible();
  });
});
