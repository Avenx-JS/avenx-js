import { test, expect } from '@playwright/test';

test.describe('Avenx Nested Components & Slot Projection E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/components.html');
  });

  test('should render nested component card structure', async ({ page }) => {
    const card = page.locator('.avenx-card');
    await expect(card).toBeVisible();

    const header = card.locator('.card-header');
    await expect(header).toHaveText('Custom Card Title');
  });

  test('should project custom content into component body slot', async ({ page }) => {
    const slotBody = page.locator('#slot-body');
    await expect(slotBody).toBeVisible();
    await expect(slotBody).toHaveText('Custom Body Content injected into slot');
  });

  test('should project custom content into named footer slot', async ({ page }) => {
    const slotFooter = page.locator('#slot-footer');
    await expect(slotFooter).toBeVisible();
    await expect(slotFooter).toHaveText('Custom Footer Content');
  });
});
