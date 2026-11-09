import { test, expect } from '../../support/fixtures.js';

/**
 * Route-level code splitting, driven in a browser.
 *
 * `codeSplitting: true` moves every page into its own chunk under
 * `dist/pages/`, which the bundle fetches with a dynamic `import()` the first
 * time the route is visited. A chunk is a standalone module: it does not
 * import the runtime, so the base class and the expression helpers the
 * compiled template calls have to be found at load time.
 *
 * `test/system/codeSplittingBuild.test.js` imports a chunk in Node, where the
 * bare `avenx-core/runtime` specifier resolves through node_modules. A browser
 * has no such resolution, so this is the only place the chunk's prelude is
 * exercised the way a deployment runs it: against what the bundle actually
 * published on `window.Avenx`, and nothing else.
 */
test.describe('code-split pages in the browser', () => {
  test('renders template expressions from a lazily loaded page chunk', async ({ page, app }) => {
    const chunkRequests = [];
    page.on('request', (request) => {
      if (/\/dist\/pages\/[^/]+\.page\.js$/.test(request.url())) {
        chunkRequests.push(request.url());
      }
    });

    await app.open('code-splitting');

    // Static markup renders even when the helpers are missing, so the title
    // alone would not catch the regression. The expressions are the test.
    await expect(page.getByTestId('title')).toHaveText('Split home');
    await expect(page.getByTestId('count')).toHaveText('0');
    await expect(page.getByTestId('doubled')).toHaveText('0');

    // The page really was split: the class arrived through a chunk request,
    // not inline in bundle.js.
    expect(chunkRequests.some((url) => url.endsWith('/dist/pages/home.page.js'))).toBe(true);
  });

  test('keeps the split page reactive after it has loaded', async ({ page, app }) => {
    await app.open('code-splitting');

    await page.getByTestId('increment').click();
    await page.getByTestId('increment').click();

    await expect(page.getByTestId('count')).toHaveText('2');
    await expect(page.getByTestId('doubled')).toHaveText('4');
  });

  test('loads a second chunk on navigation and renders its expressions', async ({ page, app }) => {
    await app.open('code-splitting');
    await expect(page.getByTestId('title')).toHaveText('Split home');

    await page.getByTestId('nav-about').click();

    await expect(page.getByTestId('page-about')).toBeVisible();
    await expect(page.getByTestId('description')).toHaveText('Loaded from a second chunk');
    await expect(page).toHaveURL(/#\/about$/);
  });

  test('reports no template render error for a split page', async ({ page, app }) => {
    // AVX_R08 is a warning, not an error, so the runtimeIssues guard does not
    // see it. Listening for it by name makes a regression read as what it is:
    // "axGet is not a function" from a chunk that could not reach the
    // expression helpers, rather than an empty element and a timeout.
    const renderWarnings = [];
    page.on('console', (message) => {
      if (/AVX_R08/.test(message.text())) {
        renderWarnings.push(message.text());
      }
    });

    await app.open('code-splitting');
    await expect(page.getByTestId('count')).toHaveText('0');

    expect(renderWarnings, 'no AVX_R08 should be logged for a split page').toEqual([]);
  });
});
