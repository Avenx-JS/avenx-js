import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Avenx E2E suite.
 *
 * The suite drives real Avenx applications: `test/e2e/support/build-apps.js`
 * compiles every fixture app under `test/e2e/apps` with the actual CLI before
 * any test runs, and the specs load only that compiled output. A test that can
 * pass without the compiler and runtime executing does not belong here.
 *
 * Browser strategy is deliberately asymmetric. Chromium gates every pull
 * request, because that is where a framework regression shows up first and the
 * feedback needs to be fast. Firefox and WebKit run on a nightly schedule via
 * `E2E_ALL_BROWSERS=1`, where the cost of a three-way fan-out is worth paying
 * for genuine engine differences.
 */
const allBrowsers = !!process.env.E2E_ALL_BROWSERS;
const port = Number(process.env.E2E_PORT) || 3100;

export default defineConfig({
  testDir: './test/e2e/specs',
  testMatch: '**/*.spec.js',
  globalSetup: './test/e2e/support/build-apps.js',

  timeout: 30_000,
  expect: { timeout: 5_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A retry that turns a red run green hides flake. The suite is built to be
  // deterministic, so one retry exists only to absorb infrastructure noise in
  // CI, and a test that needs it should be investigated rather than accepted.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },

  projects: allBrowsers
    ? [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ]
    : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'node test/e2e/support/server.js',
    url: `http://localhost:${port}/health`,
    // Never reuse: a server left over from an earlier checkout would serve
    // stale bundles that the global setup has just replaced on disk.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
