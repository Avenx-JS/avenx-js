import { test, expect } from '../../support/fixtures.js';

/**
 * The fallback rendering path, driven end to end.
 *
 * A template the IR refuses keeps the string renderer, and the build says so
 * through AVX_W47. That warning is only honest if the resulting bundle
 * actually renders. Nothing asserted that before: a component that renders
 * nothing raises no `pageerror`, so a blank application looked exactly like a
 * healthy one to every other spec in this suite.
 *
 * Each assertion below therefore checks for *content*, not merely for an
 * absence of errors. The mount point existing is not enough -- an unmounted or
 * silently failed child leaves the element behind with nothing in it, which is
 * the exact shape the defect took.
 */

/** Entry points to drive, so a regression in either build mode fails here. */
const ENTRIES = [
  { label: 'production build', entry: 'index.html' },
  { label: 'development build', entry: 'index.dev.html' },
];

for (const { label, entry } of ENTRIES) {
  test(`scoped slots survive the ${label}`, async ({ page, app }) => {
    await app.open('fallback', { entry, hash: '#/scoped' });
    await expect(page.getByTestId('scoped-heading')).toHaveText('Scoped slots');
    await expect(page.getByTestId('slot-label')).toHaveText('Avenx');
    await expect(page.getByTestId('slot-comparison')).toHaveText('true');
    await expect(page.getByTestId('slot-entity')).toHaveText('&lt;');
    await expect(page.getByTestId('slot-literal')).toHaveText('<em>literal</em>');
    await expect(page.getByTestId('slot-literal').locator('em')).toHaveCount(0);
    await expect(page.getByTestId('empty-slot').getByTestId('slot-fallback')).toHaveText('Fallback: Avenx');
    await page.getByTestId('update-slot').first().click();
    await expect(page.getByTestId('slot-label')).toHaveText('Updated');
    await expect(page.getByTestId('slot-comparison')).toHaveText('false');
  });

  test.describe(`fallback rendering (${label})`, () => {
    test.beforeEach(async ({ app }) => {
      await app.open('fallback', { entry });
    });

    test('renders the compiled page that hosts the fallback components', async ({ page }) => {
      await expect(page.getByTestId('shell-title')).toHaveText('fallback fixture');
    });

    test('renders a component whose template uses <@suspense>', async ({ page }) => {
      await expect(page.getByTestId('susp-outside')).toHaveText('outside suspense');
      await expect(page.getByTestId('susp-body')).toHaveText('inside suspense');
    });

    test('renders a component whose template uses <@errorBoundary>', async ({ page }) => {
      await expect(page.getByTestId('eb-outside')).toHaveText('outside boundary');
      await expect(page.getByTestId('eb-body')).toHaveText('inside boundary');
    });

    test('renders a component whose template uses <@deadlock>', async ({ page }) => {
      await expect(page.getByTestId('dl-outside')).toHaveText('outside deadlock');
      await expect(page.getByTestId('dl-body')).toHaveText('inside deadlock');
    });

    test('leaves no fallback mount point empty', async ({ page }) => {
      // The failure mode this suite exists to catch: the child element is in
      // the document, the runtime reported nothing, and the element is empty.
      const empty = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-avenx-comp]'))
          .filter((el) => el.innerHTML.trim() === '')
          .map((el) => el.getAttribute('data-avenx-comp')),
      );

      expect(empty, 'every mounted child component should have rendered content').toEqual([]);
    });
  });
}
