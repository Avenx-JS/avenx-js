import { test, expect } from '@playwright/test';

test.describe('Avenx Form Two-Way Data Binding (v-model) E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/forms-focus.html');
  });

  test('should synchronize text input changes with reactive state output', async ({ page }) => {
    const input = page.locator('#text-input');
    const output = page.locator('#output-text');

    await expect(output).toHaveText('Hello, Alice!');

    await input.fill('Bob');
    await expect(output).toHaveText('Hello, Bob!');

    await input.fill('Charlie');
    await expect(output).toHaveText('Hello, Charlie!');
  });

  test('should synchronize checkbox toggle with reactive state status', async ({ page }) => {
    const checkbox = page.locator('#check-agree');
    const status = page.locator('#output-agree');

    await expect(status).toHaveText('Status: Disagreed');

    await checkbox.check();
    await expect(status).toHaveText('Status: Agreed');

    await checkbox.uncheck();
    await expect(status).toHaveText('Status: Disagreed');
  });
});
