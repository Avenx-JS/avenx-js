/**
 * Playwright global setup: compiles every fixture application with the real CLI.
 *
 * This is the step that makes the suite an Avenx E2E suite rather than a
 * browser test that happens to live in this repository. Each app goes through
 * `bin/avenx.js build` -- the same entry point a user runs -- and the tests only
 * ever load the `dist/` output that produces. A compiler regression therefore
 * fails the whole run here, loudly and with the compiler's own diagnostics,
 * instead of surfacing later as a confusing locator timeout.
 * @module test/e2e/support/build-apps
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { APPS, APPS_DIR, REPO_ROOT } from './apps.js';

const CLI = path.join(REPO_ROOT, 'bin', 'avenx.js');
const RUNTIME_BUILD = path.join(REPO_ROOT, 'scripts', 'build.js');

/**
 * Runs a Node script and returns its result, with output captured for reporting.
 * @param {string} script - Absolute path to the script to run.
 * @param {string[]} args - Arguments passed to the script.
 * @param {string} cwd - Working directory for the child process.
 * @returns {{status: number|null, output: string}} Exit status and combined output.
 */
function run(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return { status: result.status, output };
}

/**
 * Fails the run with the child process output attached.
 *
 * Playwright truncates nothing thrown from global setup, so the compiler's
 * diagnostics reach the developer intact -- which is the whole point of failing
 * here rather than letting a half-built app reach the browser.
 * @param {string} headline - What could not be done.
 * @param {string} output - Captured child process output.
 * @throws {Error} Always.
 */
function fail(headline, output) {
  throw new Error(`${headline}\n\n${output || '(no output)'}\n`);
}

/**
 * Rebuilds the browser runtime bundles the compiler embeds.
 *
 * Always, not only when the files are missing. The previous suite rebuilt only
 * when `dist/runtime.js` was absent, so a stale runtime from an earlier checkout
 * was silently tested against current specs.
 * @returns {void}
 */
function buildRuntime() {
  const { status, output } = run(RUNTIME_BUILD, [], REPO_ROOT);
  if (status !== 0) {
    fail('E2E setup: the Avenx runtime bundles failed to build.', output);
  }
}

/**
 * Compiles one fixture application into the given output directory.
 *
 * The compiler always emits into the app's configured `distDir`, so a
 * development build is produced first and moved aside before the production
 * build overwrites it.
 * @param {{name: string, developmentBuild?: boolean}} app - The app to compile.
 * @returns {void}
 */
function buildApp(app) {
  const appDir = path.join(APPS_DIR, app.name);
  const dist = path.join(appDir, 'dist');
  const distDev = path.join(appDir, 'dist-dev');

  if (!fs.existsSync(path.join(appDir, 'avenx.config.json'))) {
    throw new Error(`E2E setup: fixture app "${app.name}" has no avenx.config.json at ${appDir}.`);
  }

  fs.rmSync(dist, { recursive: true, force: true });
  fs.rmSync(distDev, { recursive: true, force: true });

  if (app.developmentBuild) {
    const dev = run(CLI, ['build', '--dev'], appDir);
    if (dev.status !== 0) {
      fail(`E2E setup: development build of fixture app "${app.name}" failed.`, dev.output);
    }
    fs.renameSync(dist, distDev);
  }

  const prod = run(CLI, ['build'], appDir);
  if (prod.status !== 0) {
    fail(`E2E setup: build of fixture app "${app.name}" failed.`, prod.output);
  }

  const bundle = path.join(dist, 'bundle.js');
  if (!fs.existsSync(bundle)) {
    fail(`E2E setup: fixture app "${app.name}" reported success but emitted no bundle.js.`, prod.output);
  }
}

/**
 * Compiles the runtime and every fixture application.
 * @returns {Promise<void>}
 */
export default async function globalSetup() {
  const started = Date.now();
  buildRuntime();

  for (const app of APPS) {
    buildApp(app);
  }

  const names = APPS.map((app) => app.name).join(', ');
  console.log(`[e2e] compiled ${APPS.length} fixture app(s) in ${Date.now() - started}ms: ${names}`);
}
