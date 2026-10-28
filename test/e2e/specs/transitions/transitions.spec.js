import { test, expect } from '../../support/fixtures.js';

const FADE_CLASSES = [
  'fade-enter',
  'fade-enter-active',
  'fade-enter-to',
  'fade-leave',
  'fade-leave-active',
  'fade-leave-to',
];

/**
 * Records each class-list state using MutationRecord.oldValue so synchronous
 * class changes remain observable after the browser delivers the records.
 * @param {import('@playwright/test').Locator} locator - Element to observe.
 * @returns {Promise<void>}
 */
async function recordClassStates(locator) {
  await locator.evaluate((element) => {
    const pageWindow = element.ownerDocument.defaultView;
    pageWindow.__transitionClassObserver?.disconnect();
    pageWindow.__transitionClassStates = [];

    const snapshot = (classes, opacity = null) => ({
      classes,
      opacity,
      connected: element.isConnected,
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        pageWindow.__transitionClassStates.push(
          snapshot((mutation.oldValue || '').split(/\s+/).filter(Boolean)),
        );
      }
      pageWindow.__transitionClassStates.push(
        snapshot(Array.from(element.classList), Number.parseFloat(window.getComputedStyle(element).opacity)),
      );
    });

    observer.observe(element, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
    pageWindow.__transitionClassObserver = observer;
  });
}

/**
 * Records class states for a list item before that item is inserted.
 * @param {import('@playwright/test').Locator} locator - List containing the item.
 * @param {string} testId - data-testid of the item that will be inserted.
 * @returns {Promise<void>}
 */
