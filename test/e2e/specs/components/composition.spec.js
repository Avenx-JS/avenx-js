import { test, expect } from '../../support/fixtures.js';

/**
 * Real components: a StatCard authored as a .component.js pair, registered in
 * main.app.js, and used from a page by its PascalCase tag. The compiler has to
 * resolve the tag, wire the props and transclude the slot content -- none of
 * which a hand-written fixture can stand in for.
 */
test.describe('component composition', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('components');
  });

  test('mounts one child component per usage', async ({ page }) => {
    await expect(page.getByTestId('card')).toHaveCount(2);
  });

  test('passes parent state into the child as props', async ({ page }) => {
    const filled = page.getByTestId('filled');

    await expect(filled.getByTestId('card-label')).toHaveText('Revenue');
    await expect(filled.getByTestId('card-value')).toHaveText('100');
  });

  test('passes literal attribute values through as props', async ({ page }) => {
    const bare = page.getByTestId('bare');

    await expect(bare.getByTestId('card-label')).toHaveText('Headcount');
    await expect(bare.getByTestId('card-value')).toHaveText('12');
  });

  test('re-renders the child when the parent state behind a prop changes', async ({ page }) => {
    const filled = page.getByTestId('filled');
    await expect(filled.getByTestId('card-value')).toHaveText('100');

    await page.getByTestId('raise').click();
    await expect(filled.getByTestId('card-value')).toHaveText('150');

    await page.getByTestId('rename').click();
    await expect(filled.getByTestId('card-label')).toHaveText('Net revenue');
  });

  test('leaves a sibling instance untouched when one instance updates', async ({ page }) => {
    // Two instances of the same component must not share state. If props were
    // held on the class rather than the instance, this is where it shows.
    await page.getByTestId('raise').click();

    await expect(page.getByTestId('filled').getByTestId('card-value')).toHaveText('150');
    await expect(page.getByTestId('bare').getByTestId('card-value')).toHaveText('12');
  });
});

test.describe('slot projection', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('components');
  });

  test('projects parent content into the default slot', async ({ page }) => {
    const filled = page.getByTestId('filled');

    await expect(filled.getByTestId('card-body')).toHaveText('Quarterly total');
    await expect(filled.getByTestId('projected-body')).toBeVisible();
  });

  test('projects parent content into a named slot', async ({ page }) => {
    const filled = page.getByTestId('filled');

    await expect(filled.getByTestId('card-footer')).toHaveText('Updated just now');
    await expect(filled.getByTestId('projected-footer')).toBeVisible();
  });

  test('renders the slot fallback when the parent projects nothing', async ({ page }) => {
    const bare = page.getByTestId('bare');

    await expect(bare.getByTestId('card-body')).toHaveText('No body provided');
    await expect(bare.getByTestId('card-footer')).toHaveText('No footer provided');
  });

  test('keeps named content out of the default slot', async ({ page }) => {
    // Footer content is addressed to a named slot, so it must not also land in
    // the default one -- the classic transclusion bug.
    const body = page.getByTestId('filled').getByTestId('card-body');

    await expect(body).not.toContainText('Updated just now');
  });
});
