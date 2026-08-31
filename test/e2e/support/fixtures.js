/**
 * The test object every E2E spec imports.
 *
 * Two things are added to Playwright's base fixtures:
 *
 * 1. `runtimeIssues` -- an always-on guard that fails a test if the page threw
 *    or logged an error, whether or not the test asserted anything about it.
 *    Under the old suite, `counter.html` threw "reactive is not a function" on
 *    line one and every test in the file reported a five-second locator
 *    timeout instead. That class of misdirection is now impossible: the thrown
 *    message is the failure.
 *
 * 2. `app` -- navigation helpers that address fixture applications by name, so
 *    a spec never hard-codes a path into the compiled output.
 * @module test/e2e/support/fixtures
 */

import { test as base, expect } from '@playwright/test';
import { appUrl } from './apps.js';

/**
 * Formats collected issues into a failure message that names the cause first.
 * @param {Array<{kind: string, text: string, stack?: string}>} issues - Collected issues.
 * @returns {string} A readable multi-line report.
 */
function report(issues) {
  const lines = issues.map((issue, index) => {
    const stack = issue.stack ? `\n     ${issue.stack.split('\n').slice(1, 4).join('\n     ')}` : '';
    return `  ${index + 1}. [${issue.kind}] ${issue.text}${stack}`;
  });

  return [
    `The page reported ${issues.length} unexpected runtime issue(s):`,
    ...lines,
    '',
    'If a test intends to provoke one, allow it explicitly:',
    "  runtimeIssues.allow(/expected message/);",
  ].join('\n');
}

export const test = base.extend({
  /**
   * Collects page errors and console errors, and fails the test on any that
   * were not explicitly allowed.
   *
   * Automatic, so a spec gets the guard without opting in; a spec that needs to
   * provoke an error destructures it and calls `allow()`.
   */
  runtimeIssues: [
    async ({ page }, use) => {
      /** @type {Array<{kind: string, text: string, stack?: string}>} */
      const collected = [];
      /** @type {RegExp[]} */
      const allowed = [];

      page.on('pageerror', (error) => {
        collected.push({ kind: 'pageerror', text: error.message, stack: error.stack });
      });

      page.on('console', (message) => {
        if (message.type() === 'error') {
          collected.push({ kind: 'console.error', text: message.text() });
        }
      });

      const api = {
        /**
         * Permits issues whose text matches `pattern`.
         * @param {RegExp} pattern - Matcher for the expected message.
         * @returns {void}
         */
        allow(pattern) {
          allowed.push(pattern);
        },
        /**
         * Every issue collected so far.
         * @returns {Array<{kind: string, text: string}>} The collected issues.
         */
        all() {
          return collected.slice();
        },
      };

      await use(api);

      const unexpected = collected.filter((issue) => !allowed.some((pattern) => pattern.test(issue.text)));
      if (unexpected.length > 0) {
        throw new Error(report(unexpected));
      }
    },
    { auto: true },
  ],

  /**
   * Navigation helpers scoped to the fixture applications.
   */
  app: async ({ page }, use) => {
    await use({
      /**
       * Opens a fixture application at an optional route hash.
       * @param {string} name - The fixture application name.
       * @param {object} [options] - Navigation options.
       * @param {string} [options.hash] - A route hash such as `#/profile/42`.
       * @param {string} [options.entry] - The HTML entry point to load.
       * @returns {Promise<void>}
       */
      async open(name, { hash = '', entry = 'index.html' } = {}) {
        await page.goto(`${appUrl(name, entry)}${hash}`);
      },
    });
  },
});

export { expect };
