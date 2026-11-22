import { test, expect } from '../../support/fixtures.js';

test.describe('global beforeEach entry-route guard', () => {
  test('redirects an unauthorized direct deep link to secret without mounting secret', async ({ page, app }) => {
    await page.addInitScript(() => {
      window.__log = [];
      window.__secretMounted = false;

      new MutationObserver(() => {
        if (document.querySelector('[data-testid="page-secret"]')) {
          window.__secretMounted = true;
        }
      }).observe(document, { childList: true, subtree: true });
    });

    await app.open('global-guard-deeplink', { hash: '#/secret' });

    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByTestId('page-login')).toBeVisible();
    await expect(page.getByTestId('page-secret')).toHaveCount(0);

    await expect
      .poll(() => page.evaluate(() => window.__log))
      .toEqual(['before:#/secret', 'before:#/login', 'after:#/login']);
    await expect
      .poll(() => page.evaluate(() => window.__secretMounted))
      .toBe(false);
  });

  test('allows an authorized direct deep link to secret', async ({ page, app }) => {
    await page.addInitScript(() => {
      window.isAdmin = true;
      window.__log = [];
    });

    await app.open('global-guard-deeplink', { hash: '#/secret' });

    await expect(page).toHaveURL(/#\/secret$/);
    await expect(page.getByTestId('page-secret')).toBeVisible();
    await expect(page.getByTestId('page-login')).toHaveCount(0);

    await expect
      .poll(() => page.evaluate(() => window.__log))
      .toEqual(['before:#/secret', 'after:#/secret']);
  });
});
