import { test, expect } from '../../support/fixtures.js';

/**
 * The framework's central promise: an action mutates <state>, and the DOM
 * follows without the application writing to it.
 *
 * Nothing in the counter fixture touches the DOM -- it declares state, computed
 * values and actions, and interpolates them. Every assertion here therefore
 * fails if reactivity, scheduling or patching regress. The suite this replaced
 * asserted the same behaviour against a fixture whose click handlers set
 * textContent by hand, which is why it stayed green while testing nothing.
 */
test.describe('state changes drive the DOM', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('counter');
  });

  test('updates the rendered count when the increment action runs', async ({ page }) => {
    await expect(page.getByTestId('count')).toHaveText('0');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');

    await page.getByTestId('increment').click();
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('3');
  });

  test('updates the rendered count when the decrement action runs', async ({ page }) => {
    await page.getByTestId('increment').click();
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('2');

    await page.getByTestId('decrement').click();
    await expect(page.getByTestId('count')).toHaveText('1');
  });

  test('recomputes a derived value when the state it reads changes', async ({ page }) => {
    // `doubled` is a <computed>, never assigned by any action.
    await expect(page.getByTestId('doubled')).toHaveText('0');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('doubled')).toHaveText('2');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('doubled')).toHaveText('4');
  });

  test('returns to the initial value when the reset action runs', async ({ page }) => {
    await page.getByTestId('increment').click();
    await page.getByTestId('increment').click();
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('3');

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('count')).toHaveText('0');
    await expect(page.getByTestId('doubled')).toHaveText('0');
  });

  test('reflects state written by one action in the behaviour of another', async ({ page }) => {
    // `increment` reads `step`; changing `step` elsewhere must change what
    // incrementing does, which only holds if both share one reactive object.
    await expect(page.getByTestId('step')).toHaveText('1');

    await page.getByTestId('large-step').click();
    await expect(page.getByTestId('step')).toHaveText('10');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('10');
  });
});

test.describe('bound boolean attributes follow state', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('counter');
  });

  test('enables the reset control only once the count has moved', async ({ page }) => {
    const reset = page.getByTestId('reset');

    // `disabled="{{ isZero }}"` is driven by a computed value, so this asserts
    // attribute coercion and derived state together.
    await expect(reset).toBeDisabled();

    await page.getByTestId('increment').click();
    await expect(reset).toBeEnabled();

    await reset.click();
    await expect(reset).toBeDisabled();
  });
});

test.describe('computed values written with bare identifiers', () => {
  // Was a pinned gap, and the one a new user hit first: README.md, the
  // quickstart and the state-management guide all document
  // `<computed value="count * 2" />`, and that form rendered its initial value
  // and then never recomputed. No error, no warning.
  //
  // Building the evaluation scope used to spread the reactive state into a
  // plain object, so a bare identifier read a snapshot and registered no
  // dependency. The scope is now layered and lazy: a bare identifier resolves
  // through the live proxy, inside whichever watcher is evaluating.
  test('recomputes a value declared as "count * 2" rather than "state.count * 2"', async ({ page, app }) => {
    await app.open('counter', { hash: '#/bare-computed' });

    await expect(page.getByTestId('count')).toHaveText('0');
    await expect(page.getByTestId('doubled')).toHaveText('0');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');
    await expect(page.getByTestId('doubled')).toHaveText('2');
  });
});
