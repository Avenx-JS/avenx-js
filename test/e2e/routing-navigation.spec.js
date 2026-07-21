import { test, expect } from '@playwright/test';

test.describe('Avenx Routing Navigation & URL Parameters E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/routing.html');
  });

  test('should render initial home route', async ({ page }) => {
    const homePage = page.locator('#page-home');
    await expect(homePage).toBeVisible();
    await expect(page.locator('#page-home h1')).toHaveText('Home Page');
  });

  test('should navigate to dynamic user route and extract URL param id: 42', async ({ page }) => {
    await page.click('#nav-user-42');
    await expect(page.locator('#page-user')).toBeVisible();
    await expect(page.locator('#user-id')).toHaveText('User ID: 42');
    expect(page.url()).toContain('/user/42');
  });

  test('should update route content when navigating to another param id: 99', async ({ page }) => {
    await page.click('#nav-user-99');
    await expect(page.locator('#page-user')).toBeVisible();
    await expect(page.locator('#user-id')).toHaveText('User ID: 99');
    expect(page.url()).toContain('/user/99');
  });

  test('should handle browser back and forward navigation correctly', async ({ page }) => {
    await page.click('#nav-user-42');
    await expect(page.locator('#user-id')).toHaveText('User ID: 42');

    await page.click('#nav-user-99');
    await expect(page.locator('#user-id')).toHaveText('User ID: 99');

    await page.goBack();
    await expect(page.locator('#user-id')).toHaveText('User ID: 42');

    await page.goForward();
    await expect(page.locator('#user-id')).toHaveText('User ID: 99');
  });

  test('should render 404 page for unknown routes', async ({ page }) => {
    await page.goto('/routing.html#non-existent-route');
    await page.evaluate(() => {
      window.history.pushState({}, '', '/unknown-path');
      window.dispatchEvent(new Event('popstate'));
    });
    await expect(page.locator('#page-404')).toHaveText('404 Page Not Found');
  });
});
