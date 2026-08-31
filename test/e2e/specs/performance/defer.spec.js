import { test, expect } from '../../support/fixtures.js';

/**
 * The <@defer> tag as an author writes it.
 *
 * The old defer spec hand-wrote the compiler's output -- data-ax-defer,
 * data-ax-defer-placeholder, data-ax-defer-content -- into a fixture, so it
 * pinned an internal marker protocol while leaving the authored syntax
 * untested; the parser could have stopped emitting those markers entirely and
 * the test would still have passed. These fixtures write <@defer when="...">
 * and let the compiler produce the markers.
 *
 * Every test asserts the deferral itself, not only the end state: content
 * absent while the placeholder stands, then present after the trigger. A test
 * that checked the final content alone would pass against a component that
 * ignored deferral and rendered everything eagerly, which defeats the point of
 * the feature.
 */
test.describe('deferred content', () => {
  test('withholds content behind an interaction trigger until the user acts', async ({ page, app }) => {
    await app.open('defer');

    const placeholder = page.getByTestId('interaction-placeholder');
    await expect(placeholder).toBeVisible();

    // The deferred subtree is genuinely absent, not merely hidden.
    await expect(page.getByTestId('interaction-content')).toHaveCount(0);

    // The event is dispatched rather than driven with click() or hover().
    // The `interaction` trigger fires on mouseenter as well as click, so the
    // placeholder is removed the instant the pointer arrives: Playwright's
    // click hovers first and then waits forever for an element that is already
    // gone, and hover() hangs the same way on Firefox. Dispatching sends the
    // same DOM event the binder listens for, without the actionability wait.
    //
    // Worth knowing beyond the test: a placeholder styled as a button cannot
    // actually be clicked, because pointing at it already fires the trigger.
    await placeholder.dispatchEvent('click');

    await expect(page.getByTestId('interaction-content')).toBeVisible();
    await expect(page.getByTestId('interaction-content')).toHaveText('Loaded on interaction');
    // The placeholder is replaced rather than left behind it.
    await expect(placeholder).toHaveCount(0);
  });

  test('loads an idle-triggered block without any interaction', async ({ page, app }) => {
    await app.open('defer');

    // No default `when`, no click: requestIdleCallback drives this one.
    await expect(page.getByTestId('idle-content')).toBeVisible();
    await expect(page.getByTestId('idle-placeholder')).toHaveCount(0);
  });

  test('shows the placeholder first and swaps it in when the timer elapses', async ({ page, app }) => {
    await app.open('defer', { hash: '#/timer' });

    // The fixture uses timer(1500) so this assertion has a wide margin over
    // the few tens of milliseconds it takes to run -- the wait below is what
    // depends on the clock, and it is bounded by the expect timeout rather
    // than by a sleep.
    await expect(page.getByTestId('timer-placeholder')).toBeVisible();
    await expect(page.getByTestId('timer-content')).toHaveCount(0);

    await expect(page.getByTestId('timer-content')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('timer-placeholder')).toHaveCount(0);
  });

  test('holds a visible-triggered block back until it is scrolled into view', async ({ page, app }) => {
    await app.open('defer', { hash: '#/visible' });

    await expect(page.getByTestId('visible-placeholder')).toBeVisible();
    await expect(page.getByTestId('visible-content')).toHaveCount(0);

    await page.getByTestId('visible-placeholder').scrollIntoViewIfNeeded();

    await expect(page.getByTestId('visible-content')).toBeVisible();
  });
});

test.describe('known gap: a component inside a deferred block', () => {
  // Runs and is expected to fail. Deferring an expensive component is the
  // headline use of the feature and the example its documentation opens with.
  //
  // The trigger fires and the swap happens -- the placeholder is removed and
  // the compiled marker <div data-avenx-comp="HeavyPanel" data-props-label="..."/>
  // is inserted -- but nothing ever mounts it, so the div stays empty. Component
  // markers appear to be resolved only during the initial mount pass, and
  // content inserted later is never handed to it.
  //
  // Plain markup inside <@defer> works, which is what the passing tests above
  // cover, so the deferral machinery itself is sound.
  test.fail();

  test('mounts a component that was revealed by a defer trigger', async ({ page, app }) => {
    await app.open('defer', { hash: '#/component' });

    await expect(page.getByTestId('component-placeholder')).toBeVisible();
    await page.getByTestId('component-placeholder').dispatchEvent('click');

    // Fails today: the marker is inserted but the component never mounts.
    await expect(page.getByTestId('heavy-panel-label')).toHaveText('loaded on interaction');
  });
});

test.describe('known gap: a deferred block in a component that holds state', () => {
  // Runs and is expected to fail. A <@defer> block survives only while its
  // host component never re-renders: any unrelated state change patches the
  // host and discards the deferred container along with its placeholder and
  // content templates. The block can then never load, and an already-loaded
  // one disappears.
  //
  // This is the most consequential of the defer findings, because it makes the
  // feature effectively unusable in any component that holds state -- which is
  // most components. The passing defer fixtures above avoid reactive state
  // entirely, which is the only reason they are stable.
  test.fail();

  test('keeps a deferred block usable after unrelated state has changed', async ({ page, app }) => {
    await app.open('defer', { hash: '#/stateful' });

    await expect(page.getByTestId('stateful-placeholder')).toBeVisible();

    await page.getByTestId('tick').click();
    await expect(page.getByTestId('ticks')).toHaveText('1');

    // Fails today: the placeholder was destroyed by the patch, so there is
    // nothing left to trigger and the content can never arrive.
    await expect(page.getByTestId('stateful-placeholder')).toBeVisible();
    await page.getByTestId('stateful-placeholder').dispatchEvent('click');
    await expect(page.getByTestId('stateful-content')).toBeVisible();
  });
});
