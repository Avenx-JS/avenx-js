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

  test('keeps numeric state numeric through a number input', async ({ page }) => {
    // state.age starts as the number 7. event.target.value is always a string,
    // so a binding that wrote it back turned `age + 1` into "71".
    await expect(page.getByTestId('age-input')).toHaveValue('7');
    await expect(page.getByTestId('age-output')).toHaveText('7 number');

    await page.getByTestId('age-input').fill('42');
    await expect(page.getByTestId('age-output')).toHaveText('42 number');

    // An empty field writes null: never "" and never NaN.
    await page.getByTestId('age-input').fill('');
    await expect(page.getByTestId('age-output')).toHaveText('null object');
    await expect(page.getByTestId('age-input')).toHaveValue('');

    // The other direction still works after the field has been touched.
    await page.getByTestId('age-from-code').click();
    await expect(page.getByTestId('age-input')).toHaveValue('30');
    await expect(page.getByTestId('age-output')).toHaveText('30 number');

    // "1.0" is the number 1 and renders back as "1". The control has to keep
    // what was typed, or the "0" is gone before the next digit lands.
    await page.getByTestId('age-input').fill('1.0');
    await expect(page.getByTestId('age-output')).toHaveText('1 number');
    await expect(page.getByTestId('age-input')).toHaveValue('1.0');

    await page.getByTestId('age-input').pressSequentially('5');
    await expect(page.getByTestId('age-output')).toHaveText('1.05 number');
    await expect(page.getByTestId('age-input')).toHaveValue('1.05');
  });

  test('keeps numeric state numeric through a range input', async ({ page }) => {
    await expect(page.getByTestId('volume-output')).toHaveText('50 number');

    await page.getByTestId('volume-input').fill('80');

    await expect(page.getByTestId('volume-output')).toHaveText('80 number');
  });

  test('writes every selected value of a multiple select as an array', async ({ page }) => {
    const select = page.getByTestId('cities-input');

    await expect(page.getByTestId('cities-output')).toHaveText('[]');

    // event.target.value on a multiple select is only the first selected
    // option; the binding has to read the whole selection.
    await select.selectOption(['berlin', 'oslo']);
    await expect(page.getByTestId('cities-output')).toHaveText('["berlin","oslo"]');
    // The re-render must not collapse the selection to one option.
    await expect(select).toHaveValues(['berlin', 'oslo']);

    await select.selectOption(['oslo']);
    await expect(page.getByTestId('cities-output')).toHaveText('["oslo"]');

    // A change made in code selects exactly the options the array names.
    await page.getByTestId('cities-from-code').click();
    await expect(select).toHaveValues(['lisbon']);
    await expect(page.getByTestId('cities-output')).toHaveText('["lisbon"]');
  });
});
