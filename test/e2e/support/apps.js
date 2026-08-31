/**
 * The fixture applications the E2E suite compiles and drives.
 *
 * Each entry is a real Avenx project under `test/e2e/apps/<name>/`: an
 * `avenx.config.json`, an `index.html` that loads nothing but the compiled
 * bundle, and a `src/` tree authored in the same syntax a user writes. Nothing
 * in an app hand-writes DOM, so a spec cannot observe anything unless the
 * compiler and the runtime both did their job.
 *
 * Apps are split by feature cluster rather than by spec file. One app may back
 * several specs, but an app should stay small enough that a failure points at
 * one area of the framework.
 * @module test/e2e/support/apps
 */

import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the repository root.
 * @type {string}
 */
export const REPO_ROOT = path.resolve(here, '../../..');

/**
 * Absolute path to the directory holding every fixture application.
 * @type {string}
 */
export const APPS_DIR = path.resolve(here, '../apps');

/**
 * Every fixture application, in build order.
 *
 * `developmentBuild` asks the global setup for a second compilation against the
 * unminified runtime, emitted to `dist-dev/`. Only the app used by the
 * production-parity spec needs one; the extra build is not free, so it is opt-in.
 * @type {Array<{name: string, summary: string, developmentBuild?: boolean}>}
 */
export const APPS = [
  {
    name: 'counter',
    summary: 'State, computed values, actions and bound boolean attributes.',
    developmentBuild: true,
  },
  {
    name: 'rendering',
    summary: 'Interpolation, escaping, conditional visibility and keyed lists.',
  },
  {
    name: 'components',
    summary: 'Component nesting, props from parent state, and slot projection.',
  },
  {
    name: 'events',
    summary: 'Event bindings and the .prevent, .stop, .self, .once and key modifiers.',
  },
  {
    name: 'styling',
    summary: 'Scoped CSS, per-component isolation, @def globals and style bindings.',
  },
];

/**
 * Builds the URL for a fixture application page.
 *
 * The E2E server roots itself at the apps directory, so an application is
 * reached at `/<name>/<file>` and its bundle at `/<name>/dist/bundle.js`.
 * @param {string} name - The application name.
 * @param {string} [file] - The HTML entry point to load.
 * @returns {string} A server-relative URL.
 */
export function appUrl(name, file = 'index.html') {
  return `/${name}/${file}`;
}
