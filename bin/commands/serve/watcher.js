import fs from 'node:fs';
import path from 'node:path';
import { runBuildPass } from '../build.js';
import { reportRebuildFailure } from '../../fatal.js';
import { cyan, green, yellow } from '../../colors.js';
import { watchDirectories } from '../../utils.js';
import { getBundleHashes } from './static.js';
import { buildStatusFromPass, isErrorOverlayEnabled, overlayMessageFor } from './overlay/index.js';

/**
 * The project-root files the dev server actually depends on. Everything else
 * in the root is ignored by the watcher, so a log file, an editor backup or a
 * build artifact written there cannot reload the page -- and a server whose
 * output lands in the project directory cannot drive itself into a reload loop.
 * An allowlist, not a denylist: the next noisy filename is always one nobody
 * thought of in advance.
 */
const ROOT_RELOAD_FILES = new Set(['index.html']);
const ROOT_RESTART_FILES = new Set(['avenx.config.json', 'package.json']);

const isRootRestartFile = (filename) => ROOT_RESTART_FILES.has(filename) || /^\.env(?:\.|$)/.test(filename);

const isWatchedRootFile = (filename) => ROOT_RELOAD_FILES.has(filename) || isRootRestartFile(filename);

/**
 * Watches the src directory for changes and triggers a rebuild.
 * @param {object} cli
 */
export function watchProject(cli, formatSseMessage) {
  let timeout;
  let pendingChange = null;
  const baseDir = path.resolve(cli.baseDir);
  const srcPath = path.join(baseDir, cli.config.srcDir || 'src');
  const templateDirs = [cli.config.templatesDir || '.avenxtemplates', 'templates'];
  const sourceDirs = [srcPath, ...templateDirs.map((dir) => path.join(baseDir, dir))];
  const assetDirs = ['public', 'assets'].map((dir) => path.join(baseDir, dir));

  if (!fs.existsSync(srcPath)) return null;

  const snapshotDirectories = (directories) => {
    const snapshot = new Map();
    const visit = (directory) => {
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(entryPath, { bigint: true });
          snapshot.set(entryPath, `${stat.mtimeNs}:${stat.size}`);
        }
      }
    };

    directories.forEach(visit);
    return snapshot;
  };

  const snapshotRootFiles = () => {
    const snapshot = new Map();
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || !isWatchedRootFile(entry.name)) continue;
      const entryPath = path.join(baseDir, entry.name);
      const stat = fs.statSync(entryPath, { bigint: true });
      snapshot.set(entryPath, `${stat.mtimeNs}:${stat.size}`);
    }
    return snapshot;
  };

  const changedPaths = (previous, next) => {
    const candidates = new Set([...previous.keys(), ...next.keys()]);
    return [...candidates].filter((filePath) => previous.get(filePath) !== next.get(filePath));
  };

  let sourceSnapshot = snapshotDirectories(sourceDirs);
  let assetSnapshot = snapshotDirectories(assetDirs);
  let rootSnapshot = snapshotRootFiles();

  const sendEvent = (event) => {
    if (cli.liveReloadClients) {
      const frame = formatSseMessage(event);
      cli.liveReloadClients.forEach((client) => client.write(frame));
    }
  };

  // The overlay is driven by the last pass, and a client that connects later
  // -- a manual refresh while the build is broken -- is told about it then.
  const publishBuildStatus = (status) => {
    cli.buildStatus = status;
    if (!isErrorOverlayEnabled(cli)) {
      return;
    }
    const message = overlayMessageFor(status);
    // A clean build after a failure still has to clear the overlay, so the
    // `ok` message is sent even when it carries nothing.
    sendEvent(message || { type: 'ok', diagnostics: [] });
  };

  const scheduleChange = (kind, filename) => {
    if (!pendingChange || kind >= pendingChange.kind) {
      pendingChange = { kind, filename };
    }

    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const change = pendingChange;
      pendingChange = null;
      if (!change) return;

      if (change.kind === 3) {
        console.log(yellow(`\n⚠️ Change detected: ${change.filename}. Restart the dev server to load the new configuration.`));
        return;
      }

      if (change.kind === 1) {
        console.log(`\n${cyan(`📄 Change detected: ${change.filename}. Reloading...`)}`);
        sendEvent({ type: 'reload' });
        return;
      }

      console.log(`\n${cyan(`📄 Change detected: ${change.filename}. Rebuilding...`)}`);
      const startedAt = performance.now();
      const pass = runBuildPass(cli, { watch: true });
      const status = buildStatusFromPass(pass, baseDir);
      if (!pass.ok) {
        // A watch session keeps going: the next save usually fixes it. The
        // browser is not reloaded, so it keeps showing the last good build --
        // with the overlay on top of it, naming what broke.
        reportRebuildFailure(pass.error);
        publishBuildStatus(status);
        return;
      }

      console.log(green(`✅ Rebuilt in ${Math.round(performance.now() - startedAt)}ms`));
      publishBuildStatus(status);
      const previous = cli.liveReloadHashes;
      const next = getBundleHashes(cli);
      cli.liveReloadHashes = next;
      if (previous && previous.js === next.js && previous.css !== next.css) {
        sendEvent({ type: 'css' });
      } else {
        sendEvent({ type: 'reload' });
      }
    }, 100);
  };

  const refreshDirectorySnapshot = (directories, previous, kind) => {
    const next = snapshotDirectories(directories);
    for (const filePath of changedPaths(previous, next)) {
      scheduleChange(kind, path.relative(baseDir, filePath));
    }
    return next;
  };

  const refreshSourceSnapshot = () => {
    sourceSnapshot = refreshDirectorySnapshot(sourceDirs, sourceSnapshot, 2);
  };
  const refreshAssetSnapshot = () => {
    assetSnapshot = refreshDirectorySnapshot(assetDirs, assetSnapshot, 1);
  };
  const refreshRootSnapshot = () => {
    const next = snapshotRootFiles();
    for (const filePath of changedPaths(rootSnapshot, next)) {
      const filename = path.basename(filePath);
      scheduleChange(isRootRestartFile(filename) ? 3 : 1, filename);
    }
    rootSnapshot = next;
  };

  const watchers = [
    watchDirectories(sourceDirs, refreshSourceSnapshot),
    watchDirectories(assetDirs, refreshAssetSnapshot),
    fs.watch(baseDir, refreshRootSnapshot),
  ].filter(Boolean);

  const startupScan = setImmediate(() => {
    refreshSourceSnapshot();
    refreshAssetSnapshot();
    refreshRootSnapshot();
  });

  const watcher = {
    close() {
      clearTimeout(timeout);
      clearImmediate(startupScan);
      for (const activeWatcher of watchers) activeWatcher.close();
    },
  };

  if (cli) {
    cli._watcher = watcher;
  }
  return watcher;
}
