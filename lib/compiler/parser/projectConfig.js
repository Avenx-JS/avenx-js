/**
 * @file projectConfig.js
 * @description Resolves the `avenx.config.json` that governs a component file.
 *
 * Shared by the parser and the template passes it delegates to: each of them
 * resolves the project configuration and the effective void-tag list for the
 * file being compiled, and all of them must read the same cache so a broken
 * config file is reported once rather than once per pass.
 */
import fs from 'fs';
import path from 'path';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { BuildError } from '../errors/index.js';
import { reportWarning } from '../utils/warningReporter.js';

/**
 * Cache of resolved `avenx.config.json` contents, keyed by the directory
 * the search started from, so each component file doesn't re-read and
 * re-parse the config from disk.
 * @type {Map<string, object|null>}
 */
const configCache = new Map();

/**
 * Walks up the directory tree from `startDir` looking for an
 * `avenx.config.json` file, and returns its parsed contents (or `null` if
 * none is found, or if it fails to parse).
 * @param {string} startDir - Absolute directory to start searching from.
 * @returns {object|null}
 */
export function loadAvenxConfig(startDir) {
  if (configCache.has(startDir)) {
    return configCache.get(startDir);
  }

  let config = null;
  let currentDir = startDir;
  while (currentDir) {
    const configPath = path.join(currentDir, 'avenx.config.json');
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (err) {
        reportWarning(
          AvenxErrorCodes.COMPILER_INVALID_CONFIG,
          new BuildError(AvenxErrorCodes.COMPILER_INVALID_CONFIG, configPath, err.message),
        );
        config = null;
      }
      break;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  configCache.set(startDir, config);
  return config;
}

/**
 * Resolves the list of project-specific void tags declared in
 * `avenx.config.json` (via a `voidTags` array) for the given component
 * file, e.g.:
 * ```json
 * { "voidTags": ["my-video", "my-icon"] }
 * ```
 * @param {string} [filePath] - Absolute path of the component file being compiled.
 * @returns {string[]} Lowercased, trimmed custom void tag names. Empty if none configured.
 */
export function getCustomVoidTags(filePath) {
  if (!filePath) {
    return [];
  }
  const startDir = path.resolve(path.dirname(filePath));
  const config = loadAvenxConfig(startDir);
  if (!config || !Array.isArray(config.voidTags)) {
    return [];
  }
  return config.voidTags
    .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
    .map((tag) => tag.trim().toLowerCase());
}
