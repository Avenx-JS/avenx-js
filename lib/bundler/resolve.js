/**
 * @file resolve.js
 * @description Turns an import specifier into a module the bundler can read.
 *
 * ## What this replaces
 *
 * There was no module resolution. `rewriteRuntimeImports` matched the runtime
 * entry and deleted everything else, so `import { format } from 'date-fns'` in
 * a component became nothing at all — a green build and a `ReferenceError` the
 * first time the action ran. Resolution is the difference between a build that
 * knows what an application depends on and one that guesses.
 *
 * ## The rules, in order
 *
 * 1. **Virtual modules.** The compiler owns component, page and entry
 *    generation, and hands those in as sources rather than files. They resolve
 *    by id and win over anything on disk.
 * 2. **Relative and absolute paths.** Probed for an exact file, then for the
 *    Avenx and JavaScript extensions, then for a directory index. A specifier
 *    that names a `.component.js` or `.page.js` resolves to the *compiled*
 *    virtual module, never to the raw template file — the raw file is not
 *    JavaScript and would not parse.
 * 3. **Node builtins.** Rejected, by name, with the reason. A browser bundle
 *    that quietly contains `fs` is a bundle that fails at load; saying so at
 *    build time is the whole point.
 * 4. **Bare specifiers.** The Node algorithm, walking `node_modules` upward
 *    from the importing file, honouring `exports`, `browser`, `module` and
 *    `main` in that order of preference for a browser target.
 *
 * Nothing here falls back to "skip it". A specifier that cannot be resolved is
 * a {@link ResolveError}, and the build fails with the importer and the
 * specifier — because the alternative is what this file exists to end.
 * @module lib/bundler/resolve
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The root of the installed `avenx-core` package, derived from this file.
 * @type {string}
 */
export const AVENX_PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Specifiers that mean "the Avenx browser runtime".
 *
 * The compiler has always accepted all three spellings, and a deep path into
 * `lib/core` besides, so resolution accepts exactly what the old rewriter did.
 * @type {RegExp}
 */
const RUNTIME_SPECIFIER = /^(avenx-core(\/(runtime|core))?)$/;

/**
 * Node builtin modules, with and without the `node:` prefix.
 *
 * Listed rather than probed, because the answer must not depend on which Node
 * version is running the build: an application importing `fs` is broken in a
 * browser on every version, and the diagnostic should say so identically.
 * @type {Set<string>}
 */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * Extensions probed for a path specifier that names no file directly.
 * @type {string[]}
 */
const EXTENSIONS = ['.js', '.mjs', '.component.js', '.page.js', '.bridge.js', '.guard.js', '.json'];

/**
 * Extensions an Avenx bundle has no way to represent as a module.
 *
 * The old pipeline deleted these imports silently, so `import './theme.css'`
 * in `main.app.js` looked like it did something and did nothing at all. Saying
 * so is strictly better than either silence or a resolution error that reads
 * as a missing file.
 * @type {Set<string>}
 */
const ASSET_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.wav',
]);

/**
 * Raised when a specifier cannot be resolved to a module.
 */
export class ResolveError extends Error {
  /**
   * @param {string} specifier - The unresolvable specifier.
   * @param {string} importer - The module that asked for it.
   * @param {string} reason - Why resolution failed.
   */
  constructor(specifier, importer, reason) {
    super(reason);
    this.name = 'ResolveError';
    /** @type {string} */
    this.specifier = specifier;
    /** @type {string} */
    this.importer = importer;
    /** @type {string} */
    this.reason = reason;
  }
}

/**
 * Whether a specifier names the Avenx runtime entry.
 * @param {string} specifier - The import specifier.
 * @returns {boolean} True for `avenx-core`, `avenx-core/runtime` or `avenx-core/core`.
 */
export function isRuntimeSpecifier(specifier) {
  return RUNTIME_SPECIFIER.test(specifier);
}

/**
 * Reads and caches a `package.json`.
 * @param {string} file - Absolute path to the manifest.
 * @param {Map<string, object|null>} cache - Shared manifest cache.
 * @returns {object|null} The parsed manifest, or null when absent or invalid.
 */
function readManifest(file, cache) {
  if (cache.has(file)) {
    return cache.get(file);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    manifest = null;
  }
  cache.set(file, manifest);
  return manifest;
}

/**
 * Picks a target out of an `exports` value for a browser build.
 *
 * Conditions are tried in the order a browser bundler should prefer them:
 * `browser` before `import` before `module` before `default`. `require` is
 * accepted last, because a package that offers only CommonJS is still better
 * bundled than reported missing — {@link module:lib/bundler/interop} decides
 * what to do with the format once the file is read.
 * @param {any} value - An `exports` entry: string, conditions object, or array.
 * @returns {string|null} A relative target, or null when nothing applies.
 */
