import { test, expect } from '../../support/fixtures.js';

test.describe('VirtualList windowing', () => {
  test('renders and reuses a small window over 5000 fixed-height rows', async ({ page, app }) => {
    await app.open('virtual-list');

    const scrollContainer = page.getByTestId('scroll-container');
    const rows = scrollContainer.getByTestId('virtual-row');
    const viewport = scrollContainer.locator('div').nth(2);

    await expect(page.getByTestId('virtual-list-heading')).toHaveText('VirtualList Windowing');
    await expect(rows.first()).toHaveText('Row 0');
    await expect.poll(() => rows.count()).toBeLessThan(50);

    await viewport.evaluate((element) => {
      element.scrollTop = 2000;
      element.dispatchEvent(new Event('scroll'));
    });

    const row50 = rows.filter({ hasText: /^\s*Row 50\s*$/ }).first();
    await expect(row50).toHaveAttribute('data-index', '50');
    await expect(row50).toBeVisible();
    await expect.poll(async () => viewport.evaluate((element) => {
      const row = element.querySelector('[data-testid="virtual-row"][data-index="50"]');
      if (!row) return false;
      const rowTop = row.getBoundingClientRect().top;
      const viewportTop = element.getBoundingClientRect().top;
      return Math.round(rowTop - viewportTop);
    })).toBe(0);
    await expect(rows.filter({ hasText: /^\s*Row 500\s*$/ })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Row 0' })).toHaveCount(0);

    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });

    await expect(rows.first()).toHaveText('Row 0');
    await expect(rows.filter({ hasText: 'Row 50' })).toHaveCount(0);

    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });

    await expect(rows.filter({ hasText: 'Row 4999' }).first()).toBeVisible();
    await expect.poll(async () => viewport.evaluate((element) => {
      const lastRow = element.querySelector('[data-testid="virtual-row"]:last-child');
      if (!lastRow) return false;
      const rowBottom = lastRow.getBoundingClientRect().bottom;
      const viewportBottom = element.getBoundingClientRect().bottom;
      return Math.abs(rowBottom - viewportBottom) <= 1;
    })).toBe(true);
  });
});
