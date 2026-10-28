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
 *
 * `documentsKnownGaps` marks an app that is expected not to work, because it
 * exists to pin a framework bug. Those are excluded from the smoke boot loop,
 * which would otherwise report a failure the suite already documents on
 * purpose.
 *
 * `headers` are response headers the server adds to every file under the app.
 * Only the CSP fixture needs any: its whole point is to be served under a
 * policy that forbids `'unsafe-eval'`, which cannot be expressed in the page
 * itself -- a `<meta>` CSP is weaker than a header and is not what a
 * deployment uses.
 * @type {Array<{name: string, summary: string, developmentBuild?: boolean, documentsKnownGaps?: boolean, headers?: Object<string, string>}>}
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
  {
    name: 'routing',
    summary: 'Hash routes, params, query strings, the wildcard fallback and a bridge-backed guard.',
  },
  {
    name: 'forms',
    summary: 'Two-way binding across every input type, and focus retention across patches.',
  },
  {
    name: 'defer',
    summary: 'The <@defer> tag and its interaction, idle, timer and visible triggers.',
  },
  {
    name: 'transitions',
    summary: 'Enter and leave transitions, duration detection, rapid toggle cleanup and list transitions.',
  },
  {
    name: 'fallback',
    summary: 'Constructs the IR refuses -- <@suspense>, <@errorBoundary>, <@deadlock> -- beside a compiled parent.',
    developmentBuild: true,
  },
  {
    name: 'browser-apis',
    summary: 'Browser APIs used from <resource> and <action> bodies: fetch, timers, window listeners, requestAnimationFrame.',
  },
  {
    name: 'security',
    summary: 'srcdoc and event-handler attributes: injection is neutralised, trusted opt-in works.',
  },
  {
    name: 'csp',
    summary: 'Built with csp.strict and served under script-src \'self\': every expression kind, with no \'unsafe-eval\'.',
    // Both bundles are driven under the policy. The production one is the
    // claim the framework already made; the development one is what the
    // option adds, and is therefore the half of this fixture that is new.
    developmentBuild: true,
    headers: {
      // Deliberately the policy a security review asks for, not a minimal one.
      // `script-src 'self'` is what forbids eval and the Function
      // constructor. The style relaxation is required and documented: a
      // component stylesheet is mounted as a <style> element the runtime
      // creates, and the alternative is a per-response nonce, which a static
      // file server cannot issue.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; '),
    },
  },
  {
    name: 'guard-gaps',
    summary: 'Pins two guard compilation bugs; its bundle is expected not to parse.',
    documentsKnownGaps: true,
  },
];

/**
 * The fixture applications that are expected to work.
 *
 * Used by the smoke boot loop, which should not report failures the suite
 * already documents deliberately.
 * @returns {Array<{name: string, summary: string}>} Healthy applications.
 */
export function workingApps() {
  return APPS.filter((app) => !app.documentsKnownGaps);
}

/**
 * The response headers a fixture application is served with.
 *
 * Matched on the first path segment, which is how the server maps a request to
 * an app. An unknown segment gets no headers rather than an error: the server
 * answers those with a 404 anyway.
 * @param {string} pathname - The decoded request path.
 * @returns {Object<string, string>} Headers to add, possibly empty.
 */
export function headersFor(pathname) {
  const segment = pathname.replace(/^\/+/, '').split('/')[0];
  const app = APPS.find((entry) => entry.name === segment);
  return (app && app.headers) || {};
}

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
