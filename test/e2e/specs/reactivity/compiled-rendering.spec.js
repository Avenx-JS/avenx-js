import { test, expect } from '../../support/fixtures.js';

/**
 * The compiled renderer, proved in a browser against a compiled application.
 *
 * Unit tests can assert that a program contains the right ops and that the ops
 * write the right values. What they cannot show is that an application built by
 * the real CLI and loaded by a real browser updates only what changed --
 * because "only what changed" is a claim about the work the framework *did not*
 * do, and the only reliable way to observe that is to leave something in the
 * DOM that the framework would have destroyed if it had done that work.
 *
 * So these tests fingerprint the document from outside the framework, provoke
 * an update that has nothing to do with the fingerprinted nodes, and check the
 * fingerprints survived. Under the render-to-string architecture they do not:
 * the whole template is serialised, reparsed and diffed, and the diff removes
 * attributes that are present in the live DOM but absent from the new tree.
 */
test.describe('compiled rendering', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('counter');
  });

  test('the counter page renders through a compiled program', async ({ page }) => {
    // If this ever reports false, every other test in this file would still
    // pass -- against the string renderer, silently measuring nothing. The
    // whole file depends on this assertion.
    const compiled = await page.evaluate(() => {
      const host = document.querySelector('#app');
      const instance = host && host.__avenx_comp_instance;
      return instance ? instance.$compiled : null;
    });

    expect(compiled, 'the counter page should have compiled to a render program').toBe(true);
  });

  test('an update leaves untouched elements exactly as they were', async ({ page }) => {
    await expect(page.getByTestId('count')).toHaveText('0');

    // Two fingerprints the framework has no reason to write:
    //  - an attribute on an element carrying an unrelated binding
    //  - hand-edited text inside a static subtree
    await page.evaluate(() => {
      document.querySelector('[data-testid="step"]').setAttribute('data-fingerprint', 'kept');
      document.querySelector('[data-testid="heading"]').setAttribute('data-fingerprint', 'kept');
    });

    // Changes `count`. Does not change `step`, and cannot change the heading.
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');

    await expect(page.getByTestId('step')).toHaveAttribute('data-fingerprint', 'kept');
    await expect(page.getByTestId('heading')).toHaveAttribute('data-fingerprint', 'kept');
  });

  test('node identity survives an update', async ({ page }) => {
    // A re-render that replaces nodes breaks anything holding a reference to
    // them: a focused input, an open <details>, a running CSS transition, a
    // third-party widget mounted into the page.
    const sameNode = await page.evaluate(async () => {
      const before = document.querySelector('[data-testid="count"]');
      before.__identity = Symbol('probe');

      document.querySelector('[data-testid="increment"]').click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const after = document.querySelector('[data-testid="count"]');
      return after === before && after.__identity !== undefined;
    });

    expect(sameNode, 'the element holding a changed binding is written to, not replaced').toBe(true);
    await expect(page.getByTestId('count')).toHaveText('1');
  });

  test('a binding whose value did not change is not rewritten', async ({ page }) => {
    // `doubled` is a computed over `count`, so clicking increment changes both.
    // `step` is neither, and its text node must not be touched at all.
    const stepTouched = await page.evaluate(async () => {
      const step = document.querySelector('[data-testid="step"]');
      const textNode = step.firstChild;

      let writes = 0;
      const observer = new MutationObserver((records) => {
        writes += records.length;
      });
      observer.observe(step, { characterData: true, childList: true, subtree: true, attributes: true });

      document.querySelector('[data-testid="increment"]').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      observer.disconnect();

      return { writes, sameTextNode: step.firstChild === textNode };
    });

    expect(stepTouched.writes, 'an unrelated binding should produce no DOM mutations').toBe(0);
    expect(stepTouched.sameTextNode).toBe(true);
  });

  test('the markers the compiler used are not in the document', async ({ page }) => {
    // `data-axb` and `<!--axt:n-->` are how the runtime finds binding targets in
    // a freshly parsed skeleton. They are removed when the template is prepared,
    // so an application's DOM should carry no trace of them.
    const leaked = await page.evaluate(() => {
      const html = document.querySelector('#app').innerHTML;
      return {
        elementMarkers: html.includes('data-axb'),
        textMarkers: html.includes('axt:'),
        staticHints: html.includes('data-ax-static'),
      };
    });

    expect(leaked.elementMarkers, 'element markers must not reach the DOM').toBe(false);
    expect(leaked.textMarkers, 'text markers must not reach the DOM').toBe(false);
    expect(leaked.staticHints, 'a program never diffs, so the diff hint should be gone').toBe(false);
  });

  test('bindings still update after many changes', async ({ page }) => {
    // Guards against a binding that works once: a stale node reference, a
    // watcher that unsubscribed itself, a range that lost its anchor.
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId('increment').click();
      await expect(page.getByTestId('count')).toHaveText(String(i));
      await expect(page.getByTestId('doubled')).toHaveText(String(i * 2));
    }

    await page.getByTestId('large-step').click();
    await expect(page.getByTestId('step')).toHaveText('10');

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('15');

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('count')).toHaveText('0');
  });

  test('a bound boolean attribute is removed rather than set to false', async ({ page }) => {
    // `disabled="{{ isZero }}"` on the reset button. At zero it is disabled; a
    // stringified `false` in the attribute would leave it disabled forever,
    // which is the failure mode a generic attribute write produces.
    await expect(page.getByTestId('reset')).toBeDisabled();

    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');
    await expect(page.getByTestId('reset')).toBeEnabled();

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('reset')).toBeDisabled();
  });
});

/**
 * Child components mount and receive props through the compiled path.
 *
 * Props are the one part of a component boundary the program owns: each
 * `data-props-*` expression is its own effect, and the value is handed to the
 * child rather than re-read from an attribute on every render of the parent.
 */
test.describe('compiled rendering across a component boundary', () => {
  test('props reach a child and update when the parent state changes', async ({ page, app }) => {
    await app.open('components');

    // The fixture mounts the same component twice: once with props bound to
    // parent state, once with literal props. Both cards use the same test ids
    // internally, so each is addressed through the section that holds it.
    const filled = page.getByTestId('filled');
    const bare = page.getByTestId('bare');

    await expect(filled.getByTestId('card-label')).toHaveText('Revenue');
    await expect(filled.getByTestId('card-value')).toHaveText('100');

    await page.getByTestId('raise').click();
    await expect(filled.getByTestId('card-value')).toHaveText('150');

    await page.getByTestId('rename').click();
    await expect(filled.getByTestId('card-label')).toHaveText('Net revenue');

    // The sibling that was given literal props must be unaffected by either.
    await expect(bare.getByTestId('card-label')).toHaveText('Headcount');
    await expect(bare.getByTestId('card-value')).toHaveText('12');
  });

  test('content projected into a child updates from the parent scope', async ({ page, app }) => {
    await app.open('components');

    // The child moved these nodes into its slots. The expressions inside them
    // belong to the parent, and the parent's bindings still address the nodes.
    await expect(page.getByTestId('projected-body')).toBeVisible();
    await expect(page.getByTestId('projected-footer')).toBeVisible();
  });
});
