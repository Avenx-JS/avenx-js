import { test, expect } from '../../support/fixtures.js';

/**
 * Scoped styles, asserted through the cascade rather than through class names.
 *
 * The compiler emits content-hashed classes (`.avenx-27dcd258`), so a test that
 * matched on those would break every time a declaration's text changed, while
 * still saying nothing about whether the rule reached the element. Every
 * assertion here reads a resolved value out of the browser instead.
 */

/**
 * Reads one resolved style property from the element matching a test id.
 * @param {import('@playwright/test').Page} page - The page under test.
 * @param {string} testId - The data-testid to resolve.
 * @param {string} property - A CSS property name.
 * @returns {Promise<string>} The computed value.
 */
function computed(page, testId, property) {
  return page.evaluate(
    ([id, prop]) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)).getPropertyValue(prop),
    [testId, property],
  );
}

test.describe('scoped styles', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('styling');
  });

  test('applies a component stylesheet to the element that declared the class', async ({ page }) => {
    expect(await computed(page, 'alpha-box', 'padding-left')).toBe('11px');
    expect(await computed(page, 'alpha-box', 'border-style')).toBe('dashed');
  });

  test('applies a page stylesheet to the page it belongs to', async ({ page }) => {
    expect(await computed(page, 'page-note', 'letter-spacing')).toBe('3px');
  });

  test('keeps identically named rules in two components from colliding', async ({ page }) => {
    // AlphaBox and BetaBox both author a rule called `box`. Without scoping,
    // one would win for both elements. This is the test that would catch a
    // regression in the hashing or the mount order.
    expect(await computed(page, 'alpha-box', 'padding-left')).toBe('11px');
    expect(await computed(page, 'beta-box', 'padding-left')).toBe('33px');

    expect(await computed(page, 'alpha-box', 'border-style')).toBe('dashed');
    expect(await computed(page, 'beta-box', 'border-style')).toBe('dotted');
  });

  test('resolves a value defined with @def in a global block', async ({ page }) => {
    // `@def brand-accent` is declared in alpha-box's stylesheet and referenced
    // as `@brand-accent`; the compiler has to substitute it before emitting.
    expect(await computed(page, 'alpha-accent', 'color')).toBe('rgb(10, 90, 200)');
  });

  test('leaves a component unaffected by another component\'s global value', async ({ page }) => {
    expect(await computed(page, 'beta-accent', 'color')).toBe('rgb(200, 30, 30)');
  });
});

test.describe('known gap: reactive style bindings (data-ax-style)', () => {
  // Runs and is expected to fail. The directive is documented in
  // docs/core-concepts/directives.md as
  //   data-ax-style="{{ { color: state.textColor } }}"
  // but no style reaches the element at all -- the `style` attribute stays
  // null on the first render, before any state change is involved, with both
  // the bare and the `state.`-prefixed form of the expression.
  //
  // Kept under test.fail() rather than deleted: the directive is public API,
  // so the suite should say it is broken rather than quietly not cover it.
  test.fail();

  test('applies the inline style declared by data-ax-style', async ({ page, app }) => {
    await app.open('styling');

    // Fails today: nothing is applied, so this resolves to the default 400.
    await expect.poll(() => computed(page, 'emphasis', 'font-weight')).toBe('700');
  });
});
