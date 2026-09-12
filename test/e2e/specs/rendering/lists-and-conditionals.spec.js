import { test, expect } from '../../support/fixtures.js';

test.describe('keyed list rendering', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('rendering');
  });

  test('renders one element per item in declaration order', async ({ page }) => {
    await expect(page.getByTestId('item')).toHaveText(['Alpha', 'Beta', 'Gamma']);
    await expect(page.getByTestId('item-count')).toHaveText('3');
  });

  test('appends a new element without disturbing the existing ones', async ({ page }) => {
    await page.getByTestId('append').click();

    await expect(page.getByTestId('item')).toHaveText(['Alpha', 'Beta', 'Gamma', 'Item 4']);
    await expect(page.getByTestId('item-count')).toHaveText('4');
  });

  test('removes the element whose item left the list', async ({ page }) => {
    await page.getByTestId('remove-first').click();

    await expect(page.getByTestId('item')).toHaveText(['Beta', 'Gamma']);
  });

  test('reuses the same DOM nodes when the list is reordered', async ({ page }) => {
    // The behaviour that matters about keys: a reorder must move nodes rather
    // than rebuild them, otherwise anything the browser owns inside a row --
    // focus, selection, scroll position, media playback -- is silently
    // destroyed. Node identity is compared directly, because a marker
    // attribute would be stripped when the patcher syncs attributes back to
    // the template.
    await page.getByTestId('item').first().waitFor();
    await page.evaluate(() => {
      window.__rowsBefore = [...document.querySelectorAll('[data-testid="item"]')];
    });

    await page.getByTestId('reverse').click();
    await expect(page.getByTestId('item')).toHaveText(['Gamma', 'Beta', 'Alpha']);

    const identity = await page.evaluate(() => {
      const before = window.__rowsBefore;
      const after = [...document.querySelectorAll('[data-testid="item"]')];
      return {
        // Alpha, Beta and Gamma were rows 0, 1 and 2; after reversing they
        // should be the same three elements in the opposite order.
        movedInsteadOfRebuilt: after[0] === before[2] && after[1] === before[1] && after[2] === before[0],
        allStillAttached: before.every((node) => node.isConnected),
        rowCount: after.length,
      };
    });

    expect(identity).toEqual({ movedInsteadOfRebuilt: true, allStillAttached: true, rowCount: 3 });
  });

  test('shows the empty branch when the list becomes empty and hides it again', async ({ page }) => {
    await expect(page.getByTestId('empty-state')).toHaveCount(0);

    await page.getByTestId('clear').click();
    await expect(page.getByTestId('item')).toHaveCount(0);
    await expect(page.getByTestId('empty-state')).toHaveText('Nothing to show');

    await page.getByTestId('append').click();
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
    await expect(page.getByTestId('item')).toHaveText(['Item 4']);
  });

  test('recomputes a value derived from the list when the list changes', async ({ page }) => {
    await expect(page.getByTestId('labels')).toHaveText('Alpha,Beta,Gamma');

    await page.getByTestId('reverse').click();
    await expect(page.getByTestId('labels')).toHaveText('Gamma,Beta,Alpha');
  });
});

test.describe('conditional visibility', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('rendering');
  });

  test('toggles an element bound to data-ax-show', async ({ page }) => {
    const details = page.getByTestId('details');

    await expect(details).toBeHidden();

    await page.getByTestId('toggle-details').click();
    await expect(details).toBeVisible();

    await page.getByTestId('toggle-details').click();
    await expect(details).toBeHidden();
  });
});

test.describe('interpolation escaping', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('rendering');
  });

  test('renders markup assigned to state as text rather than elements', async ({ page }) => {
    await expect(page.getByTestId('untrusted')).toHaveText('plain text');

    await page.getByTestId('inject').click();

    // The string reaches the DOM verbatim as text. If {{ }} stopped escaping,
    // the <b> would become an element and this locator would find it.
    await expect(page.getByTestId('untrusted')).toHaveText('<b data-testid="injected">not markup</b>');
    await expect(page.locator('b[data-testid="injected"]')).toHaveCount(0);
  });
});

test.describe('a <state> tag written across several lines', () => {
  // Was a pinned gap. ComponentParser stripped the state declaration with
  // /<state.*? \/>/g while reading it with a pattern that did match newlines,
  // so a multi-line tag was parsed correctly and left in the template, where it
  // rendered as a literal element and broke patching from the second render on.
  //
  // Declarations are now removed by the source ranges the scanner reported, so
  // the reader and the remover cannot disagree. Kept as an E2E test because the
  // damage only ever appeared once a compiled template reached a real DOM --
  // parseState() read the multi-line form correctly in isolation the whole time.
  test('keeps a component reactive when its state tag spans multiple lines', async ({ page, app }) => {
    await app.open('rendering', { hash: '#/multiline-state' });

    await expect(page.getByTestId('count')).toHaveText('0');

    await page.getByTestId('increment').click();

    await expect(page.getByTestId('count')).toHaveText('1');
  });
});

test.describe('conditional rendering', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('rendering', { hash: '#/conditional' });
  });

  test('renders only the matching branch', async ({ page }) => {
    await expect(page.getByTestId('branch')).toHaveText('none');
    await expect(page.getByTestId('branch')).toHaveCount(1);
  });

  test('moves through the chain as the condition changes', async ({ page }) => {
    await page.getByTestId('inc').click();
    await expect(page.getByTestId('branch')).toHaveText('some');

    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId('inc').click();
    }
    await expect(page.getByTestId('count')).toHaveText('4');
    await expect(page.getByTestId('branch')).toHaveText('many');

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('branch')).toHaveText('none');
  });

  test('leaves the surrounding markup alone', async ({ page }) => {
    // A branch occupies a range between its siblings. Getting that wrong shows
    // up as the content after the chain disappearing on the first switch.
    await expect(page.getByTestId('after')).toBeVisible();
    await page.getByTestId('inc').click();
    await expect(page.getByTestId('after')).toBeVisible();
  });

  test('keeps live DOM inside a branch that did not change', async ({ page }) => {
    await page.getByTestId('inc').click();
    const typed = page.getByTestId('typed');
    await typed.fill('still here');

    // `name` is read by a different chain, so this updates the page without
    // changing which arm is selected. Rebuilding the arm anyway would lose
    // what the user typed, which is the reason the binding compares arm
    // indices rather than re-rendering.
    await page.getByTestId('rename').click();
    await expect(page.getByTestId('greeting')).toHaveText('hello everyone');
    await expect(typed).toHaveValue('still here');
  });

  test('tears the branch down when it stops matching', async ({ page }) => {
    await page.getByTestId('inc').click();
    await expect(page.getByTestId('typed')).toHaveCount(1);

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('typed')).toHaveCount(0);
    await expect(page.getByTestId('greeting')).toHaveCount(0);
  });
});
