import { test, expect } from '../../support/fixtures.js';

/**
 * End-to-end tests for declarative asynchronous data features:
 * <resource>, <@suspense> and <@errorBoundary>.
 *
 * Driven against the compiled production bundle of the `async` fixture application.
 */
test.describe('declarative async data (<resource>, <@suspense>, <@errorBoundary>)', () => {
  test('<@suspense> shows its <@fallback> while in flight, then resolved content', async ({ page, app }) => {
    await app.open('async');

    // While request is in flight, fallback UI is displayed
    await expect(page.getByTestId('suspense-fallback')).toHaveText('Loading suspense data...');
    await expect(page.getByTestId('suspense-resolved')).toHaveCount(0);

    // Once resolved, fallback is removed and content is displayed
    await expect(page.getByTestId('suspense-resolved')).toHaveText('AsyncSuccess');
    await expect(page.getByTestId('suspense-fallback')).toHaveCount(0);
  });

  test('<@errorBoundary> shows its fallback on rejection, and a "Retry" button calling refetch() recovers', async ({ page, app, runtimeIssues }) => {
    runtimeIssues.allow(/Failed to load resource.*500|500/);

    // Arm flaky endpoint to fail on request
    await page.request.post('http://localhost:3100/api/flaky/arm');

    await app.open('async', { hash: '#/error-boundary' });

    // Error boundary caught rejection and rendered fallback with error message
    await expect(page.getByTestId('error-message')).toContainText('500');
    await expect(page.getByTestId('flaky-resolved')).toHaveCount(0);

    // Recover endpoint so subsequent request succeeds
    await page.request.post('http://localhost:3100/api/flaky/recover');

    // Click retry button which triggers this.$resources.flakyData.refetch()
    await page.getByTestId('retry-btn').click();

    // Resolved content should be rendered and error fallback removed
    await expect(page.getByTestId('flaky-resolved')).toHaveText('recovered data');
    await expect(page.getByTestId('error-fallback')).toHaveCount(0);
  });

  test('a resource whose handler reads reactive state re-fetches when that state changes', async ({ page, app }) => {
    await app.open('async', { hash: '#/dependencies' });

    // Initially loads user 1
    await expect(page.getByTestId('user-name')).toHaveText('User 1');

    // Change state to userId = '2'
    await page.getByTestId('select-user-2').click();
    await expect(page.getByTestId('user-name')).toHaveText('User 2');

    // Change state to userId = '3'
    await page.getByTestId('select-user-3').click();
    await expect(page.getByTestId('user-name')).toHaveText('User 3');
  });

  test('out-of-order responses: fast response wins over preceding slow response', async ({ page, app }) => {
    await app.open('async', { hash: '#/race' });

    // Initially resolved
    await expect(page.getByTestId('race-result')).toHaveText('Result for initial');

    // Track the slow response from the network
    const slowResponse = page.waitForResponse((res) => res.url().includes('q=slow'));

    // Trigger slow request (delay 300ms) then immediately trigger fast request (delay 50ms)
    await page.getByTestId('slow-search-btn').click();
    await page.getByTestId('fast-search-btn').click();

    // Fast response arrives first (~50ms)
    await expect(page.getByTestId('race-result')).toHaveText('Result for fast');

    // Wait for the slow response to arrive over the wire
    await slowResponse;

    // The DOM must retain the fast result and NOT flip back to the stale slow response
    await expect(page.getByTestId('race-result')).toHaveText('Result for fast');
  });

  test('mutate() updates the rendered value without a network round trip', async ({ page, app }) => {
    await app.open('async', { hash: '#/mutate' });

    // Initial fetched profile
    await expect(page.getByTestId('profile-name')).toHaveText('Alice');
    await expect(page.getByTestId('profile-role')).toHaveText('Engineer');

    // Monitor any network requests to /api/profile
    let profileRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/profile')) {
        profileRequests++;
      }
    });

    // Mutate locally
    await page.getByTestId('mutate-btn').click();

    // Value updates immediately in the DOM
    await expect(page.getByTestId('profile-name')).toHaveText('Mutated Alice');
    await expect(page.getByTestId('profile-role')).toHaveText('Architect');

    // Zero network requests made for the mutation
    expect(profileRequests).toBe(0);
  });

  test('pollInterval refreshes the rendered value periodically', async ({ page, app }) => {
    // Reset server poll counter
    await page.request.get('http://localhost:3100/api/poll/reset');

    await app.open('async', { hash: '#/polling' });

    // Initial poll count
    await expect(page.getByTestId('poll-count')).toHaveText('1');

    // Poll intervals trigger subsequent fetches
    await expect(page.getByTestId('poll-count')).toHaveText('2');
    await expect(page.getByTestId('poll-count')).toHaveText('3');
  });

  test('unmounting a component mid-flight aborts the request without console errors', async ({ page, app }) => {
    await app.open('async', { hash: '#/unmount' });

    // Child component is mounted and in-flight
    await expect(page.getByTestId('child-loading')).toBeVisible();

    // Unmount while request is still pending
    await page.getByTestId('unmount-btn').click();

    // Child is removed
    await expect(page.getByTestId('child-loading')).toHaveCount(0);

    // Page remains healthy, runtimeIssues automatic check asserts no console.error or pageerror occurred
    await expect(page.getByTestId('unmount-page')).toBeVisible();
  });
});

