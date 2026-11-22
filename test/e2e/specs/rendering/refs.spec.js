import { test, expect } from '../../support/fixtures.js';

test('compiled refs track conditional nodes, list order and child instances', async ({ page, app }) => {
  await app.open('refs');
  await expect(page.getByTestId('compiled')).toHaveText('true');
  await page.getByTestId('focus-box').click();
  await expect(page.getByTestId('box')).toBeFocused();
  await page.getByTestId('toggle').click();
  await expect(page.getByTestId('box')).toHaveCount(0);
  await page.getByTestId('toggle').click();
  await page.getByTestId('focus-box').click();
  await expect(page.getByTestId('box')).toBeFocused();
  await page.getByTestId('focus-last').click();
  await expect(page.getByTestId('row-2')).toBeFocused();
  await page.getByTestId('reverse').click();
  await page.getByTestId('focus-last').click();
  await expect(page.getByTestId('row-1')).toBeFocused();
  await page.getByTestId('focus-child').click();
  await expect(page.getByTestId('child-input')).toBeFocused();
  await page.getByTestId('rename-child').click();
  await page.getByTestId('focus-child').click();
  await expect(page.getByTestId('child-input')).toBeFocused();
});
