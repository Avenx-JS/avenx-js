import fs from 'node:fs';
import path from 'node:path';

const client = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^(?=.)/gm, '    ');
const script = '\n<script>\n' + client + '</script>\n';

/** Returns the independent diagnostic client loaded at startup. */
export function getErrorOverlayScript() {
  return script;
}

/**
 * The most diagnostics one overlay message carries.
 *
 * One broken save can produce hundreds of warnings, and the channel is an SSE
 * frame on a developer's machine, not a report. The first few are the ones
 * worth reading; the terminal keeps the rest.
 * @type {number}
 */
const MAX_OVERLAY_DIAGNOSTICS = 50;

/**
 * Whether the browser error overlay is active for this dev server.
 *
 * The overlay is delivered over the live-reload channel and rendered by the
 * snippet injected next to the live-reload client, so live reload is a
 * precondition: with `--no-live-reload` there is neither a channel nor a
 * client. `server.errorOverlay` then decides, and a production build never
 * reaches this code at all.
 * @param {object} cli
 * @returns {boolean}
 */
export function isErrorOverlayEnabled(cli) {
  const server = (cli && cli.config && cli.config.server) || {};
  return Boolean(server.liveReload) && server.errorOverlay !== false;
}

/**
 * Rewrites an absolute diagnostic path as a project-relative one.
 *
 * The compiler reports the path it compiled, which is absolute and on a
 * developer's machine is mostly the length of their home directory. The
 * overlay has one narrow column for it, and `src/components/card.component.js`
 * is what the developer recognises. A path outside the project is left alone.
 * @param {string|null} file - The diagnostic's file, as reported.
 * @param {string} [baseDir] - The project root.
 * @returns {string|null} The display path.
 */
export function relativeDiagnosticPath(file, baseDir) {
  if (typeof file !== 'string' || file === '' || !baseDir || !path.isAbsolute(file)) {
    return file || null;
  }
  const relative = path.relative(path.resolve(baseDir), file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return file;
  }
  return relative.split(path.sep).join('/');
}

/**
 * Turns the result of one compile pass into the overlay's view of the build.
 *
 * On failure the overlay shows everything, because the warning next to the
 * error is often what explains it. On success only warnings remain, and an
 * empty list is what clears a previously shown overlay.
 * @param {{ok: boolean, diagnostics: object[]}} pass - A {@link runBuildPass} result.
 * @param {string} [baseDir] - The project root, for shortening file paths.
 * @returns {{ok: boolean, diagnostics: object[]}} The status to broadcast.
 */
export function buildStatusFromPass(pass, baseDir) {
  const all = (pass && Array.isArray(pass.diagnostics) ? pass.diagnostics : []).filter(Boolean);
  const ok = Boolean(pass && pass.ok);
  const relevant = ok ? all.filter((diagnostic) => diagnostic.severity !== 'error') : all;
  return {
    ok,
    diagnostics: relevant.slice(0, MAX_OVERLAY_DIAGNOSTICS).map((diagnostic) => ({
      ...diagnostic,
      file: relativeDiagnosticPath(diagnostic.file, baseDir),
    })),
  };
}

/**
 * The overlay message for a build status, or null when there is nothing to say.
 * @param {{ok: boolean, diagnostics: object[]}} [status] - A {@link buildStatusFromPass} result.
 * @returns {{type: string, diagnostics: object[]}|null}
 */
export function overlayMessageFor(status) {
  if (!status) {
    return null;
  }
  if (status.ok && status.diagnostics.length === 0) {
    // Nothing to report. The `ok` message is still worth sending after a
    // failure -- it is what removes the overlay -- so the caller decides;
    // a client that has just connected has no overlay to remove.
    return null;
  }
  return { type: status.ok ? 'ok' : 'error', diagnostics: status.diagnostics };
}
