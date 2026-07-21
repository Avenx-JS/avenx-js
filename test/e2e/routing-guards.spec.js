import { test, expect } from '@playwright/test';

test.describe('Avenx Route Guards & Authorization Redirects E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/routing.html');
  });

  test('should redirect unauthenticated user from protected route to login-required page', async ({ page }) => {
    await expect(page.locator('#auth-status')).toHaveText('Logged Out');

    await page.click('#nav-admin');

    await expect(page.locator('#page-login-required')).toBeVisible();
    await expect(page.locator('#page-login-required h1')).toHaveText('Access Denied');
    expect(page.url()).toContain('/login-required');
  });

  test('should allow authenticated user to access protected admin route', async ({ page }) => {
    // Log in
    await page.click('#btn-toggle-auth');
    await expect(page.locator('#auth-status')).toHaveText('Logged In');

    // Access protected route
    await page.click('#nav-admin');

    await expect(page.locator('#page-protected')).toBeVisible();
    await expect(page.locator('#page-protected h1')).toHaveText('Secret Admin Area');
    expect(page.url()).toContain('/protected');
  });
});
