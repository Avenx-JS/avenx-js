import { test, expect } from '../../support/fixtures.js';

test.describe('keep-alive routes', () => {
  test('preserves the live input node, counter state and listener across a cached return', async ({ page, app }) => {
    await app.open('composition', { hash: '#/cached' });

    const input = page.getByTestId('cached-input');
    await expect(input).toHaveValue('');
    await page.getByTestId('cached-increment').click();
    await expect(page.getByTestId('cached-count')).toHaveText('1');
    await input.fill('Draft preserved in the DOM');
    const originalInput = await input.elementHandle();

    await page.getByTestId('nav-provider').click();
    await expect(page.getByTestId('page-provider')).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect.poll(() => originalInput.evaluate((element) => element.isConnected)).toBe(false);

    await page.getByTestId('nav-cached').click();
    await expect(page.getByTestId('page-cached')).toBeVisible();
    await expect(input).toHaveValue('Draft preserved in the DOM');
    await expect(page.getByTestId('cached-count')).toHaveText('1');
    expect(await input.evaluate((element, original) => element === original, originalInput)).toBe(true);

    await page.getByTestId('cached-increment').click();
    await expect(page.getByTestId('cached-count')).toHaveText('2');
    await expect(input).toHaveValue('Draft preserved in the DOM');
    await originalInput.dispose();
  });

  test('resets the input and counter when returning to a non-cached route', async ({ page, app }) => {
    await app.open('composition', { hash: '#/uncached' });

    const input = page.getByTestId('uncached-input');
    await expect(input).toHaveValue('');
    await page.getByTestId('uncached-increment').click();
    await expect(page.getByTestId('uncached-count')).toHaveText('1');
    await input.fill('Draft discarded on unmount');
    const originalInput = await input.elementHandle();

    await page.getByTestId('nav-provider').click();
    await expect(page.getByTestId('page-provider')).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId('uncached-hook-log')).toHaveText(
      'onBeforeMount -> onMount -> onActivate -> onUnmount',
    );

    await page.getByTestId('nav-uncached').click();
    await expect(page.getByTestId('page-uncached')).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(page.getByTestId('uncached-count')).toHaveText('0');
    expect(await input.evaluate((element, original) => element === original, originalInput)).toBe(false);
    await originalInput.dispose();
  });

  test('mounts once and runs activation and deactivation hooks in order across a cache hit', async ({ page, app }) => {
    await app.open('composition', { hash: '#/cached' });

    const log = page.getByTestId('cached-hook-log');
    await expect(page.getByTestId('page-cached')).toBeVisible();
    await expect(log).toHaveText('onBeforeMount -> onMount -> onActivate');

    await page.getByTestId('nav-provider').click();
    await expect(page.getByTestId('page-provider')).toBeVisible();
    await expect(page.getByTestId('page-cached')).toHaveCount(0);
    await expect(log).toHaveText('onBeforeMount -> onMount -> onActivate -> onDeactivate');

    await page.getByTestId('nav-cached').click();
    await expect(page.getByTestId('page-cached')).toBeVisible();
    await expect(log).toHaveText('onBeforeMount -> onMount -> onActivate -> onDeactivate -> onActivate');
  });
});