function selectCondition(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const picked = selectCondition(entry);
      if (picked) return picked;
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const condition of ['browser', 'import', 'module', 'default', 'require']) {
    if (condition in value) {
      const picked = selectCondition(value[condition]);
      if (picked) return picked;
    }
  }
  return null;
}

/**
 * Resolves a subpath against a manifest's `exports` field.
 * @param {object} manifest - The parsed package manifest.
 * @param {string} subpath - `.` for the package root, otherwise `./name`.
 * @returns {string|null} A relative target, or null when `exports` does not cover it.
 */
function resolveExports(manifest, subpath) {
  const table = manifest.exports;
  if (table === undefined || table === null) {
    return null;
  }

  // A bare string or a conditions object with no subpath keys means the whole
  // package resolves to one target, and only `.` is exported.
  const hasSubpathKeys =
    typeof table === 'object' && !Array.isArray(table) && Object.keys(table).some((key) => key.startsWith('.'));

  if (!hasSubpathKeys) {
    return subpath === '.' ? selectCondition(table) : null;
  }

  if (table[subpath] !== undefined) {
    return selectCondition(table[subpath]);
  }

  // Pattern entries: `"./*": "./dist/*.js"`.
  for (const [pattern, value] of Object.entries(table)) {
    const star = pattern.indexOf('*');
    if (star === -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const middle = subpath.slice(prefix.length, subpath.length - suffix.length || undefined);
    const target = selectCondition(value);
    if (target) return target.replace('*', middle);
  }

  return null;
}

/**
 * Applies a package's `browser` field remapping to a resolved file.
 *
 * The string form replaces the entry point. The object form maps individual
 * paths, and a `false` value means "this module is empty in a browser", which
 * is how packages ship Node-only branches — honouring it is what keeps a
 * `fs` shim from reaching the bundle.
 * @param {object} manifest - The parsed manifest.
 * @param {string} packageDir - The package root.
 * @param {string} file - The file resolution produced.
 * @returns {string|false} The remapped file, or false when it is stubbed out.
 */
function applyBrowserField(manifest, packageDir, file) {
  const field = manifest.browser;
  if (!field || typeof field !== 'object') {
    return file;
  }
  for (const [from, to] of Object.entries(field)) {
    if (!from.startsWith('.')) continue;
    if (path.resolve(packageDir, from) === file) {
      return to === false ? false : path.resolve(packageDir, to);
    }
  }
  return file;
}

/**
 * Probes a path for a real file, trying Avenx and JavaScript extensions and a
 * directory index.
 * @param {string} candidate - An absolute path with or without an extension.
 * @returns {string|null} The file that exists, or null.
 */
export function probeFile(candidate) {
  const stat = (target) => {
    try {
      return fs.statSync(target);
    } catch {
      return null;
    }
  };

  const direct = stat(candidate);
  if (direct && direct.isFile()) {
    return candidate;
  }

  if (!direct) {
    for (const extension of EXTENSIONS) {
      const withExtension = `${candidate}${extension}`;
      const found = stat(withExtension);
      if (found && found.isFile()) {
        return withExtension;
      }
    }
    return null;
  }

  if (direct.isDirectory()) {
    for (const extension of ['.js', '.mjs']) {
      const index = path.join(candidate, `index${extension}`);
      const found = stat(index);
      if (found && found.isFile()) {
        return index;
      }
    }
  }

  return null;
}

/**
 * Resolves module specifiers for one build.
 *
 * Holds the virtual-module table the compiler populated and a manifest cache,
 * so repeated resolution across a large graph reads each `package.json` once.
 */
export class Resolver {
  /**
   * @param {object} options - Resolver options.
   * @param {Map<string, string>} [options.virtualModules] - Module id to source.
   * @param {string} [options.runtimeEntry] - Absolute path of the runtime barrel.
   * @param {string[]} [options.roots] - Extra directories to search for packages.
   */
  constructor({ virtualModules = new Map(), runtimeEntry = null, roots = [] } = {}) {
    /** @type {Map<string, string>} */
    this.virtualModules = virtualModules;
    /** @type {string} */
    this.runtimeEntry = runtimeEntry || path.join(AVENX_PACKAGE_ROOT, 'lib', 'core', 'index.js');
    /** @type {string[]} */
    this.roots = roots;
    /** @type {Map<string, object|null>} */
    this.manifests = new Map();
    /** @type {Map<string, string>} */
    this.cache = new Map();
  }

  /**
   * Whether an id names a module the compiler generated rather than a file.
   * @param {string} id - The module id.
   * @returns {boolean} True for a virtual module.
   */
  isVirtual(id) {
    return this.virtualModules.has(id);
  }

  /**
   * Resolves a specifier to a module id.
   * @param {string} specifier - The import specifier as written.
   * @param {string} importer - Absolute path or virtual id of the importing module.
   * @returns {string} The resolved module id.
   * @throws {ResolveError} When the specifier names nothing resolvable.
   */
  resolve(specifier, importer) {
    const key = `${importer}\u0000${specifier}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const resolved = this.resolveUncached(specifier, importer);
    this.cache.set(key, resolved);
    return resolved;
  }

  /**
   * Resolution without the memo.
   * @param {string} specifier - The import specifier.
   * @param {string} importer - The importing module.
   * @returns {string} The resolved module id.
   * @throws {ResolveError} When the specifier names nothing resolvable.
   * @private
   */
  resolveUncached(specifier, importer) {
    if (this.virtualModules.has(specifier)) {
      return specifier;
    }

    if (isRuntimeSpecifier(specifier)) {
      return this.runtimeEntry;
    }

    const bareBuiltin = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    if (NODE_BUILTINS.has(bareBuiltin)) {
      throw new ResolveError(
        specifier,
        importer,
        `"${specifier}" is a Node.js builtin and has no browser implementation. ` +
          'An Avenx application bundle runs in a browser, so it cannot contain it.',
      );
    }

    const extension = path.extname(specifier).toLowerCase();
    if (ASSET_EXTENSIONS.has(extension)) {
      throw new ResolveError(
        specifier,
        importer,
        `Avenx does not bundle ${extension} files, so this import cannot be honoured.\n` +
          (extension === '.css' || extension === '.scss' || extension === '.sass' || extension === '.less'
            ? 'Component styles belong in a matching .component.css or .page.css file, and application-wide ' +
              'styles in a <@global> block. A stylesheet that is genuinely external belongs in a <link> tag ' +
              'in index.html.'
            : 'Reference the asset by URL from your template or stylesheet instead.'),
      );
    }

    if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
      return this.resolvePath(specifier, importer);
    }

    return this.resolveBare(specifier, importer);
  }

  /**
   * Resolves a relative or absolute specifier.
   * @param {string} specifier - The specifier.
   * @param {string} importer - The importing module.
   * @returns {string} The resolved module id.
   * @throws {ResolveError} When nothing exists at that path.
   * @private
   */
  resolvePath(specifier, importer) {
    const base = this.directoryOf(importer);
    const candidate = path.resolve(base, specifier);

    // A generated module wins over the file it was generated from. A
    // `.component.js` on disk is Avenx template source, not JavaScript, and
    // handing it to the module reader would fail on markup.
    for (const suffix of ['', '.component.js', '.page.js', '.js']) {
      const virtualId = `${candidate}${suffix}`;
      if (this.virtualModules.has(virtualId)) {
        return virtualId;
      }
    }

    const file = probeFile(candidate);
    if (!file) {
      throw new ResolveError(
        specifier,
        importer,
        `no file exists at ${candidate} (tried it directly, with ${EXTENSIONS.join(', ')}, and as a directory index)`,
      );
    }
    return this.applyOwningBrowserField(file, specifier);
  }

  /**
   * Applies the `browser` field of the package a resolved file belongs to.
   *
   * A package stubs its Node-only modules by mapping them to `false`, and those
   * modules are usually reached by a *relative* import from inside the package
   * rather than by a bare specifier. Honouring the field only at the package
   * entry would therefore miss exactly the case it exists for.
   *
   * Restricted to files under `node_modules`: this is how third-party packages
   * describe themselves, and silently emptying a module in an application's own
   * source would be a surprise rather than a service.
   * @param {string} file - The resolved file.
   * @param {string} specifier - The specifier that produced it, for the stub id.
   * @returns {string} The file, or the id of an empty module standing in for it.
   * @private
   */
  applyOwningBrowserField(file, specifier) {
    const marker = `${path.sep}node_modules${path.sep}`;
    if (!file.includes(marker)) {
      return file;
    }

    let dir = path.dirname(file);
    for (;;) {
      const manifestPath = path.join(dir, 'package.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = readManifest(manifestPath, this.manifests) || {};
        const mapped = applyBrowserField(manifest, dir, file);
        return mapped === false ? this.emptyModuleId(specifier) : mapped;
      }
      const parent = path.dirname(dir);
      if (parent === dir || !dir.includes(marker)) {
        return file;
      }
      dir = parent;
    }
  }

  /**
   * Resolves a bare package specifier through `node_modules`.
   * @param {string} specifier - The specifier, e.g. `lodash` or `lodash/fp`.
   * @param {string} importer - The importing module.
   * @returns {string} The resolved module id.
   * @throws {ResolveError} When the package or its subpath cannot be found.
   * @private
   */
  resolveBare(specifier, importer) {
    const scoped = specifier.startsWith('@');
    const parts = specifier.split('/');
    const name = scoped ? parts.slice(0, 2).join('/') : parts[0];
    const subpath = specifier.slice(name.length).replace(/^\//, '');

    const searched = [];
    for (const dir of this.packageDirectories(importer, name)) {
      searched.push(dir);
      const manifestPath = path.join(dir, 'package.json');
      const manifest = readManifest(manifestPath, this.manifests) || {};

      const resolved = this.resolveInPackage(dir, manifest, subpath);
      if (resolved === false) {
        // `"browser": { "./node-only.js": false }` — the package itself says
        // this module is empty in a browser. Honour that rather than bundling
        // a Node implementation.
        return this.emptyModuleId(specifier);
      }
      if (resolved) {
        return resolved;
      }
    }

    if (specifier === 'avenx-core' || specifier.startsWith('avenx-core/')) {
      // Building inside the Avenx repository itself, or against a checkout
      // rather than an install. The package that owns this file is the one the
      // application means.
      const local = this.resolveInPackage(
        AVENX_PACKAGE_ROOT,
        readManifest(path.join(AVENX_PACKAGE_ROOT, 'package.json'), this.manifests) || {},
        specifier.slice('avenx-core'.length).replace(/^\//, ''),
      );
      if (local) {
        return local;
      }
    }

    throw new ResolveError(
      specifier,
      importer,
      searched.length > 0
        ? `no package named "${name}" was found. Looked in:\n  ${searched.join('\n  ')}`
        : `no package named "${name}" was found in any node_modules directory above ${this.directoryOf(importer)}`,
    );
  }

  /**
   * Resolves a subpath inside a package directory.
   * @param {string} dir - The package root.
   * @param {object} manifest - Its parsed manifest.
   * @param {string} subpath - The subpath, `''` for the package root.
   * @returns {string|false|null} A file, `false` when browser-stubbed, or null.
   * @private
   */
  resolveInPackage(dir, manifest, subpath) {
    const exportsTarget = resolveExports(manifest, subpath === '' ? '.' : `./${subpath}`);

    let candidate;
    if (exportsTarget) {
      candidate = path.resolve(dir, exportsTarget);
    } else if (subpath !== '') {
      candidate = path.resolve(dir, subpath);
    } else {
      const browserMain = typeof manifest.browser === 'string' ? manifest.browser : null;
      const main = browserMain || manifest.module || manifest.main || 'index.js';
      candidate = path.resolve(dir, main);
    }

    const file = probeFile(candidate);
    if (!file) {
      return null;
    }
    return applyBrowserField(manifest, dir, file);
  }

  /**
   * Yields every `node_modules/<name>` directory that exists above an importer.
   * @param {string} importer - The importing module.
   * @param {string} name - The package name.
   * @returns {string[]} Existing package directories, nearest first.
   * @private
   */
  packageDirectories(importer, name) {
    const found = [];
    const bases = [this.directoryOf(importer), ...this.roots];

    for (const base of bases) {
      let dir = base;
      for (;;) {
        const candidate = path.join(dir, 'node_modules', name);
        if (fs.existsSync(path.join(candidate, 'package.json')) && !found.includes(candidate)) {
          found.push(candidate);
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }

    return found;
  }

  /**
   * The directory a module's relative imports resolve against.
   *
   * A virtual module is generated *for* a source file and keeps that file's id,
   * so its relative imports resolve exactly as the developer wrote them.
   * @param {string} importer - Module id.
   * @returns {string} An absolute directory.
   * @private
   */
  directoryOf(importer) {
    return path.dirname(importer);
  }

  /**
   * Registers and returns an empty module standing in for a browser stub.
   * @param {string} specifier - The specifier being stubbed.
   * @returns {string} The virtual module id.
   * @private
   */
  emptyModuleId(specifier) {
    const id = `\u0000avenx:empty:${specifier}`;
    if (!this.virtualModules.has(id)) {
      this.virtualModules.set(id, `// "${specifier}" is browser-stubbed by its own package.\nexport default {};\n`);
    }
    return id;
  }
}
