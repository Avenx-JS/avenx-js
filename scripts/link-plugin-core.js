/**
 * @file link-plugin-core.js
 * @description Makes `avenx-core` resolvable from the plugins in this checkout.
 *
 * The official plugins import `avenx-core/runtime` and `avenx-core/integration`,
 * exactly as they do once published. Inside the repository the nearest
 * `package.json` to a plugin source is the plugin's own, and nothing installs
 * `avenx-core` beneath it, so those specifiers would not resolve.
 *
 * They used to fall back to `../../../lib/...` instead. That path exists only in
 * a checkout: in an installed package it points outside `node_modules`, Vite
 * refuses to bundle it, and `@avenx/vite` imported the compiler that way with no
 * fallback at all. Linking `plugins/node_modules/avenx-core` to this checkout
 * lets the published source and the tested source be the same file.
 *
 * Node resolves the link to its real path, so a test that imports
 * `lib/compiler/ComponentParser.js` directly and a plugin that imports it
 * through `avenx-core/integration` share one module instance.
 *
 * Run by the root `prepare`, `pretest` and `test:plugins` scripts and by each
 * plugin's `pretest`. Safe to run repeatedly. A directory junction on Windows,
 * which needs no elevated rights; a symlink elsewhere.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');
const linkPath = path.join(pluginsDir, 'node_modules', 'avenx-core');

/**
 * Whether the link already points at this checkout.
 * @returns {boolean} True when nothing needs doing.
 */
function isLinked() {
  try {
    return fs.realpathSync(linkPath) === fs.realpathSync(rootDir);
  } catch {
    return false;
  }
}

// A git install or a partial checkout may have no plugins to link.
if (fs.existsSync(pluginsDir) && !isLinked()) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // A stale link or a directory left by an earlier install would shadow the
  // checkout; replace it. A link (Node reports a junction as one) is unlinked,
  // never recursed into, so its target is untouched.
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
    else fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // Nothing there.
  }
  fs.symlinkSync(rootDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}
