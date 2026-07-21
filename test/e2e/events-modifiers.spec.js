import { test, expect } from '@playwright/test';

test.describe('Avenx Event Modifiers & Propagation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/components.html');
  });

  test('should prevent default form submission page reload when using .prevent modifier', async ({ page }) => {
    const submitBtn = page.locator('#btn-submit');
    const submitCount = page.locator('#form-submit-count');

    await expect(submitCount).toHaveText('Submissions: 0');

    await submitBtn.click();
    await expect(submitCount).toHaveText('Submissions: 1');

    await submitBtn.click();
    await expect(submitCount).toHaveText('Submissions: 2');
    // Verify page did not reload and URL remains on components.html
    expect(page.url()).toContain('/components.html');
  });

  test('should stop event propagation when using .stop modifier', async ({ page }) => {
    const btnStop = page.locator('#btn-stop-propagation');
    const parentClicks = page.locator('#parent-click-count');
    const childClicks = page.locator('#child-click-count');

    await btnStop.click();

    await expect(childClicks).toHaveText('Child Clicks: 1');
    await expect(parentClicks).toHaveText('Parent Clicks: 0');
  });

  test('should propagate event to parent when normal child is clicked', async ({ page }) => {
    const btnNormal = page.locator('#btn-normal');
    const parentClicks = page.locator('#parent-click-count');
    const childClicks = page.locator('#child-click-count');

    await btnNormal.click();

    await expect(childClicks).toHaveText('Child Clicks: 1');
    await expect(parentClicks).toHaveText('Parent Clicks: 1');
  });
});
