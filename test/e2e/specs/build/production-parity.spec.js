import { test, expect } from '../../support/fixtures.js';

/**
 * The same application, compiled twice, asserted once.
 *
 * `avenx build` embeds the minified runtime; `avenx build --dev` embeds the
 * readable one. The global setup produces both for the counter app (dist/ and
 * dist-dev/), and index.html and index.dev.html differ only in which they load
 * -- 190 KB against 499 KB of runtime.
 *
 * Minification and tree-shaking are where dev and production quietly diverge:
 * a name that survives in development and is mangled in production, or a
 * module dropped by the bundler that only some code path needed. The system
 * test suite already guards bundle size and checks that development-only
 * modules stay out; what nothing checked before is whether the production
 * bundle still behaves the same.
 */
const BUILDS = [
  { label: 'production runtime', entry: 'index.html' },
  { label: 'development runtime', entry: 'index.dev.html' },
];

for (const build of BUILDS) {
  test.describe(`counter application on the ${build.label}`, () => {
    test.beforeEach(async ({ app }) => {
      await app.open('counter', { entry: build.entry });
    });

    test('renders its initial state', async ({ page }) => {
      await expect(page.getByTestId('heading')).toHaveText('Avenx counter');
      await expect(page.getByTestId('count')).toHaveText('0');
      await expect(page.getByTestId('doubled')).toHaveText('0');
      await expect(page.getByTestId('reset')).toBeDisabled();
    });

    test('runs actions and updates computed values', async ({ page }) => {
      await page.getByTestId('increment').click();
      await page.getByTestId('increment').click();

      await expect(page.getByTestId('count')).toHaveText('2');
      await expect(page.getByTestId('doubled')).toHaveText('4');
      await expect(page.getByTestId('reset')).toBeEnabled();
    });

    test('applies its scoped styles', async ({ page }) => {
      // Style scoping runs through the same StyleMountManager in both builds,
      // and the emitted class is a content hash, so this is asserted through
      // the resolved value.
      const fontSize = await page.evaluate(
        () => getComputedStyle(document.querySelector('[data-testid="heading"]')).fontSize,
      );
      expect(fontSize).toBe('24px');
    });
  });
}

test.describe('build output', () => {
  test('serves a genuinely different runtime for each build', async ({ page, app }) => {
    // Guards the parity tests themselves: if both entry points ever pointed at
    // the same bundle, every assertion above would still pass while comparing
    // a build against itself.
    await app.open('counter', { entry: 'index.html' });
    const production = await page.evaluate(() => document.querySelector('script[src]').src);

    await app.open('counter', { entry: 'index.dev.html' });
    const development = await page.evaluate(() => document.querySelector('script[src]').src);

    expect(production).toContain('/dist/bundle.js');
    expect(development).toContain('/dist-dev/bundle.js');

    const [productionSize, developmentSize] = await Promise.all(
      [production, development].map(async (url) => {
        const response = await page.request.get(url);
        return (await response.body()).length;
      }),
    );

    // The minified bundle is roughly a third of the readable one; asserting
    // only that they differ would also pass on two builds of the same mode.
    expect(productionSize).toBeLessThan(developmentSize * 0.75);
  });
});
