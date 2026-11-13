import { test, expect } from '../../support/fixtures.js';

/**
 * `data-ax-html` injects sanitized markup from a plain string (#1721).
 *
 * Runs against the production bundle in a real browser, so the parser doing
 * the sanitizing is the browser's own rather than happy-dom's.
 */
test.describe('data-ax-html', () => {
  test('injects allowed markup and strips the rest with a warning', async ({ page, app }) => {
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await app.open('security', { hash: '#/ax-html' });

    await expect(page.getByTestId('bold').locator('b')).toHaveText('bold');

    const mixed = page.getByTestId('mixed');
    await expect(mixed.locator('b')).toHaveText('ok');
    await expect(mixed.locator('script')).toHaveCount(0);
    await expect(mixed.locator('i')).toHaveText('tap');
    expect(await mixed.locator('i').getAttribute('onclick')).toBeNull();

    await mixed.locator('i').click();
    expect(await page.evaluate(() => window.__axHtmlXss)).toBe(false);

    // An id in the value would make the element a window property and clobber
    // the router registry; the directive strips it.
    await expect(page.getByTestId('clobber').locator('b')).toHaveCount(2);
    await expect(page.getByTestId('clobber').locator('[id], [name]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__avenx_routers instanceof Element)).toBe(false);

    expect(warnings.some((w) => w.includes('AVX_W16'))).toBe(true);
    expect(warnings.some((w) => w.includes('AVX_W17'))).toBe(true);
  });
});
