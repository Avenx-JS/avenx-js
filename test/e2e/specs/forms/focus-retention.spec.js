import { test, expect } from '../../support/fixtures.js';

/**
 * What a patch must not destroy.
 *
 * Focus, caret position and selection live in the browser, not in the
 * framework's model, so an unrelated state change must patch around them
 * rather than replace the element. This is the coverage that genuinely cannot
 * exist outside a real browser -- and the area where the old suite claimed the
 * most and delivered the least: its "retain focus across reactive DOM updates"
 * test performed no reactive update at all, and refocused whatever the click
 * had just focused, which was the button.
 *
 * The state change here is triggered by pressing Enter inside the field, so
 * focus is never taken away by the act of triggering it.
 */
test.describe('focus and caret across patches', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('forms');
  });

  test('keeps focus in the field when unrelated state changes', async ({ page }) => {
    const input = page.getByTestId('name-input');

    await input.click();
    await expect(input).toBeFocused();

    await input.press('Enter');
    await expect(page.getByTestId('ticker')).toHaveText('1');

    await expect(input).toBeFocused();
  });

  test('preserves the caret position when unrelated state changes', async ({ page }) => {
    const input = page.getByTestId('name-input');

    await input.fill('Alexandra');
    await expect(page.getByTestId('name-output')).toHaveText('Alexandra');

    // Put the caret in the middle of the word rather than at either end, so a
    // patch that rewrote the value and collapsed the caret would be visible.
    await input.evaluate((element) => element.setSelectionRange(4, 4));
    expect(await input.evaluate((element) => element.selectionStart)).toBe(4);

    await input.press('Enter');
    await expect(page.getByTestId('ticker')).toHaveText('1');

    const after = await input.evaluate((element) => ({
      value: element.value,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      isActive: element === document.activeElement,
    }));

    expect(after).toEqual({ value: 'Alexandra', selectionStart: 4, selectionEnd: 4, isActive: true });
  });

  test('preserves an active selection range when unrelated state changes', async ({ page }) => {
    const input = page.getByTestId('name-input');

    await input.fill('Alexandra');
    await input.evaluate((element) => element.setSelectionRange(0, 4));

    await input.press('Enter');
    await expect(page.getByTestId('ticker')).toHaveText('1');

    // Enter with a selection must not replace it, and the patch must not
    // collapse it either.
    const selection = await input.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd));
    expect(selection).toBe('Alex');
  });

  test('keeps the same input element across repeated patches', async ({ page }) => {
    const input = page.getByTestId('name-input');
    await input.click();

    await page.evaluate(() => {
      window.__inputBefore = document.querySelector('[data-testid="name-input"]');
    });

    await input.press('Enter');
    await input.press('Enter');
    await input.press('Enter');
    await expect(page.getByTestId('ticker')).toHaveText('3');

    // Patching has to reuse the element. If it were replaced, focus and caret
    // would be lost even when the value happened to be copied across.
    const reused = await page.evaluate(
      () => window.__inputBefore === document.querySelector('[data-testid="name-input"]'),
    );
    expect(reused).toBe(true);
  });
});
