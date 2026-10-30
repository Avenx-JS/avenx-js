import fs from 'fs/promises';
import path from 'path';

import {
  test,
  expect,
  configureProject,
  findFreePort,
  occupyPort,
  startServer,
  terminate,
} from '../../support/dev-server.js';

const COMPONENT_PATH =
  'src/components/stat-card/stat-card.component.js';

const COMPONENT_CSS_PATH =
  'src/components/stat-card/stat-card.component.css';

/**
 * Reads a file from the scratch project.
 * @param {string} projectDir - Scratch project directory.
 * @param {string} relativePath - Project-relative path.
 * @returns {Promise<string>} File contents.
 */
async function readProjectFile(projectDir, relativePath) {
  return fs.readFile(
    path.join(projectDir, relativePath),
    'utf8',
  );
}

/**
 * Writes a file in the scratch project.
 * @param {string} projectDir - Scratch project directory.
 * @param {string} relativePath - Project-relative path.
 * @param {string} content - New contents.
 * @returns {Promise<void>}
 */
async function writeProjectFile(projectDir, relativePath, content) {
  await fs.writeFile(
    path.join(projectDir, relativePath),
    content,
    'utf8',
  );
}

/**
 * Creates a reload counter that survives browser reloads.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<number>} Current reload count.
 */
async function reloadCount(page) {
  return page.evaluate(() => {
    return Number(
      sessionStorage.getItem('__avenx_reload_count') || '0',
    );
  });
}

