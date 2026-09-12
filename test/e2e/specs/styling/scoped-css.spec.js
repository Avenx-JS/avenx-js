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

test.describe('reactive style bindings (data-ax-style)', () => {
  // This was a `test.fail()` known gap for as long as the directive existed:
  // documented public API that applied nothing, because the string renderer
  // never implemented it. The compiled path does, so the expectation is an
  // ordinary one again.
  test('applies the inline style declared by data-ax-style', async ({ page, app }) => {
    await app.open('styling');

    await expect.poll(() => computed(page, 'emphasis', 'font-weight')).toBe('700');
  });
});
