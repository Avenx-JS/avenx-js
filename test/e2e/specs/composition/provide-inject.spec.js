import { test, expect } from '../../support/fixtures.js';

test.describe('provide and inject', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('composition');
  });

  test('renders the provided value in a child and its nested grandchild', async ({ page }) => {
    await expect(page.getByTestId('provider-theme')).toHaveText('dark');
    await expect(page.getByTestId('child-theme')).toHaveText('dark');
    await expect(page.getByTestId('injecting-child').getByTestId('grandchild-theme')).toHaveText('dark');
  });

  test('propagates provider updates to every injecting descendant', async ({ page }) => {
    await expect(page.getByTestId('child-theme')).toHaveText('dark');
    await expect(page.getByTestId('grandchild-theme')).toHaveText('dark');

    await page.getByTestId('update-theme').click();

    await expect(page.getByTestId('provider-theme')).toHaveText('light');
    await expect(page.getByTestId('child-theme')).toHaveText('light');
    await expect(page.getByTestId('grandchild-theme')).toHaveText('light');

    await page.getByTestId('update-theme').click();

    await expect(page.getByTestId('provider-theme')).toHaveText('dark');
    await expect(page.getByTestId('child-theme')).toHaveText('dark');
    await expect(page.getByTestId('grandchild-theme')).toHaveText('dark');
  });
});
