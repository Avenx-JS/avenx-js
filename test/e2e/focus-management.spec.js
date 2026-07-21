import { test, expect } from '@playwright/test';

test.describe('Avenx Client-Side Focus Management E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/forms-focus.html');
  });

  test('should set active focus on programmatic focus call', async ({ page }) => {
    const focusBtn = page.locator('#btn-focus-input');
    const textInput = page.locator('#text-input');
    const focusIndicator = page.locator('#focus-indicator');

    await focusBtn.click();
    await expect(textInput).toBeFocused();
    await expect(focusIndicator).toHaveText('Active Focus: text-input');
  });

  test('should retain element focus across reactive DOM updates', async ({ page }) => {
    const textInput = page.locator('#text-input');
    const reRenderBtn = page.locator('#btn-trigger-re-render');

    // Focus input
    await textInput.focus();
    await expect(textInput).toBeFocused();

    // Trigger re-render / patch cycle
    await reRenderBtn.click();

    // Focus should be preserved or active element should remain tracked
    const isInputFocused = await textInput.evaluate(el => el === document.activeElement);
    expect(isInputFocused).toBe(true);
  });
});
