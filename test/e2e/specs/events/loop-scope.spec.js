import { test, expect } from '../../support/fixtures.js';

/**
 * `@click="select(item.id)"` inside a `<@for>`, driven in a real browser
 * against a bundle the real CLI produced.
 *
 * This is the form docs/core-concepts/events.md documents, and it threw
 * `Cannot read property "id" of undefined` for every row: the list manager
 * built a per-item scope and used it to interpolate the row's text, but the
 * handler was bound in the component's own pass, with the component's scope, so
 * nothing remembered which row a click came from.
 *
 * The unit coverage for this lives in test/integration/list_event_scope.test.js
 * and pins the mechanism. These pin the thing a user actually does — click the
 * second row of a list and expect the second row's data — through the compiler,
 * the bundler and a browser, because that is the path that was broken.
 */
test.describe('handlers inside a list', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('events');
  });

  test('resolves the loop variable of the row that was clicked', async ({ page }) => {
    await expect(page.getByTestId('picked')).toHaveText('none');

    await page.getByTestId('row-inline-beta').click();
    await expect(page.getByTestId('picked')).toHaveText('beta');

    // Not just "some row": each row has to resolve its own item rather than the
    // last one the list rendered.
    await page.getByTestId('row-inline-alpha').click();
    await expect(page.getByTestId('picked')).toHaveText('alpha');

    await page.getByTestId('row-inline-gamma').click();
    await expect(page.getByTestId('picked')).toHaveText('gamma');
  });

  test('passes the loop variable to an action', async ({ page }) => {
    await page.getByTestId('row-call-gamma').click();
    await expect(page.getByTestId('picked')).toHaveText('gamma');

    await page.getByTestId('row-call-alpha').click();
    await expect(page.getByTestId('picked')).toHaveText('alpha');
  });

  test('resolves the loop index', async ({ page }) => {
    await expect(page.getByTestId('picked-index')).toHaveText('-1');

    await page.getByTestId('row-index-gamma').click();
    await expect(page.getByTestId('picked-index')).toHaveText('2');

    await page.getByTestId('row-index-alpha').click();
    await expect(page.getByTestId('picked-index')).toHaveText('0');
  });

  test('resolves both loop variables inside a nested list', async ({ page }) => {
    await expect(page.getByTestId('cell')).toHaveText('none');

    // The inner handler names the inner variable and the enclosing one. It also
    // proves the nested body rendered at all: a nested loop used to produce no
    // rows, because the outer render consumed the inner body's interpolation
    // markers before the inner loop ever saw them.
    await page.getByTestId('cell-c3').click();
    await expect(page.getByTestId('cell')).toHaveText('g2/c3');

    await page.getByTestId('cell-c1').click();
    await expect(page.getByTestId('cell')).toHaveText('g1/c1');
  });

  test('leaves a handler outside the list resolving component state', async ({ page }) => {
    // The stamp must not change how an ordinary handler resolves.
    await page.getByTestId('child-bubbles').click();
    await expect(page.getByTestId('child-count')).toHaveText('1');
  });
});
