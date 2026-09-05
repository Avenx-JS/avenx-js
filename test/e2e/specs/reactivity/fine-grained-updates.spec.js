import { test, expect } from '../../support/fixtures.js';

/**
 * Fine-grained dependency tracking, proved in a browser against a compiled app.
 *
 * Building the evaluation scope used to spread the reactive state into a plain
 * object. That single read touched every key, so every component depended on
 * all of its state: a write to a key no expression mentioned re-rendered the
 * component in full, and a bare identifier in a computed value read a snapshot
 * and never became reactive at all.
 *
 * Unit tests cover the dependency graph directly. These cover what a user sees:
 * the documented computed form updates, and an unrelated write does not disturb
 * DOM the component is not re-rendering.
 */
test.describe('fine-grained dependency tracking', () => {
  test('a computed written with a bare identifier stays in step', async ({ page, app }) => {
    await app.open('counter', { hash: '#/bare-computed' });

    await expect(page.getByTestId('count')).toHaveText('0');
    await expect(page.getByTestId('doubled')).toHaveText('0');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');
    await expect(page.getByTestId('doubled')).toHaveText('2');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('doubled')).toHaveText('4');
  });

  test('computed values do not report circular dependencies that do not exist', async ({ page, app }) => {
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        warnings.push(message.text());
      }
    });

    await app.open('counter', { hash: '#/' });
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('2');

    const circular = warnings.filter((line) => line.includes('AVX_R04'));
    expect(circular, `no false circular-dependency warnings, got: ${circular.join(' | ')}`).toEqual([]);
  });

  test('does not disturb DOM state that a re-render would reset', async ({ page, app }) => {
    // A focused input with a caret position is the observable difference
    // between "did not re-render" and "re-rendered to identical markup": a
    // re-render patches the element, and patching is what loses selection.
    await app.open('forms');

    const input = page.getByTestId('name-input');
    await input.click();
    await input.fill('hello world');
    await expect(input).toBeFocused();

    // Put the caret in the middle, then let unrelated reactive work happen.
    await input.evaluate((el) => el.setSelectionRange(5, 5));
    await page.waitForTimeout(50);

    await expect(input).toBeFocused();
    const caret = await input.evaluate((el) => el.selectionStart);
    expect(caret).toBe(5);
  });
});
