import { test, expect } from '../../support/fixtures.js';

/**
 * Avenx's own event grammar, compiled from `@click`, `@submit.prevent` and
 * friends into the runtime's binder. The suite this replaced tested the same
 * headings with `addEventListener` plus a hand-written `preventDefault()`,
 * annotated in the fixture as "event modifier .prevent simulation" -- so it
 * verified that browsers implement preventDefault, not that Avenx parses,
 * binds or applies a modifier.
 */
test.describe('event bindings', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('events');
  });

  test('runs the bound action when a control is clicked', async ({ page }) => {
    await expect(page.getByTestId('child-count')).toHaveText('0');

    await page.getByTestId('child-bubbles').click();
    await expect(page.getByTestId('child-count')).toHaveText('1');
  });

  test('lets an unmodified event bubble to a handler on the ancestor', async ({ page }) => {
    await page.getByTestId('child-bubbles').click();

    await expect(page.getByTestId('child-count')).toHaveText('1');
    await expect(page.getByTestId('parent-count')).toHaveText('1');
  });
});

test.describe('event modifiers', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('events');
  });

  test('.prevent keeps a form submit from navigating away', async ({ page }) => {
    const url = page.url();

    await page.getByTestId('submit').click();
    await expect(page.getByTestId('submit-count')).toHaveText('1');

    await page.getByTestId('submit').click();
    await expect(page.getByTestId('submit-count')).toHaveText('2');

    // Two things would betray a real submit: the count would have been reset
    // by the reload, and a GET form would have put its field in the query
    // string. Asserting the count reached 2 covers the first; the URL covers
    // the second. The old suite checked only that the URL still contained the
    // fixture filename, which stays true across a reload.
    expect(page.url()).toBe(url);
    expect(page.url()).not.toContain('term=');
  });

  test('.stop keeps the event from reaching the ancestor handler', async ({ page }) => {
    await page.getByTestId('child-stop').click();

    await expect(page.getByTestId('child-count')).toHaveText('1');
    await expect(page.getByTestId('parent-count')).toHaveText('0');
  });

  test('.once detaches the handler after a single call', async ({ page }) => {
    const once = page.getByTestId('once');

    await once.click();
    await expect(page.getByTestId('once-count')).toHaveText('1');

    await once.click();
    await once.click();

    // Still 1: the binding removed itself rather than merely ignoring the
    // later calls, and no amount of clicking gets past it.
    await expect(page.getByTestId('once-count')).toHaveText('1');
  });

  test('.self ignores clicks that originated on a descendant', async ({ page }) => {
    await page.getByTestId('backdrop-inner').click();
    await expect(page.getByTestId('backdrop-count')).toHaveText('0');

    // Clicking the backdrop itself, away from the inner element.
    await page.getByTestId('backdrop').click({ position: { x: 2, y: 2 } });
    await expect(page.getByTestId('backdrop-count')).toHaveText('1');
  });

  test('.enter responds to Enter and ignores other keys', async ({ page }) => {
    const input = page.getByTestId('enter-input');

    await input.press('a');
    await input.press('Escape');
    await expect(page.getByTestId('enter-count')).toHaveText('0');

    await input.press('Enter');
    await expect(page.getByTestId('enter-count')).toHaveText('1');
  });
});
