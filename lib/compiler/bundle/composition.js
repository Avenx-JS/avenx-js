import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AVENX_PACKAGE_ROOT } from '../../bundler/resolve.js';

// This vocabulary belongs to the compiler, not the general-purpose bundler.
const CAPABILITIES = new Map([
  ['router', 'lib/core/runtime/AvenxRouter.js'],
  ['rewind journal', 'lib/core/reactive/journal.js'],
  ['resource', 'lib/core/reactive/Resource.js'],
  ['tracer', 'lib/core/trace/tracer.js'],
  ['trace recorder', 'lib/core/trace/recorder.js'],
  ['expression interpreter', 'lib/core/expression/interpreter.js'],
  ['string renderer', 'lib/core/renderer/installStringRenderer.js'],
  ['virtual list', 'lib/core/runtime/installVirtualList.js'],
]);

/**
 * Hashes the artifact so stats never describes an unrelated or replaced file.
 * @param {string|Buffer} code - Bundle contents.
 * @returns {string} SHA-256 hex digest.
 */
export function bundleHash(code) {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Makes a portable label and a non-overlapping directory roll-up.
 * @param {string} id - Resolved module id.
 * @param {string} rootDir - Application root.
 * @returns {{file: string, directory: string}} Display names.
 */
function describeModule(id, rootDir) {
  const core = path.relative(AVENX_PACKAGE_ROOT, id).split(path.sep).join('/');
  if (core.startsWith('lib/')) return { file: core, directory: path.posix.dirname(core) };
  const relative = path.relative(rootDir, id).split(path.sep).join('/');
  const dependency = relative.lastIndexOf('node_modules/');
  if (dependency >= 0) {
    const file = relative.slice(dependency);
    return { file, directory: path.posix.dirname(file) };
  }
  return { file: relative || id, directory: 'Application code' };
}

/**
 * Describes the main JavaScript artifact from the graph and emitted ranges.
 * Common prelude, hoists, footer and source-map trailer are explicit overhead,
 * so both the module rows and the directory roll-up sum to the actual file.
 * @param {object} result - Bundler result, with moduleSizes and graph counts.
 * @param {object} options - Artifact metadata.
 * @param {string} options.code - Exact contents written to disk.
 * @param {string} options.rootDir - Application root.
 * @param {string} options.file - Main artifact name.
 * @param {string} options.mode - Resolved build mode.
 * @returns {object} Serializable composition sidecar.
 */
export function buildComposition(result, { code, rootDir, file, mode }) {
  const bytes = Buffer.byteLength(code, 'utf8');
  const share = (size) => bytes ? size / bytes * 100 : 0;
  const modules = result.moduleSizes.map(({ id, bytes: size }) => ({
    ...describeModule(id, rootDir), bytes: size, share: share(size),
  }));
  modules.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
  const overheadBytes = bytes - modules.reduce((sum, item) => sum + item.bytes, 0);
  const groups = new Map();
  for (const item of modules) groups.set(item.directory, (groups.get(item.directory) || 0) + item.bytes);
  const directories = [...groups].map(([directory, size]) => ({ directory, bytes: size, share: share(size) }));
  directories.sort((a, b) => b.bytes - a.bytes || a.directory.localeCompare(b.directory));
  const linked = new Set(modules.map((item) => item.file));
  return {
    version: 1, file, mode, sha256: bundleHash(code), bytes, gzipBytes: gzipSync(code).length,
    modules, directories,
    overhead: { bytes: overheadBytes, share: share(overheadBytes) },
    capabilities: [...CAPABILITIES].filter(([, module]) => linked.has(module)).map(([name]) => name),
    modulesInGraph: result.stats.modulesInGraph,
    modulesEmitted: result.stats.modulesEmitted,
    modulesShaken: result.stats.modulesShaken,
  };
}
