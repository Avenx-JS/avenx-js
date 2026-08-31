/**
 * @file store.js
 * @description On-disk storage for recorded traces.
 *
 * Traces live in `.avenx/traces/` under the project root, one JSON file per
 * recording. A plain directory of plain files is deliberate: a developer can
 * read one, diff two, attach one to an issue, or delete the lot, without a
 * database, an index file that can go stale, or a tool.
 *
 * Node-only, like everything else that touches the filesystem.
 * @module lib/core/trace/store
 */

import fs from 'fs';
import path from 'path';
import { validateTrace } from './schema.js';

/**
 * Where traces are kept, relative to the project root.
 * @type {string}
 */
export const TRACE_DIR = path.join('.avenx', 'traces');

/**
 * How many traces a project keeps before `prune` starts suggesting cleanup.
 * @type {number}
 */
export const DEFAULT_KEEP = 20;

/**
 * Resolves and creates the trace directory for a project.
 * @param {string} rootDir - The project root.
 * @returns {string} The absolute trace directory.
 */
export function traceDir(rootDir) {
  const dir = path.join(rootDir, TRACE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Rejects a trace id that could escape the trace directory.
 *
 * Ids arrive from the CLI and from the dev server's ingest endpoint, so they
 * are untrusted input on a path join.
 * @param {string} id - The candidate id.
 * @returns {boolean} Whether it is safe to use as a file name.
 */
export function isValidTraceId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/**
 * Writes a trace to disk.
 * @param {string} rootDir - The project root.
 * @param {object} trace - The trace to save.
 * @returns {string} The path written.
 * @throws {Error} When the trace has no usable id.
 */
export function saveTrace(rootDir, trace) {
  if (!isValidTraceId(trace && trace.id)) {
    throw new Error(`Refusing to save a trace with an unusable id: ${JSON.stringify(trace && trace.id)}`);
  }
  const filePath = path.join(traceDir(rootDir), `${trace.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(trace, null, 2));
  return filePath;
}

/**
 * Reads one trace.
 * @param {string} rootDir - The project root.
 * @param {string} id - The trace id, or `latest` for the newest.
 * @returns {{trace: object, path: string}|null} The trace, or null when absent.
 * @throws {Error} When the file exists but is not a readable trace.
 */
export function loadTrace(rootDir, id) {
  if (id === 'latest') {
    const all = listTraces(rootDir);
    if (all.length === 0) {
      return null;
    }
    return loadTrace(rootDir, all[0].id);
  }

  if (!isValidTraceId(id)) {
    return null;
  }

  const filePath = path.join(rootDir, TRACE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error.message}`, { cause: error });
  }

  const valid = validateTrace(parsed);
  if (!valid.ok) {
    throw new Error(`${filePath} cannot be read: ${valid.error}`);
  }

  return { trace: parsed, path: filePath };
}

/**
 * Lists stored traces, newest first.
 *
 * A file that cannot be parsed is listed with a `broken` flag rather than
 * skipped, so a corrupted recording is visible and can be pruned rather than
 * silently disappearing from the listing.
 * @param {string} rootDir - The project root.
 * @returns {Array<object>} Summaries, newest first.
 */
export function listTraces(rootDir) {
  const dir = path.join(rootDir, TRACE_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(dir, name);
    const stat = fs.statSync(filePath);
    try {
      const trace = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      entries.push({
        id: trace.id || path.basename(name, '.json'),
        path: filePath,
        mtime: stat.mtimeMs,
        size: stat.size,
        trace,
        broken: !validateTrace(trace).ok,
      });
    } catch {
      entries.push({
        id: path.basename(name, '.json'),
        path: filePath,
        mtime: stat.mtimeMs,
        size: stat.size,
        trace: null,
        broken: true,
      });
    }
  }

  entries.sort((a, b) => {
    if (b.mtime !== a.mtime) {
      return b.mtime - a.mtime;
    }
    const bCreated = b.trace && b.trace.createdAt ? Date.parse(b.trace.createdAt) || 0 : 0;
    const aCreated = a.trace && a.trace.createdAt ? Date.parse(a.trace.createdAt) || 0 : 0;
    if (bCreated !== aCreated) {
      return bCreated - aCreated;
    }
    return b.id.localeCompare(a.id);
  });
  return entries;
}

/**
 * Deletes stored traces.
 * @param {string} rootDir - The project root.
 * @param {object} [options] - What to remove.
 * @param {number} [options.keep] - Keep this many of the newest.
 * @param {boolean} [options.all] - Remove everything.
 * @param {string} [options.id] - Remove one trace.
 * @returns {string[]} The ids removed.
 */
export function pruneTraces(rootDir, options = {}) {
  const entries = listTraces(rootDir);
  let doomed;

  if (options.id) {
    doomed = entries.filter((entry) => entry.id === options.id);
  } else if (options.all) {
    doomed = entries;
  } else {
    const keep = typeof options.keep === 'number' ? options.keep : DEFAULT_KEEP;
    doomed = entries.slice(keep);
  }

  const removed = [];
  for (const entry of doomed) {
    try {
      fs.unlinkSync(entry.path);
      removed.push(entry.id);
    } catch {
      // A trace that cannot be removed is not worth failing a cleanup over.
    }
  }
  return removed;
}