async function recordInsertedItemClassStates(locator, testId) {
  await locator.evaluate((root, targetTestId) => {
    const pageWindow = root.ownerDocument.defaultView;
    pageWindow.__transitionClassObserver?.disconnect();
    pageWindow.__transitionClassStates = [];

    const recordCurrent = () => {
      const element = Array.from(root.children).find((child) => child.dataset.testid === targetTestId);
      if (!element) return;
      pageWindow.__transitionClassStates.push({
        classes: Array.from(element.classList),
        opacity: Number.parseFloat(window.getComputedStyle(element).opacity),
        connected: element.isConnected,
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target.dataset.testid === targetTestId) {
          pageWindow.__transitionClassStates.push({
            classes: (mutation.oldValue || '').split(/\s+/).filter(Boolean),
            opacity: null,
            connected: mutation.target.isConnected,
          });
        }
      }
      recordCurrent();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
    pageWindow.__transitionClassObserver = observer;
  }, testId);
}

/**
 * Reads the class states captured by recordClassStates.
 * @param {import('@playwright/test').Page} page - Current browser page.
 * @returns {Promise<Array<{classes: string[], opacity: number|null, connected: boolean}>>}
 */
function readClassStates(page) {
  return page.evaluate(() => window.__transitionClassStates || []);
}

/**
 * Checks whether an element has no fade transition classes.
 * @param {import('@playwright/test').Locator} locator - Element to inspect.
 * @returns {Promise<boolean>}
 */
function hasNoFadeClasses(locator) {
  return locator.evaluate(
    (element, transitionClasses) => transitionClasses.every((className) => !element.classList.contains(className)),
    FADE_CLASSES,
  );
}

/**
 * Reads the rendered opacity of an element.
 * @param {import('@playwright/test').Locator} locator - Element to inspect.
 * @returns {Promise<number>}
 */
function opacityOf(locator) {
  return locator.evaluate((element) => Number.parseFloat(window.getComputedStyle(element).opacity));
}

/**
 * Drives enter, leave and re-entry from one browser task chain so host-side
 * Playwright latency cannot let either transition settle between toggles.
 * @param {import('@playwright/test').Locator} locator - List containing the transitioning item.
 * @returns {Promise<{enterObserved: boolean, leaveObserved: boolean, connectedDuringLeave: boolean}>}
 */
function interruptRapidListTransition(locator) {
  return locator.evaluate((root) => new Promise((resolve, reject) => {
    const pageWindow = root.ownerDocument.defaultView;
    const toggle = pageWindow.document.querySelector('[data-testid="toggle-rapid-item"]');
    if (!toggle) {
      reject(new Error('Expected the rapid-item toggle to exist.'));
      return;
    }

    let enteringElement = null;
    let phase = 'enter';
    const observer = new MutationObserver(() => {
      const rapidItems = Array.from(root.children).filter((child) => child.dataset.testid === 'rapid-item');

      if (phase === 'enter') {
        const activeEnter = rapidItems.find((child) => (
          child.classList.contains('fade-enter-active') && child.classList.contains('fade-enter-to')
        ));
        if (!activeEnter) return;

        enteringElement = activeEnter;
        phase = 'leave';
        toggle.click();
        return;
      }

      if (
        phase === 'leave' &&
        enteringElement?.isConnected &&
        enteringElement.classList.contains('fade-leave') &&
        enteringElement.classList.contains('fade-leave-active')
      ) {
        phase = 'settling';
        pageWindow.__rapidInterruptedElement = enteringElement;
        const connectedDuringLeave = enteringElement.isConnected;
        toggle.click();
        observer.disconnect();
        resolve({
          enterObserved: true,
          leaveObserved: true,
          connectedDuringLeave,
        });
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    toggle.click();
  }));
}

/**
 * Finds a class phase in the mutation history.
 * @param {Array<{classes: string[]}>} states - Recorded class states.
 * @param {string[]} classes - Classes that identify the phase.
 * @param {number} [after] - Index after which the phase must occur.
 * @returns {number}
 */
function phaseIndex(states, classes, after = -1) {
  return states.findIndex(
    (state, index) => index > after && classes.every((className) => state.classes.includes(className)),
  );
}

/**
 * Waits until the mutation history contains a transition phase.
 * @param {import('@playwright/test').Page} page - Current browser page.
 * @param {string[]} classes - Classes that identify the phase.
 * @returns {Promise<void>}
 */
async function expectRecordedPhase(page, classes) {
  await expect.poll(async () => phaseIndex(await readClassStates(page), classes)).toBeGreaterThanOrEqual(0);
}

/**
 * Returns the recorded visual snapshot for a transition phase.
 * @param {Array<{classes: string[], opacity: number|null, connected: boolean}>} states - Recorded states.
 * @param {string[]} classes - Classes that identify the phase.
 * @returns {{classes: string[], opacity: number, connected: boolean}|undefined}
 */
function visualPhase(states, classes) {
  return states.find((state) => (
    Number.isFinite(state.opacity) && classes.every((className) => state.classes.includes(className))
  ));
}

test.describe('transitions', () => {
  test('applies enter classes in order and renders the visual fade', async ({ page, app }) => {
    await app.open('transitions', { hash: '#/list' });

    const list = page.getByTestId('transition-list');
    await recordInsertedItemClassStates(list, 'item-4');

    await page.getByTestId('add-item').click();

    const item = page.getByTestId('item-4');
    await expect(item).toBeVisible();
    await expectRecordedPhase(page, ['fade-enter-active', 'fade-enter-to']);

    const activeStates = await readClassStates(page);
    const activeEnter = visualPhase(activeStates, ['fade-enter-active', 'fade-enter-to']);
    expect(activeEnter).toBeDefined();
    expect(activeEnter.connected).toBe(true);
    expect(activeEnter.opacity).toBeLessThan(1);

    await expect.poll(() => hasNoFadeClasses(item)).toBe(true);
    await expect.poll(() => opacityOf(item)).toBe(1);

    const states = await readClassStates(page);
    const enterFrom = phaseIndex(states, ['fade-enter', 'fade-enter-active']);
    const enterTo = phaseIndex(states, ['fade-enter-active', 'fade-enter-to'], enterFrom);
    expect(enterFrom).toBeGreaterThanOrEqual(0);
    expect(enterTo).toBeGreaterThan(enterFrom);
  });

  test('keeps a leaving element attached until its visual transition ends', async ({ page, app }) => {
    await app.open('transitions', { hash: '#/list' });

    const item = page.getByTestId('item-2');
    await expect(item).toBeVisible();
    await expect.poll(() => hasNoFadeClasses(item)).toBe(true);
    const retainedItem = await item.elementHandle();
    if (!retainedItem) {
      throw new Error('Expected item-2 to exist before starting its leave transition.');
    }
    await recordClassStates(item);
    await item.evaluate((element) => {
      window.__leaveTransitionEnded = false;
      element.addEventListener('transitionend', () => {
        window.__leaveTransitionEnded = true;
      }, { once: true });
    });

    await page.getByTestId('remove-item-2').click();

    await expectRecordedPhase(page, ['fade-leave-active', 'fade-leave-to']);

    const activeStates = await readClassStates(page);
    const activeLeave = visualPhase(activeStates, ['fade-leave-active', 'fade-leave-to']);
    expect(activeLeave).toBeDefined();
    expect(activeLeave.connected).toBe(true);
    await expect(item).toBeAttached();
    expect(await opacityOf(item)).toBeLessThan(1);

    await expect(item).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__leaveTransitionEnded)).toBe(true);
    await expect.poll(() => hasNoFadeClasses(retainedItem)).toBe(true);

    const states = await readClassStates(page);
    const leaveFrom = phaseIndex(states, ['fade-leave', 'fade-leave-active']);
    const leaveTo = phaseIndex(states, ['fade-leave-active', 'fade-leave-to'], leaveFrom);
    expect(leaveFrom).toBeGreaterThanOrEqual(0);
    expect(leaveTo).toBeGreaterThan(leaveFrom);
  });

  test('settles a rapid enter-leave-enter sequence without duplicates or stale classes', async ({ page, app }) => {
    await app.open('transitions', { hash: '#/list' });

    const list = page.getByTestId('transition-list');
    const item = page.getByTestId('rapid-item');
    await expect(item).toHaveCount(0);

    const interruption = await interruptRapidListTransition(list);
    expect(interruption).toEqual({
      enterObserved: true,
      leaveObserved: true,
      connectedDuringLeave: true,
    });

    await expect(item).toHaveCount(1);
    await expect(item).toBeVisible();
    await expect.poll(() => page.evaluate((transitionClasses) => {
      const interrupted = window.__rapidInterruptedElement;
      const current = document.querySelectorAll('[data-testid="rapid-item"]');
      return Boolean(
        interrupted &&
        !interrupted.isConnected &&
        current.length === 1 &&
        current[0] !== interrupted &&
        transitionClasses.every((className) => !interrupted.classList.contains(className))
      );
    }, FADE_CLASSES)).toBe(true);
    await expect.poll(() => hasNoFadeClasses(item)).toBe(true);
    await expect.poll(() => opacityOf(item)).toBe(1);
  });

  test('transitions a new list item without disturbing its siblings', async ({ page, app }) => {
    await app.open('transitions', { hash: '#/list' });

    const list = page.getByTestId('transition-list');
    const item1 = page.getByTestId('item-1');
    const item2 = page.getByTestId('item-2');
    const item3 = page.getByTestId('item-3');

    await expect.poll(async () => (
      await Promise.all([item1, item2, item3].map((item) => hasNoFadeClasses(item)))
    ).every(Boolean)).toBe(true);

    await page.evaluate(() => {
      window.__listSiblingNodes = [
        document.querySelector('[data-testid="item-1"]'),
        document.querySelector('[data-testid="item-2"]'),
        document.querySelector('[data-testid="item-3"]'),
      ];
    });
    await recordInsertedItemClassStates(list, 'item-4');

    await page.getByTestId('add-item').click();

    const item4 = page.getByTestId('item-4');
    await expect(item4).toBeVisible();
    await expectRecordedPhase(page, ['fade-enter-active', 'fade-enter-to']);

    const activeStates = await readClassStates(page);
    const activeEnter = visualPhase(activeStates, ['fade-enter-active', 'fade-enter-to']);
    expect(activeEnter).toBeDefined();
    expect(activeEnter.opacity).toBeLessThan(1);

    await expect.poll(() => hasNoFadeClasses(item4)).toBe(true);
    await expect(page.getByTestId('name-item-1')).toHaveText('Alpha Item');
    await expect(page.getByTestId('name-item-2')).toHaveText('Beta Item');
    await expect(page.getByTestId('name-item-3')).toHaveText('Gamma Item');
    await expect(page.getByTestId('name-item-4')).toHaveText('Item 4');
    expect(await list.evaluate((element) => (
      Array.from(element.children, (child) => child.dataset.testid).filter(Boolean)
    ))).toEqual([
      'item-1',
      'item-2',
      'item-3',
      'item-4',
    ]);

    expect(await page.evaluate(() => window.__listSiblingNodes.every((node) => node?.isConnected))).toBe(true);
    expect(await page.evaluate(() => window.__listSiblingNodes.every((node) => (
      node === document.querySelector(`[data-testid="${node.dataset.testid}"]`)
    )))).toBe(true);
    expect(await Promise.all([item1, item2, item3].map((item) => hasNoFadeClasses(item)))).toEqual([
      true,
      true,
      true,
    ]);
  });
});
