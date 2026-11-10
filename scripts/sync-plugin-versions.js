/**
 * @file sync-plugin-versions.js
 * @description Keeps the official plugins on the core package's version.
 *
 * The plugins are versioned in lockstep with `avenx-core`: every plugin carries
 * the core version, and requires `avenx-core` `^` that version as a peer. They
 * are built against the core in the same tree -- `@avenx/vite` imports compiler
 * internals through `avenx-core/integration` -- so a plugin published from this
 * tree is only known to work with the core published from it, and a separate
 * version line would make every peer range a guess.
 *
 * Run by the root `version` script, so `npm version <bump>` moves every plugin
 * with the core and stages the result in the same commit.
 * `test/system/packageIntegrity.test.js` fails when the two drift.
 *
 *     node scripts/sync-plugin-versions.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The published plugin directories, relative to the repository root. */
export const PLUGIN_DIRS = [
  'plugins/avenx-i18n',
  'plugins/avenx-persistence',
  'plugins/avenx-charts',
  'plugins/avenx-vite',
];

/**
 * The peer range a plugin at this core version declares.
 * @param {string} version - The core version.
 * @returns {string} The range.
 */
export function corePeerRange(version) {
  return `^${version}`;
}

/**
 * Reads, transforms and writes a JSON file, keeping its line endings.
 * @param {string} file - Absolute path.
 * @param {function(object): void} edit - Mutates the parsed value.
 */
function editJson(file, edit) {
  const source = fs.readFileSync(file, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const value = JSON.parse(source);
  edit(value);
  fs.writeFileSync(file, JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol);
}

/**
 * Sets every plugin's version and core peer range from the root manifest.
 */
function sync() {
  const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  for (const dir of PLUGIN_DIRS) {
    const manifestPath = path.join(rootDir, dir, 'package.json');
    let manifest;
    editJson(manifestPath, (pkg) => {
      pkg.version = version;
      pkg.peerDependencies = { ...pkg.peerDependencies, 'avenx-core': corePeerRange(version) };
      manifest = pkg;
    });

    // A lockfile records the root package's version and peers too; npm
    // rewrites it on the next install anyway, but a stale one reads as drift.
    const lockPath = path.join(rootDir, dir, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      editJson(lockPath, (lock) => {
        lock.version = version;
        if (lock.packages && lock.packages['']) {
          lock.packages[''].version = version;
          lock.packages[''].peerDependencies = manifest.peerDependencies;
        }
      });
    }
    console.log(`${manifest.name}@${version} (peer avenx-core ${corePeerRange(version)})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sync();
}
