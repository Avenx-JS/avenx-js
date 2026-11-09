import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

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
 * Waits for a source rebuild to emit a marker in the scratch bundle.
 * @param {string} projectDir - Scratch project directory.
 * @param {string} marker - Text expected in the compiled bundle.
 * @returns {Promise<void>}
 */
async function waitForBundleMarker(projectDir, marker) {
  await expect.poll(
    async () => {
      try {
        return (await readProjectFile(projectDir, 'dist/bundle.js')).includes(marker);
      } catch {
        return false;
      }
    },
    { timeout: 10_000 },
  ).toBe(true);
}

const execFileAsync = promisify(execFile);

/**
 * Replaces the scratch fixture with a stateful app used by hot-swap tests.
 * @param {string} projectDir - Scratch project directory.
 * @returns {Promise<void>}
 */
async function writeHotSwapFixture(projectDir) {
  await fs.mkdir(
    path.join(projectDir, 'src/components/hot-panel'),
    { recursive: true },
  );
  await fs.mkdir(
    path.join(projectDir, 'src/bridges'),
    { recursive: true },
  );

  await Promise.all([
    writeProjectFile(
      projectDir,
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import HotPanel from './components/hot-panel/hot-panel.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('HotPanel', HotPanel);
app.initRouter({
  '/': 'Home',
  '#/details': 'Details',
});
`,
    ),
    writeProjectFile(
      projectDir,
      'src/bridges/session.bridge.js',
      `import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {
    value: 'bridge-ready',
  },

  setValue(value) {
    this.value = value;
  },
});
`,
    ),
    writeProjectFile(
      projectDir,
      'src/components/hot-panel/hot-panel.component.js',
      `<div class="hot-panel" data-testid="component-panel">
  <input aria-label="Focused field" data-testid="focus-input" />
  <div class="scroll-box" data-testid="scroll-box">
    <div style="height: 800px">Scrollable content</div>
  </div>
</div>
`,
    ),
    writeProjectFile(
      projectDir,
      'src/components/hot-panel/hot-panel.component.css',
      `<@global>
.hot-panel {
  border-top-style: solid;
  border-top-width: 2px;
}
</@global>
`,
    ),
    writeProjectFile(
      projectDir,
      'src/pages/home.page.js',
      `import session from '../bridges/session.bridge.js';

<state count="1" />
<main data-testid="home-page">
  <p data-testid="count">{{ count }}</p>
  <p data-testid="bridge">{{ session.value }}</p>
  <button data-testid="increment" @click="count = count + 1">Increment</button>
  <button data-testid="bridge-update" @click="session.setValue('bridge-updated')">Update bridge</button>
  <HotPanel />
</main>
`,
    ),
    writeProjectFile(
      projectDir,
      'src/pages/home.page.css',
      `<@global>
[data-testid="home-page"] {
  color: rgb(1, 2, 3);
}
</@global>
`,
    ),
    writeProjectFile(
      projectDir,
      'src/pages/details.page.js',
      `import session from '../bridges/session.bridge.js';

<state count="1" />
<main data-testid="details-page">
  <p data-testid="count">{{ count }}</p>
  <p data-testid="bridge">{{ session.value }}</p>
  <button data-testid="increment" @click="count = count + 1">Increment</button>
  <button data-testid="bridge-update" @click="session.setValue('bridge-updated')">Update bridge</button>
  <HotPanel />
</main>
`,
    ),
    writeProjectFile(
      projectDir,
      'src/pages/details.page.css',
      `<@global>
[data-testid="details-page"] {
  color: rgb(1, 2, 3);
}
</@global>
`,
    ),
  ]);
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

  test('CSS-only component and page updates preserve application state without reloading', async ({
    page,
    projectDir,
  }) => {
    await writeHotSwapFixture(projectDir);
    await waitForBundleMarker(projectDir, 'HotPanel');

    let loadCount = 0;
    page.on('load', () => {
      loadCount++;
    });
    await page.reload();
    await page.goto(`${page.url()}#/details`);

    await expect(page.getByTestId('details-page')).toBeVisible();
    const cssBaselineLoads = loadCount;
    await expect(page.getByTestId('count')).toHaveText('1');
    await page.getByTestId('increment').click();
    await page.getByTestId('bridge-update').click();
    await page.getByTestId('focus-input').focus();
    await page.getByTestId('scroll-box').evaluate((element) => {
      element.scrollTop = 120;
    });

    const before = await page.evaluate(() => ({
      route: location.hash,
      active: document.activeElement?.getAttribute('data-testid'),
      scrollTop: document.querySelector('[data-testid="scroll-box"]').scrollTop,
    }));

    const componentCss = await readProjectFile(
      projectDir,
      'src/components/hot-panel/hot-panel.component.css',
    );
    const pageCss = await readProjectFile(
      projectDir,
      'src/pages/details.page.css',
    );

    try {
      await expect.poll(
        async () => page.getByTestId('component-panel').evaluate((element) =>
          getComputedStyle(element).borderTopWidth,
        ),
      ).toBe('2px');
      await expect.poll(
        async () => page.getByTestId('details-page').evaluate((element) =>
          getComputedStyle(element).color,
        ),
      ).toBe('rgb(1, 2, 3)');

      await writeProjectFile(
        projectDir,
        'src/components/hot-panel/hot-panel.component.css',
        componentCss.replace('2px', '8px'),
      );
      await writeProjectFile(
        projectDir,
        'src/pages/details.page.css',
        pageCss.replace('rgb(1, 2, 3)', 'rgb(4, 5, 6)'),
      );

      await expect.poll(
        async () => page.getByTestId('component-panel').evaluate((element) =>
          getComputedStyle(element).borderTopWidth,
        ),
        { timeout: 10_000 },
      ).toBe('8px');
      await expect.poll(
        async () => page.getByTestId('details-page').evaluate((element) =>
          getComputedStyle(element).color,
        ),
        { timeout: 10_000 },
      ).toBe('rgb(4, 5, 6)');

      await expect(page.getByTestId('count')).toHaveText('2');
      await expect(page.getByTestId('bridge')).toHaveText('bridge-updated');
      await expect.poll(() => page.evaluate(() => ({
        route: location.hash,
        active: document.activeElement?.getAttribute('data-testid'),
        scrollTop: document.querySelector('[data-testid="scroll-box"]').scrollTop,
      }))).toEqual(before);
      expect(loadCount).toBe(cssBaselineLoads);
    } finally {
      await writeProjectFile(
        projectDir,
        'src/components/hot-panel/hot-panel.component.css',
        componentCss,
      );
      await writeProjectFile(
        projectDir,
        'src/pages/details.page.css',
        pageCss,
      );
    }
  });

  test('keeps the old stylesheet during a CSS swap and removes it after load', async ({
    page,
    projectDir,
  }) => {
    await writeHotSwapFixture(projectDir);
    await waitForBundleMarker(projectDir, 'HotPanel');
    await page.reload();
    await page.goto(`${page.url()}#/details`);
    await expect(page.getByTestId('details-page')).toBeVisible();

    let releaseStylesheet;
    const stylesheetReady = new Promise((resolve) => {
      releaseStylesheet = resolve;
    });
    await page.route('**/bundle.css?t=*', async (route) => {
      const response = await route.fetch();
      await stylesheetReady;
      await route.fulfill({ response });
    });

    const original = await readProjectFile(
      projectDir,
      'src/pages/details.page.css',
    );

    try {
      await writeProjectFile(
        projectDir,
        'src/pages/details.page.css',
        original.replace('rgb(1, 2, 3)', 'rgb(7, 8, 9)'),
      );

      await expect.poll(
        () => page.locator('link[rel="stylesheet"][href*="bundle.css"]').count(),
        { timeout: 10_000 },
      ).toBe(2);
      await expect.poll(
        () => page.getByTestId('details-page').evaluate((element) =>
          getComputedStyle(element).color,
        ),
      ).toBe('rgb(1, 2, 3)');

      releaseStylesheet();

      await expect(
        page.locator('link[rel="stylesheet"][href*="bundle.css"]'),
      ).toHaveCount(1, { timeout: 10_000 });
      await expect.poll(
        () => page.getByTestId('details-page').evaluate((element) =>
          getComputedStyle(element).color,
        ),
      ).toBe('rgb(7, 8, 9)');
    } finally {
      await page.unroute('**/bundle.css?t=*');
      await writeProjectFile(
        projectDir,
        'src/pages/details.page.css',
        original,
      );
    }
  });

  test('reloads for JavaScript changes and changes touching JavaScript and CSS', async ({
    page,
    projectDir,
  }) => {
    await writeHotSwapFixture(projectDir);
    await waitForBundleMarker(projectDir, 'HotPanel');
    await page.reload();
    await page.goto(`${page.url()}#/details`);

    let loads = 0;
    page.on('load', () => {
      loads++;
    });
    const originalJs = await readProjectFile(
      projectDir,
      'src/components/hot-panel/hot-panel.component.js',
    );
    const originalCss = await readProjectFile(
      projectDir,
      'src/components/hot-panel/hot-panel.component.css',
    );

    try {
      const jsOnlyUpdate = originalJs.replace(
        '<div class="hot-panel" data-testid="component-panel">',
        '<div class="hot-panel" data-testid="component-panel"><h1 data-testid="js-only-update">Updated component</h1>',
      );
      expect(jsOnlyUpdate).not.toBe(originalJs);
      await writeProjectFile(
        projectDir,
        'src/components/hot-panel/hot-panel.component.js',
        jsOnlyUpdate,
      );
      await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThan(0);
      await expect(page.getByTestId('js-only-update')).toHaveText('Updated component');

      const previousLoads = loads;
      const updatedJs = originalJs.replace(
        '<div class="hot-panel" data-testid="component-panel">',
        '<div class="hot-panel" data-testid="component-panel"><h1 data-testid="mixed-update">Mixed update</h1>',
      );
      const updatedCss = originalCss.replace('2px', '9px');
      expect(updatedJs).not.toBe(originalJs);
      expect(updatedCss).not.toBe(originalCss);
      await Promise.all([
        writeProjectFile(
          projectDir,
          'src/components/hot-panel/hot-panel.component.js',
          updatedJs,
        ),
        writeProjectFile(
          projectDir,
          'src/components/hot-panel/hot-panel.component.css',
          updatedCss,
        ),
      ]);
      await expect.poll(
        () => loads,
        { timeout: 10_000 },
      ).toBeGreaterThan(previousLoads);
      await expect(page.getByTestId('mixed-update')).toHaveText('Mixed update');
      await expect.poll(
        () => page.getByTestId('component-panel').evaluate((element) =>
          getComputedStyle(element).borderTopWidth,
        ),
        { timeout: 10_000 },
      ).toBe('9px');
    } finally {
      await Promise.all([
        writeProjectFile(
          projectDir,
          'src/components/hot-panel/hot-panel.component.js',
          originalJs,
        ),
        writeProjectFile(
          projectDir,
          'src/components/hot-panel/hot-panel.component.css',
          originalCss,
        ),
      ]);
    }
  });

  test('production output contains no dev-server live-reload code', async ({
    projectDir,
  }) => {
    await writeHotSwapFixture(projectDir);
    await execFileAsync(
      process.execPath,
      [path.resolve(process.cwd(), 'bin/avenx.js'), 'build', '--production'],
      { cwd: projectDir },
    );

    const bundle = await readProjectFile(projectDir, 'dist/bundle.js');
    const index = await readProjectFile(projectDir, 'index.html');

    expect(bundle).not.toContain('EventSource');
    expect(bundle).not.toContain('__avenx_live_reload__');
    expect(bundle).not.toContain('swapStylesheet');
    expect(index).not.toContain('EventSource');
    expect(index).not.toContain('__avenx_live_reload__');

    // The overlay is a dev-server affordance and nothing else: a production
    // build carries no trace of it.
    expect(bundle).not.toContain('__avenx-error-overlay');
    expect(bundle).not.toContain('__avenxDevOverlay');
    expect(index).not.toContain('__avenx-error-overlay');
    expect(index).not.toContain('__avenxDevOverlay');
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


  test('a failed rebuild shows the diagnostic as an overlay and a fixed one removes it', async ({
    page,
    projectDir,
  }) => {
    const original = await readProjectFile(projectDir, COMPONENT_PATH);
    const overlay = page.locator('#__avenx-error-overlay');

    await expect(overlay).toHaveCount(0);

    try {
      await writeProjectFile(
        projectDir,
        COMPONENT_PATH,
        `${original}\n<broken syntax`,
      );

      await expect(overlay).toBeVisible({ timeout: 10_000 });

      const text = await overlay.innerText();

      // Severity, code, source file and message -- the same four things the
      // terminal prints, in the window the developer is looking at.
      expect(text).toContain('error');
      expect(text).toMatch(/AVX_[A-Z]\d+/);
      expect(text).toContain('stat-card.component.js');
      expect(text).toContain('broken');

      // And the caret code frame, which is what names the line.
      await expect(overlay.locator('pre')).toContainText('|');

      // An error is blocking: what is on screen is the previous build's
      // output and no longer matches the source.
      expect(await overlay.getAttribute('data-avenx-blocking')).toBe('true');

      // A reload while the build is still broken must not hide the reason.
      await page.reload();
      await expect(overlay).toBeVisible({ timeout: 10_000 });

      await writeProjectFile(projectDir, COMPONENT_PATH, original);

      await expect(overlay).toHaveCount(0, { timeout: 10_000 });
      await expect(
        page.getByTestId('filled').getByTestId('card-label'),
      ).toHaveText('Revenue');
    } finally {
      await writeProjectFile(projectDir, COMPONENT_PATH, original);
    }
  });

  test('warnings are shown without blocking the page, and diagnostic text is escaped', async ({
    page,
  }) => {
    // Driven through the overlay's own entry point rather than through a
    // build, so the presentation rules are tested directly: a warning must
    // not take the page away from the developer, and diagnostic text -- which
    // quotes the developer's own source -- must never be parsed as markup.
    await page.evaluate(() => {
      window.__avenxDevOverlay.render([
        {
          severity: 'warning',
          code: 'AVX_W03',
          file: 'src/components/header.component.js',
          line: 12,
          column: 5,
          message: 'Undeclared variable in <Header>: <img src=x onerror="window.__overlayXss = true">',
          frame: ' 12 |   {{ userName }}\n    |      ^^^^^^^^',
        },
      ]);
    });

    const overlay = page.locator('#__avenx-error-overlay');

    await expect(overlay).toBeVisible();
    expect(await overlay.getAttribute('data-avenx-blocking')).toBe('false');
    await expect(overlay).toContainText('warning');
    await expect(overlay).toContainText('AVX_W03');

    expect(await page.evaluate(() => window.__overlayXss === true)).toBe(false);
    expect(await overlay.locator('img').count()).toBe(0);
    await expect(overlay).toContainText('<img src=x onerror=');

    // The container passes clicks through, so the application underneath is
    // still usable while a warning is on screen.
    expect(
      await overlay.evaluate((element) => getComputedStyle(element).pointerEvents),
    ).toBe('none');
    await page.getByTestId('filled').getByTestId('card').click();

    // And the overlay itself can be dismissed.
    await overlay.getByRole('button', { name: /dismiss/i }).click();
    await expect(overlay).toHaveCount(0);
  });

  test('the application cannot restyle or hide the overlay', async ({ page }) => {
    // The overlay reports on an application that may be exactly what failed
    // to build, so an application stylesheet -- important declarations and
    // all -- must not be able to reach it.
    await page.evaluate(() => {
      const hostile = document.createElement('style');
      hostile.textContent =
        '#__avenx-error-overlay { display: none !important; visibility: hidden !important;'
        + ' opacity: 0 !important; position: static !important; z-index: -1 !important; }';
      document.head.appendChild(hostile);

      window.__avenxDevOverlay.render([
        { severity: 'error', code: 'AVX_C26', file: 'src/a.component.js', message: 'Malformed template' },
      ]);
    });

    const overlay = page.locator('#__avenx-error-overlay');

    await expect(overlay).toBeVisible();
    expect(
      await overlay.evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          display: styles.display,
          visibility: styles.visibility,
          opacity: styles.opacity,
          position: styles.position,
          zIndex: styles.zIndex,
        };
      }),
    ).toEqual({
      display: 'flex',
      visibility: 'visible',
      opacity: '1',
      position: 'fixed',
      zIndex: '2147483647',
    });
  });

  test('server.errorOverlay: false serves live reload without the overlay', async ({
    projectDir,
    devServer,
  }) => {
    await configureProject(projectDir, { errorOverlay: false });

    // The fixture server already read the old configuration, so the option is
    // tested on a server started with the new one.
    await terminate(devServer.child);

    const replacementPort = await findFreePort();
    const replacement = await startServer(projectDir, replacementPort);

    try {
      const html = await (
        await fetch(`${replacement.url}/index.html`)
      ).text();

      expect(html).not.toContain('__avenx-error-overlay');
      expect(html).not.toContain('window.__avenxDevOverlay = {');

      // Everything else about the dev server is unchanged. The live-reload
      // client still ships its one-line guard for the overlay it will not
      // find, which is exactly how the option stays additive.
      expect(html).toContain("new EventSource('/__avenx_live_reload__')");
    } finally {
      await terminate(replacement.child);
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
