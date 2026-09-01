/**
 * @file devtools.js
 * @description The browser side of `avenx serve --trace`.
 *
 * Recording is off unless a developer asks for it. The dev server injects one
 * call to {@link installTraceRecorder} when `--trace` is passed, and nothing in
 * this module runs otherwise — no listeners, no timers, no globals.
 *
 * What it adds is the smallest thing that closes the loop: start recording,
 * let the developer reproduce the bug, then send the trace to the dev server so
 * `avenx trace list` can see it. Everything after that happens in the terminal,
 * where the rest of Avenx's tooling already lives.
 * @module lib/core/trace/devtools
 */

import { startRecording, stopRecording, activeRecorder } from './recorder.js';
import { installRecordingGlobals, clearGlobalOverrides } from './globals.js';
import { tracer } from './tracer.js';

/**
 * Where a recording is posted when the developer saves it.
 * @type {string}
 */
export const TRACE_ENDPOINT = '/__avenx/trace';

/**
 * The control surface published on `window.avenxTrace` while recording.
 * @type {object|null}
 */
let controller = null;

/**
 * Starts recording in a browser and publishes a small control surface.
 *
 * The recorder is armed after the current task rather than immediately, so the
 * application's initial mount is treated as setup rather than as a session of
 * unexplained state writes.
 * @param {object} [options] - Recorder options.
 * @param {string} [options.endpoint] - Where `save()` posts the trace.
 * @param {string[]} [options.redact] - Property paths to withhold.
 * @param {number} [options.maxNodes] - Ring-buffer capacity.
 * @param {boolean} [options.autoSave] - Save automatically on page hide.
 * @returns {object} The control surface, also published as `window.avenxTrace`.
 */
export function installTraceRecorder(options = {}) {
  if (controller) {
    return controller;
  }

  const endpoint = options.endpoint || TRACE_ENDPOINT;
  const recorder = startRecording({
    redact: options.redact || [],
    maxNodes: options.maxNodes,
    meta: {
      url: typeof location !== 'undefined' ? location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    },
  });

  installRecordingGlobals(recorder);

  // Mount happens synchronously after this call, so arming is deferred to the
  // next macrotask. Writes made while a component builds itself are the app
  // starting up, not a user interaction the trace can attribute.
  setTimeout(() => {
    if (activeRecorder() === recorder) {
      recorder.arm();
    }
  }, 0);

  /**
   * Posts the current trace to the dev server.
   * @returns {Promise<object>} `{ok, id}` or `{ok: false, error}`.
   */
  const save = async () => {
    const current = activeRecorder();
    if (!current) {
      return { ok: false, error: 'Recording has already stopped.' };
    }
    const trace = current.toJSON();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trace),
      });
      if (!response.ok) {
        return { ok: false, error: `Dev server responded ${response.status}` };
      }
      console.info(
        `[Avenx] Saved ${trace.id} (${trace.nodes.length} nodes, ${trace.determinism.status}).\n` +
          `        avenx trace view ${trace.id}\n` +
          `        avenx trace export ${trace.id}`,
      );
      return { ok: true, id: trace.id };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  };

  controller = {
    /** The id this recording will be saved under. */
    get id() {
      return recorder.id;
    },
    /** How many nodes have been recorded so far. */
    get size() {
      return recorder.nodes.length;
    },
    /** Whether the recording is still believed replayable. */
    get deterministic() {
      return recorder.isDeterministic;
    },
    save,
    /** The trace as it stands, without saving it. */
    snapshot: () => recorder.toJSON(),
    /** Stops recording and restores the real globals. */
    stop: () => {
      clearGlobalOverrides();
      controller = null;
      return stopRecording();
    },
  };

  if (typeof window !== 'undefined') {
    window.avenxTrace = controller;

    if (options.autoSave !== false && typeof document !== 'undefined') {
      // `pagehide` rather than `beforeunload`: it fires for back/forward cache
      // navigations too, which is exactly when a developer has finished
      // reproducing something and clicked away.
      window.addEventListener('pagehide', () => {
        if (activeRecorder() === recorder && recorder.nodes.length > 0) {
          // A keepalive beacon, because a normal fetch is cancelled on unload.
          try {
            const body = JSON.stringify(recorder.toJSON());
            if (navigator.sendBeacon) {
              navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
            }
          } catch {
            // Losing a trace on unload is not worth breaking navigation over.
          }
        }
      });
    }

    console.info(
      `[Avenx] Recording trace ${recorder.id}. Reproduce the behaviour, then run:\n` +
        '        await avenxTrace.save()\n' +
        '        (or just navigate away — the trace is sent automatically)',
    );
  }

  return controller;
}

/**
 * Stops any recording this module started.
 * @returns {object|null} The finished trace.
 */
export function uninstallTraceRecorder() {
  if (!controller) {
    return null;
  }
  return controller.stop();
}

/**
 * Whether a browser recording is currently running.
 * @returns {boolean}
 */
export function isRecording() {
  return controller !== null && tracer.on;
}