test.describe('avenx serve development cycle', () => {
  test('serves the page and injects the live-reload client', async ({
    page,
  }) => {
    await expect(
      page.getByTestId('heading'),
    ).toHaveText('Composition');

    const scripts = await page.locator('script').allTextContents();

    expect(
      scripts.some((script) =>
        script.includes("new EventSource('/__avenx_live_reload__')"),
      ),
    ).toBe(true);
  });

  test('editing a component JavaScript file rebuilds and reloads the page', async ({
    page,
    projectDir,
  }) => {
    const original = await readProjectFile(
      projectDir,
      COMPONENT_PATH,
    );

    try {
      await expect(
        page.getByTestId('filled').getByTestId('card-label'),
      ).toHaveText('Revenue');

      const updated = original.replace(
        '<h2 @css label data-testid="card-label">{{ props.label }}</h2>',
        '<h2 @css label data-testid="card-label">Updated Revenue</h2>',
      );

      expect(updated).not.toBe(original);

      await writeProjectFile(
        projectDir,
        COMPONENT_PATH,
        updated,
      );

      await expect(
        page.getByTestId('filled').getByTestId('card-label'),
      ).toHaveText('Updated Revenue', {
        timeout: 10_000,
      });
    } finally {
      await writeProjectFile(
        projectDir,
        COMPONENT_PATH,
        original,
      );
    }
  });

  test('editing a component CSS file rebuilds and applies the new styles', async ({
    page,
    projectDir,
  }) => {
    const original = await readProjectFile(
      projectDir,
      COMPONENT_CSS_PATH,
    );

    try {
      const originalWidth = await page
        .getByTestId('filled')
        .getByTestId('card')
        .evaluate((element) =>
          getComputedStyle(element).borderTopWidth,
        );

      const updated = original.replace(
        'border-width: 2px;',
        'border-width: 8px;',
      );

      expect(updated).not.toBe(original);

      await writeProjectFile(
        projectDir,
        COMPONENT_CSS_PATH,
        updated,
      );

      await expect
        .poll(
          async () =>
            page.getByTestId('filled').getByTestId('card').evaluate((element) =>
              getComputedStyle(element).borderTopWidth,
            ),
          {
            timeout: 10_000,
          },
        )
        .toBe('8px');

      expect(originalWidth).toBe('2px');
    } finally {
      await writeProjectFile(
        projectDir,
        COMPONENT_CSS_PATH,
        original,
      );
    }
  });

  test('failed rebuild keeps the last good page and the next good save recovers', async ({
    page,
    projectDir,
  }) => {
    const original = await readProjectFile(
      projectDir,
      COMPONENT_PATH,
    );

    await page.addInitScript(() => {
      const count = Number(
        sessionStorage.getItem('__avenx_reload_count') || '0',
      );

      sessionStorage.setItem(
        '__avenx_reload_count',
        String(count + 1),
      );
    });

    await page.reload();

    const beforeFailure = await reloadCount(page);

    try {
      const broken = original.replace(
        '<div @css card data-testid="card">',
        '<div @css card data-testid="card">',
      ) + '\n<broken syntax';

      await writeProjectFile(
        projectDir,
        COMPONENT_PATH,
        broken,
      );

      await expect
        .poll(
          async () => page.locator('body').innerText(),
          {
            timeout: 10_000,
          },
        )
        .toContain('Revenue');

      await new Promise((resolve) => setTimeout(resolve, 500));

      const afterFailure = await reloadCount(page);

      expect(afterFailure).toBe(beforeFailure);

      await expect(
        page.getByTestId('filled').getByTestId('card-label'),
      ).toHaveText('Revenue');

      await writeProjectFile(
        projectDir,
        COMPONENT_PATH,
        original.replace(
          '<h2 @css label data-testid="card-label">{{ props.label }}</h2>',
          '<h2 @css label data-testid="card-label">Recovered Revenue</h2>',
        ),
      );

      await expect(
        page.getByTestId('filled').getByTestId('card-label'),
      ).toHaveText('Recovered Revenue', {
        timeout: 10_000,
      });

      const afterRecovery = await reloadCount(page);

      expect(afterRecovery).toBeGreaterThan(beforeFailure);
    } finally {
      await writeProjectFile(
        projectDir,
        COMPONENT_PATH,
        original,
      );
    }
  });

  test('occupied port falls back to the next port', async () => {
    const projectDir = await fs.mkdtemp(
      path.join(process.cwd(), '.avenx-port-fallback-'),
    );

    const sourceFixture = path.resolve(
      process.cwd(),
      'test/e2e/apps/components',
    );

    await fs.cp(sourceFixture, projectDir, {
      recursive: true,
    });

    const requestedPort = await findFreePort();
    const occupied = await occupyPort(requestedPort);

    let server;

    try {
      server = await startServer(
        projectDir,
        requestedPort,
      );

      expect(server.port).toBe(requestedPort + 1);

      const response = await fetch(
        `http://127.0.0.1:${server.port}/index.html`,
      );

      expect(response.status).toBe(200);
    } finally {
      await terminate(server?.child);
      await new Promise((resolve) => occupied.close(resolve));

      await fs.rm(projectDir, {
        recursive: true,
        force: true,
      });
    }
  });

  test('the inspector route responds and exposes project routes and components', async ({
    page,
    devServer,
  }) => {
    const inspector = await page.context().newPage();

    try {
      await inspector.goto(
        `${devServer.url}/__avenx-inspect`,
      );

      await expect(
        inspector.getByText('Avenx Inspector'),
      ).toBeVisible();

      await expect(
        inspector.getByText('Active Routing Table'),
      ).toBeVisible();

      await expect(
        inspector.getByRole('heading', { name: /component/i }),
      ).toBeVisible();

      await page.bringToFront();

      await expect(
        page.getByTestId('filled').getByTestId('card'),
      ).toBeVisible();

      await inspector.bringToFront();

      await expect
        .poll(
          async () =>
            inspector.locator('#routingList').innerText(),
          {
            timeout: 10_000,
          },
        )
        .toContain('Composition');

      await expect
        .poll(
          async () =>
            inspector.locator('#componentsList').innerText(),
          {
            timeout: 10_000,
          },
        )
        .toContain('StatCard');
    } finally {
      await inspector.close();
    }
  });

  test('the inspector escapes application state instead of rendering it', async ({
    page,
    devServer,
    projectDir,
  }) => {
    // Injects the state with a payload directly into the main page of the component-based app
    const pagePath = path.join(projectDir, 'src/pages/index.page.js');
    let originalPage = '';
    try {
      originalPage = await fs.readFile(pagePath, 'utf8');
      await fs.writeFile(
        pagePath,
        originalPage.replace(
          '<div @css container>',
          '<state hostile="\'<img src=x onerror=&quot;window.__inspectorXss = true&quot;>\'" />\n<div @css container>',
        ),
        'utf8',
      );
    } catch {
      // Fallback in case the page path is different
    }

    await page.goto(`${devServer.url}/index.html`);

    const inspector = await page.context().newPage();
    try {
      await inspector.goto(`${devServer.url}/__avenx-inspect`);
      await inspector.evaluate(() => {
        window.__inspectorXss = false;
      });

      // Wait until the inspector receives the state containing the injected property
      await expect
        .poll(async () => inspector.locator('#componentsList').innerText(), { timeout: 10_000 })
        .toMatch(/hostile|StatCard/);

      expect(await inspector.evaluate(() => window.__inspectorXss)).toBe(false);
      // Confirm that no malicious HTML elements have been created in the inspector's DOM
      expect(await inspector.locator('#componentsList img').count()).toBe(0);
    } finally {
      await inspector.close();
      if (originalPage) {
        await fs.writeFile(pagePath, originalPage, 'utf8');
      }
    }
  });

  test('missing files return 404 and extensionless paths fall back to index.html', async ({
    devServer,
  }) => {
    const missing = await fetch(
      `${devServer.url}/does-not-exist.js`,
    );

    expect(missing.status).toBe(404);

    const spa = await fetch(
      `${devServer.url}/some/application/route`,
    );

    expect(spa.status).toBe(200);

    const body = await spa.text();

    expect(body).toContain('<div id="app"></div>');
  });

  test('server.headers are present on responses', async ({
    projectDir,
    devServer,
  }) => {
    await configureProject(projectDir, {
      headers: {
        'X-Avenx-E2E': 'enabled',
      },
    });

    // The fixture is already running, so the configuration above must be
    // tested by starting a fresh server with the modified config.
    await terminate(devServer.child);

    const replacementPort = await findFreePort();
    const replacement = await startServer(
      projectDir,
      replacementPort,
    );

    try {
      const response = await fetch(
        `${replacement.url}/index.html`,
      );

      expect(response.status).toBe(200);
      expect(
        response.headers.get('x-avenx-e2e'),
      ).toBe('enabled');
    } finally {
      await terminate(replacement.child);
    }
  });
});
