import { test, expect } from '../../support/fixtures.js';

/**
 * An application built with `csp.strict`, served under `script-src 'self'`.
 *
 * This is the acceptance criterion the issue states and the one no other test
 * can stand in for. The unit tests check the compiler's own scan; the system
 * test refuses `eval` and the `Function` constructor inside happy-dom, which is
 * a good approximation. Only a real browser enforcing a real
 * Content-Security-Policy header decides whether the claim is true, and only it
 * reports a violation the way a user's console would.
 *
 * The policy is set by the E2E server for every file under `/csp/`, declared
 * beside the app in `support/apps.js`. Both bundles are driven under it: the
 * production one, where the framework already promised this, and the
 * development one, which is what `csp.strict` adds.
 */
test.describe('CSP-strict build under script-src \'self\'', () => {
  for (const [label, entry] of [
    ['production build', 'index.html'],
    ['development build', 'index-dev.html'],
  ]) {
    test.describe(label, () => {
      test.beforeEach(async ({ app }) => {
        await app.open('csp', { entry });
      });

      test('the policy header reaches the browser', async ({ page }) => {
        const header = await page.evaluate(async () => {
          const response = await fetch(window.location.href, { cache: 'no-store' });
          return response.headers.get('content-security-policy');
        });
        expect(header).toContain("script-src 'self'");
        expect(header).not.toContain('unsafe-eval');
      });

      test('it mounts and renders every expression kind', async ({ page }) => {
        // Interpolation, a bound attribute, and two computed values, one of
        // which reads the other.
        await expect(page.getByTestId('heading')).toHaveText('board');
        await expect(page.getByTestId('heading')).toHaveAttribute('title', 'board');
        await expect(page.getByTestId('count')).toHaveText('0');
        await expect(page.getByTestId('doubled')).toHaveText('0');
        await expect(page.getByTestId('caption')).toHaveText('BOARD/0');

        // A keyed list, its implicit index, and a loop variable that shadows a
        // state key -- which must shadow it inside the loop and not outside.
        await expect(page.getByTestId('row')).toHaveText(['0:one', '1:two', '2:three']);
        await expect(page.getByTestId('row').first()).toHaveAttribute('data-id', '1');
        await expect(page.getByTestId('after-loop')).toHaveText('board');

        // A directive whose condition is false.
        await expect(page.getByTestId('many')).toBeHidden();
      });

      test('an inline handler runs, and so does a statement-bodied action', async ({ page }) => {
        // The part that only a running page can check. A compiled expression
        // evaluated at mount proves the table was linked; interpreting a
        // *statement* body is the one thing that reaches the Function
        // constructor, so an action written with `let` and `for` is the case
        // that would fail under this policy if it had not been precompiled.
        await page.getByTestId('bump').click();
        await expect(page.getByTestId('count')).toHaveText('1');
        await expect(page.getByTestId('doubled')).toHaveText('2');
        await expect(page.getByTestId('caption')).toHaveText('BOARD/2');
        await expect(page.getByTestId('many')).toBeHidden();

        await page.getByTestId('sum').click();
        await expect(page.getByTestId('count')).toHaveText('6');
        await expect(page.getByTestId('doubled')).toHaveText('12');

        // The directive re-evaluated and the element is now shown, so the
        // update ran rather than the first render simply surviving.
        await expect(page.getByTestId('many')).toBeVisible();
      });

      test('the browser reports no policy violation', async ({ page }) => {
        // `runtimeIssues` already fails the test on any console error, and a
        // blocked eval is reported as one. This asserts it directly as well,
        // because a violation is the specific failure this file exists to
        // catch and it should be named when it happens.
        const violations = [];
        page.on('console', (message) => {
          if (/Content Security Policy|unsafe-eval|Refused to evaluate/i.test(message.text())) {
            violations.push(message.text());
          }
        });

        await page.getByTestId('bump').click();
        await page.getByTestId('sum').click();
        await expect(page.getByTestId('count')).toHaveText('6');

        expect(violations).toEqual([]);
      });
    });
  }

  test('the control: the policy is enforced, not merely sent', async ({ page, app, runtimeIssues }) => {
    // Every other test in this file would pass against a browser that ignored
    // the header, so something the policy forbids has to be seen to fail.
    //
    // It cannot be `new Function(...)` inside `page.evaluate`: Playwright
    // evaluates through the debugger protocol, which is not subject to the
    // page's CSP, so that call succeeds no matter what the policy says -- the
    // first version of this test asserted exactly that and was wrong.
    //
    // An inline <script> is subject to it, and is forbidden by the same
    // `script-src 'self'` that forbids eval. The canary entry point carries
    // one that sets a global; under the policy it never runs.
    runtimeIssues.allow(/Content Security Policy|Refused to execute inline script/i);
    await app.open('csp', { entry: 'index-canary.html' });

    expect(await page.evaluate(() => window.__cspCanaryRan)).toBeUndefined();

    // And the application on the same page still mounted, which is the other
    // half of the point: the policy is strict and Avenx runs under it.
    await expect(page.getByTestId('caption')).toHaveText('BOARD/0');
  });
});
