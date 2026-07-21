import { test, expect } from '@playwright/test';

test.describe('Avenx Basic App & Interactive Counter E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/counter.html');
  });

  test('should scaffold app and render initial heading and zero count', async ({ page }) => {
    const heading = page.locator('#heading');
    await expect(heading).toHaveText('Avenx E2E Counter');

    const countDisplay = page.locator('#count-display');
    await expect(countDisplay).toHaveText('Count: 0');
  });

  test('should increment counter on button click', async ({ page }) => {
    const incBtn = page.locator('#btn-increment');
    const countDisplay = page.locator('#count-display');

    await incBtn.click();
    await expect(countDisplay).toHaveText('Count: 1');

    await incBtn.click();
    await incBtn.click();
    await expect(countDisplay).toHaveText('Count: 3');
  });

  test('should decrement counter on button click', async ({ page }) => {
    const incBtn = page.locator('#btn-increment');
    const decBtn = page.locator('#btn-decrement');
    const countDisplay = page.locator('#count-display');

    await incBtn.click();
    await incBtn.click();
    await expect(countDisplay).toHaveText('Count: 2');

    await decBtn.click();
    await expect(countDisplay).toHaveText('Count: 1');
  });

  test('should reset counter back to zero', async ({ page }) => {
    const incBtn = page.locator('#btn-increment');
    const resetBtn = page.locator('#btn-reset');
    const countDisplay = page.locator('#count-display');

    await incBtn.click();
    await incBtn.click();
    await incBtn.click();
    await expect(countDisplay).toHaveText('Count: 3');

    await resetBtn.click();
    await expect(countDisplay).toHaveText('Count: 0');
  });
});
