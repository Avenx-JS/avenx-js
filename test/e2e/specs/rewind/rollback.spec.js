import { test, expect } from '../../support/fixtures.js';

/**
 * Hold a real request until the optimistic DOM has been asserted. Releasing it
 * reaches the fixture server, whose response decides success or rejection.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} outcome - Server response to gate.
 * @returns {Promise<Function>} Releases and waits for the response.
 */
async function holdRequest(page, outcome) {
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const pattern = `**/api/rewind?outcome=${outcome}`;
  await page.route(pattern, async (route) => {
    await ready;
    await route.continue();
  });
  return async () => {
    const response = page.waitForResponse((res) => res.url().endsWith(`/api/rewind?outcome=${outcome}`));
    release();
    await response;
  };
}

test('a synchronous throw restores the rendered count', async ({ page, app, runtimeIssues }) => {
  runtimeIssues.allow(/rewind sync failure/);
  await app.open('rewind');
  await expect(page.getByTestId('count')).toHaveText('0');
  await page.getByTestId('fail-sync').click();
  // A synchronous throw rewinds before the browser can paint the intermediate
  // write. The error proves execution reached the throw, rather than a no-op.
  await expect.poll(() => runtimeIssues.all().some((issue) => issue.text.includes('rewind sync failure'))).toBe(true);
  await expect(page.getByTestId('count')).toHaveText('0');
});

test('a rejected request repaints the optimistic count', async ({ page, app, runtimeIssues }) => {
  runtimeIssues.allow(/rewind request rejected/);
  const release = await holdRequest(page, 'fail');
  await app.open('rewind');
  await page.getByTestId('fail-later').click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await release();
  await expect(page.getByTestId('count')).toHaveText('0');
});

test('bridge rollback repaints both shared-state observers', async ({ page, app, runtimeIssues }) => {
  runtimeIssues.allow(/rewind request rejected/);
  const release = await holdRequest(page, 'fail');
  await app.open('rewind');
  await page.getByTestId('fail-bridge').click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await expect(page.getByTestId('quantity')).toHaveText('3');
  await expect(page.getByTestId('observer-quantity')).toHaveText('3');
  await release();
  await expect(page.getByTestId('count')).toHaveText('0');
  await expect(page.getByTestId('quantity')).toHaveText('2');
  await expect(page.getByTestId('observer-quantity')).toHaveText('2');
});

test('rollback restores nested values, collections, created and deleted keys', async ({ page, app, runtimeIssues }) => {
  runtimeIssues.allow(/rewind request rejected/);
  const release = await holdRequest(page, 'fail');
  await app.open('rewind');
  await expect(page.getByTestId('pairs').locator('li')).toHaveText(['kept=1', 'removed=2']);
  await expect(page.getByTestId('tags').locator('li')).toHaveText(['old']);
  await page.getByTestId('fail-collections').click();
  await expect(page.getByTestId('nested')).toHaveText('9');
  await expect(page.getByTestId('keys')).toHaveText('created,nested');
  await expect(page.getByTestId('removed')).toHaveText('missing');
  await expect(page.getByTestId('items')).toHaveText('changed,new');
  await expect(page.getByTestId('pairs').locator('li')).toHaveText(['kept=9', 'created=3']);
  await expect(page.getByTestId('tags').locator('li')).toHaveText(['new']);
  await release();
  await expect(page.getByTestId('nested')).toHaveText('1');
  await expect(page.getByTestId('keys')).toHaveText('nested,removed');
  await expect(page.getByTestId('removed')).toHaveText('kept');
  await expect(page.getByTestId('items')).toHaveText('old');
  await expect(page.getByTestId('pairs').locator('li')).toHaveText(['kept=1', 'removed=2']);
  await expect(page.getByTestId('tags').locator('li')).toHaveText(['old']);
});

test('safe rollback keeps the newer optimistic write and reports the conflict', async ({ page, app, runtimeIssues }) => {
  runtimeIssues.allow(/rewind request rejected/);
  runtimeIssues.allow(/AVX_R29/);
  const reject = await holdRequest(page, 'fail');
  const commit = await holdRequest(page, 'success');
  await app.open('rewind');
  await page.getByTestId('fail-later').click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await page.getByTestId('succeed').click();
  await expect(page.getByTestId('count')).toHaveText('2');
  await reject();
  await expect.poll(() => runtimeIssues.all().some((issue) => issue.text.includes('AVX_R29') && issue.text.includes('count'))).toBe(true);
  await expect(page.getByTestId('count')).toHaveText('2');
  await commit();
  await expect(page.getByTestId('commits')).toHaveText('1');
  await expect(page.getByTestId('count')).toHaveText('2');
});

test('a successful request commits its optimistic update', async ({ page, app }) => {
  const release = await holdRequest(page, 'success');
  await app.open('rewind');
  await page.getByTestId('succeed').click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await release();
  await expect(page.getByTestId('commits')).toHaveText('1');
  await expect(page.getByTestId('count')).toHaveText('1');
  // A second successful transaction starts from the committed value.
  await page.getByTestId('succeed').click();
  await expect(page.getByTestId('commits')).toHaveText('2');
  await expect(page.getByTestId('count')).toHaveText('2');
});
