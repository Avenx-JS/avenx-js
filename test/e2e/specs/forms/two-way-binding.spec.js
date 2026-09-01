import { test, expect } from '../../support/fixtures.js';

/**
 * Avenx's own binding directive, `data-ax-bind`, compiled from the template.
 *
 * The suite this replaced called the same area "v-model" -- a Vue directive
 * Avenx has never had -- and tested it with a hand-written `input` listener
 * that copied values into a plain object.
 */
test.describe('two-way binding', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('forms');
  });

  test('renders the initial state into the bound control', async ({ page }) => {
    await expect(page.getByTestId('name-input')).toHaveValue('Ada');
    await expect(page.getByTestId('name-output')).toHaveText('Ada');
  });

  test('writes typed text back into state', async ({ page }) => {
    await page.getByTestId('name-input').fill('Grace');

    await expect(page.getByTestId('name-output')).toHaveText('Grace');
  });

  test('pushes a state change made in code back into the control', async ({ page }) => {
    // The other direction, which a one-way listener would fail: nobody touched
    // the input, so its value can only change if state drives it.
    await page.getByTestId('name-input').fill('Katherine');
    await expect(page.getByTestId('name-output')).toHaveText('Katherine');

    await page.getByTestId('rename').click();

    await expect(page.getByTestId('name-input')).toHaveValue('Grace');
    await expect(page.getByTestId('name-output')).toHaveText('Grace');
  });

  test('binds a textarea through the same directive', async ({ page }) => {
    await page.getByTestId('bio-input').fill('Compiler author');

    await expect(page.getByTestId('bio-output')).toHaveText('Compiler author');
  });

  test('binds a checkbox through checked rather than value', async ({ page }) => {
    const box = page.getByTestId('subscribed-input');

    await expect(box).not.toBeChecked();
    await expect(page.getByTestId('subscribed-output')).toHaveText('false');

    await box.check();
    await expect(page.getByTestId('subscribed-output')).toHaveText('true');

    await box.uncheck();
    await expect(page.getByTestId('subscribed-output')).toHaveText('false');
  });

  test('adds and removes group members when a checkbox array is bound', async ({ page }) => {
    // state.fruits starts as ['apple'], so the first box renders checked and
    // membership -- not the DOM -- decides what is ticked.
    await expect(page.getByTestId('fruit-apple')).toBeChecked();
    await expect(page.getByTestId('fruit-banana')).not.toBeChecked();
    await expect(page.getByTestId('fruits-output')).toHaveText('apple');

    await page.getByTestId('fruit-banana').check();
    await expect(page.getByTestId('fruits-output')).toHaveText('apple,banana');

    await page.getByTestId('fruit-apple').uncheck();
    await expect(page.getByTestId('fruits-output')).toHaveText('banana');
  });

  test('shares one bound value across a radio group', async ({ page }) => {
    await expect(page.getByTestId('plan-free')).toBeChecked();
    await expect(page.getByTestId('plan-output')).toHaveText('free');

    await page.getByTestId('plan-pro').check();

    await expect(page.getByTestId('plan-output')).toHaveText('pro');
    // Selecting one radio has to clear the other; the binding owns that state.
    await expect(page.getByTestId('plan-free')).not.toBeChecked();
  });

  test('binds a select through its value on change', async ({ page }) => {
    await expect(page.getByTestId('city-input')).toHaveValue('berlin');

    await page.getByTestId('city-input').selectOption('oslo');

    await expect(page.getByTestId('city-output')).toHaveText('oslo');
  });
});
