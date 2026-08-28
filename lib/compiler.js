import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from './config.js';
const findProjectRoot = loadConfig.findProjectRoot;
import StyleProcessor from './compiler/StyleProcessor.js';
import ComponentParser from './compiler/ComponentParser.js';
import {
  analyzeBridgeFile,
  emitBridge,
  findBridgeImports,
  declaredMembers,
  extractSubscriptions,
  suggestName,
} from './compiler/BridgeParser.js';
import { logger } from './core/runtime/AvenxLogger.js';
import { performance } from 'perf_hooks';
import { AvenxErrorCodes } from './core/runtime/AvenxError.js';
import { BuildError } from './compiler/errors/index.js';
import { reportWarning } from './compiler/utils/warningReporter.js';
import { loadEnv, replaceEnvVariables } from './env.js';
import { rewriteRuntimeImports } from './compiler/runtimeImports.js';
import { buildSidecar, sidecarFileName } from './compiler/sourceMapTrace.js';
import { composeBundleSourceMap } from './compiler/sourcemap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUNDLE_SIZE_WARNING_THRESHOLD_KB = 50;

/**
 * Resolves the build mode from configuration and environment.
 *
 * Production is the default so that a plain `avenx build` — what a deploy
 * script runs — produces optimised output. Development has to be asked for,
 * by `avenx build --dev`, by `mode`/`dev` in avenx.config.json, or by
 * NODE_ENV.
 * @param {object} config - The resolved compiler configuration.
 * @returns {'production'|'development'} The active mode.
 */
function resolveMode(config) {
  if (config.mode === 'development' || config.mode === 'production') {
    return config.mode;
  }
  if (config.dev === true) {
    return 'development';
  }
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }
  return 'production';
}

/**
 * AvenxCompiler is the main orchestrator for the Avenx-JS build process.
 * It coordinates the parsing of components, processing of styles, and the
 * final bundling of the application.
 */
class AvenxCompiler {
  /**
   * Creates an instance of AvenxCompiler and initializes its sub-processors.
   * @param {object} [options] - Optional custom settings to override config defaults.
   */
  constructor(options = {}) {
    /**
     * The root directory of the project.
     * @type {string}
     */
    this.rootDir = options.rootDir || findProjectRoot(process.cwd());
    loadEnv(this.rootDir);

    // Expose properties prefixed with AVX_PUBLIC_ to the compiler
    this.publicEnv = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AVX_PUBLIC_')) {
        this.publicEnv[key] = process.env[key];
      }
    }

    const config = { ...loadConfig(this.rootDir), ...options };

    /**
     * The output bundle name without file extension.
     * Defaults to "bundle" when outputName is not configured.
     * @type {string}
     */
    this.outputName = config.outputName || 'bundle';

    // Configure logger for build-time compiler
    logger.configure({
      level: (config.logging && config.logging.level) || 'info',
      silent:
        (config.logging &&
          (config.logging.silent || config.logging.level === 'silent' || config.logging.level === 'off')) ||
        false,
      // CLI output doesn't need prefixes for generic info logs. The CLI injects its
      // own formatter (see bin/colors.js) to tint warnings and errors; other
      // consumers such as the Vite plugin keep the plain pass-through default.
      formatter: (config.logging && config.logging.formatter) || ((level, args) => args),
    });

    /**
     * The source directory (usually 'src').
     * @type {string}
     */
    this.srcDir = path.join(this.rootDir, config.srcDir);
    /**
     * The distribution directory (usually 'dist').
     * @type {string}
     */
    this.distDir = path.join(this.rootDir, config.distDir);
    /**
     * The directory containing core runtime files.
     * @type {string}
     */
    this.coreDir = path.join(__dirname, 'core');

    /**
     * @type {object}
     */
    this.config = config;
    /**
     * @type {StyleProcessor}
     */
    this.styleProcessor = new StyleProcessor(config.style || {}, config);
    /**
     * @type {ComponentParser}
     */
    this.componentParser = new ComponentParser(this.styleProcessor, config.voidTags, config);

    /**
     * The build mode. Production is the default: `avenx build` is what runs in
     * CI and in a deploy step, so the safe default is the optimised output.
     * `avenx serve` and `avenx watch` opt into development explicitly.
     * @type {'production'|'development'}
     */
    this.mode = resolveMode(config);

    /**
     * True when building optimised output.
     * @type {boolean}
     */
    this.production = this.mode === 'production';

    this.init();
  }

  /**
   * Initializes the compiler environment, ensuring required directories exist.
   * @private
   */
  init() {
    if (!fs.existsSync(this.distDir)) {
      try {
        fs.mkdirSync(this.distDir, { recursive: true });
      } catch {
        logger.error(`❌ ${new BuildError(AvenxErrorCodes.COMPILER_DIST_CREATION_FAILED, this.distDir).message}`);
      }
    }
  }

  /**
   * Executes the full build process.
   *
   * Every fatal condition throws. Nothing here logs an error and returns as if
   * the build had finished: a caller that cannot tell success from failure
   * cannot set an exit code, and a pipeline that cannot see the failure
   * deploys whatever is already in the output directory.
   * @returns {{mode: string, distDir: string, files: string[], durationMs: number}}
   *   A description of what was written.
   * @throws {BuildError} When the application cannot be compiled.
   */
  build() {
    logger.info(`--- Avenx-JS Compiler (${this.mode}) ---`);
    const startTime = performance.now();
    

    if (!fs.existsSync(this.srcDir)) {
      throw new BuildError(AvenxErrorCodes.COMPILER_SRC_DIR_MISSING, this.srcDir);
    }

    this.styleProcessor.reset();
    this.__bridgeConsumerFiles = null;
    this.__bridgeConsumerSources = null;
    this.__bundleSections = [];

    let bundleJs = this.getRuntime();
    const bridgeData = this.processBridges();
    bundleJs += bridgeData.bridgesJs;
    // Components resolve their bridge imports against this map.
    this.componentParser.setBridges(bridgeData.bridges);
    this.validateBridgeUsage(bridgeData.bridges);
    bundleJs += this.processGuards();

    bundleJs += this.processComponents();

    const pageData = this.processPages();
    bundleJs += pageData.pagesJs;
    bundleJs += this.processMain((bridgeData.registrations || '') + '\n' + (pageData.registrations || ''));

    const jsFileName = `${this.outputName}.js`;
    const jsMapFileName = `${this.outputName}.js.map`;
    const cssFileName = `${this.outputName}.css`;
    const traceMapFileName = sidecarFileName(this.outputName);

    const shouldEmitJsMap =
      this.config.sourceMap === true ||
      this.config.sourcemap === true ||
      (!this.production && this.config.sourceMap !== false);

    const includeSourcesContent = this.config.sourcesContent !== false;

    if (shouldEmitJsMap) {
      bundleJs += `\n//# sourceMappingURL=${jsMapFileName}\n`;
    }

    const totalBundleLines = bundleJs.split(/\r?\n/).length;
    const jsSourceMap = shouldEmitJsMap
      ? composeBundleSourceMap(jsFileName, totalBundleLines, this.__bundleSections || [], {
          sourcesContent: includeSourcesContent,
        })
      : null;

    const isDevMode =
      !this.production ||
      (this.config.style &&
        (this.config.style.dev === true ||
          this.config.style.inlineSourceMap === true ||
          this.config.style.sourceMap === 'inline'));

    const baseCssContent = this.styleProcessor.getGlobalStyles({
      dev: isDevMode,
      distDir: this.distDir,
      cssFileName,
    });
    const sourceMap = this.styleProcessor.getSourceMap(this.distDir, cssFileName);
    const cssWithMapComment = isDevMode ? baseCssContent : baseCssContent + `\n/*# sourceMappingURL=${cssFileName}.map */\n`;

    // The trace sidecar maps recorded action and computed names back to a file
    // and a line. It sits beside the bundle and is never referenced by it, so
    // an application that records no traces downloads nothing extra and a
    // deployment that does not want the file simply does not upload it.
    const traceSidecar = buildSidecar(this.componentParser.locations, bridgeData.bridges, this.rootDir);

    const files = [jsFileName, cssFileName, `${cssFileName}.map`, traceMapFileName];
    if (shouldEmitJsMap) {
      files.push(jsMapFileName);
    }

    const outputs = new Map([
      [jsFileName, bundleJs],
      [cssFileName, cssWithMapComment],
      [`${cssFileName}.map`, JSON.stringify(sourceMap, null, 2)],
      [traceMapFileName, JSON.stringify(traceSidecar, null, 2)],
    ]);

    if (shouldEmitJsMap) {
      outputs.set(jsMapFileName, JSON.stringify(jsSourceMap, null, 2));
    }

    // Every artifact is produced before any of them is written, and written to
    // a staging directory before any of them is promoted. Writing bundle.js
    // first and then failing while producing the CSS used to leave a new script
    // beside a stale stylesheet — output that never existed as a whole build.
    const staging = this.writeStaging(outputs);


    try {
      logger.info('\nAsset sizes:');

      files.forEach((file) => {
        const filePath = path.join(staging, file);
        const bytes = fs.statSync(filePath).size;
        const sizeKb = bytes / 1024;

        logger.info(`${file}: ${sizeKb.toFixed(2)} KB`);

        // The trace sidecar is a build artifact for the CLI, not something a
        // browser downloads, so it is not weighed against the bundle budget.
        if (file !== traceMapFileName && sizeKb > BUNDLE_SIZE_WARNING_THRESHOLD_KB) {
          // Escalating AVX_W01 to an error throws from here. That happens
          // before promotion, so the size limit is enforced on output that
          // never reaches distDir.
          reportWarning(
            AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED,
            new BuildError(
              AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED,
              file,
              BUNDLE_SIZE_WARNING_THRESHOLD_KB,
              sizeKb.toFixed(2),
            ),
            this.config,
          );
        }
      });

      this.promoteStaging(staging, files);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }

    logger.info('-----------------------');
    logger.info(`\nBuild successful: ${this.distDir}/${jsFileName} & ${this.distDir}/${cssFileName}`);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    logger.info(`Build completed in ${durationMs} ms`);

    return { mode: this.mode, distDir: this.distDir, files, durationMs };
  }

  /**
   * Writes the finished artifacts to a staging directory.
   *
   * Staging lives inside distDir so that promotion is a rename on the same
   * filesystem — a rename across devices fails with EXDEV, which would put the
   * promote step back in the business of copying half a build.
   * @param {Map<string, string>} outputs - File name to contents.
   * @returns {string} The staging directory path.
   * @throws {BuildError} When the output directory cannot be written to.
   * @private
   */
  writeStaging(outputs) {
    const staging = path.join(this.distDir, `.avenx-staging-${process.pid}`);

    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });

      for (const [fileName, contents] of outputs) {
        fs.writeFileSync(path.join(staging, fileName), contents);
      }
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new BuildError(AvenxErrorCodes.COMPILER_DIST_CREATION_FAILED, `${this.distDir} (${err.message})`);
    }

    return staging;
  }

  /**
   * Moves staged artifacts into the output directory.
   *
   * Each file is renamed into place, which is atomic per file. A build that
   * fails before this point leaves distDir exactly as it was, so the previous
   * artifacts stay whole rather than being partly overwritten by a build that
   * never finished.
   *
   * The previous artifacts are deliberately not deleted on failure. The exit
   * code is what stops a deployment; removing a good bundle would break
   * anything still serving it — a dev server, a local preview, a rollback —
   * and would turn a build error into a second, unrelated outage.
   * @param {string} staging - The staging directory.
   * @param {string[]} files - File names to promote.
   * @throws {BuildError} When a staged file cannot be moved into place.
   * @private
   */
  promoteStaging(staging, files) {
    for (const fileName of files) {
      const from = path.join(staging, fileName);
      const to = path.join(this.distDir, fileName);
      try {
        fs.renameSync(from, to);
      } catch (err) {
        throw new BuildError(AvenxErrorCodes.COMPILER_DIST_CREATION_FAILED, `${to} (${err.message})`);
      }
    }
  }

  /**
   * Reads the runtime bundle for the active mode.
   *
   * Both variants are self-contained IIFEs produced by esbuild, so the source
   * is used verbatim. An earlier version stripped import statements with a
   * regex here, which also matched import syntax inside string literals — it
   * silently deleted a line from the AVX_C12 diagnostic — and would corrupt
   * minified output, where a single expression can span the whole file.
   * @returns {string} The runtime source code.
   * @private
   */
  getRuntime() {
    const fileName = this.production ? 'runtime.min.js' : 'runtime.js';
    const runtimePath = path.join(__dirname, '..', 'dist', fileName);

    if (!fs.existsSync(runtimePath)) {
      throw new BuildError(AvenxErrorCodes.COMPILER_RUNTIME_MISSING, fileName);
    }

    return fs.readFileSync(runtimePath, 'utf-8');
  }

  /**
   * Processes bridge registrations from the global directory.
   * @returns {{registrations: string}} The registration code for bridges.
   * @private
   */
  /**
   * Collects every `.bridge.js` module in the project.
   * Bridges live in `src/bridges/` (preferred) or alongside guards in
   * `src/global/`; both are scanned recursively.
   * @returns {string[]} Absolute paths to bridge modules.
   * @private
   */
  findBridgeFiles() {
    const files = [];
    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          scan(fullPath);
        } else if (entry.endsWith('.bridge.js')) {
          files.push(fullPath);
        }
      }
    };
    scan(path.join(this.srcDir, 'bridges'));
    scan(path.join(this.srcDir, 'global'));
    return files;
  }

  /**
   * Collects the files that may import a bridge: components, pages, the app
   * entry point and other bridges.
   * @returns {string[]} Absolute paths to candidate consumer files.
   * @private
   */
  findBridgeConsumerFiles() {
    if (this.__bridgeConsumerFiles) {
      return this.__bridgeConsumerFiles;
    }
    const files = [];
    const scan = (dir, ext) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          scan(fullPath, ext);
        } else if (entry.endsWith(ext)) {
          files.push(fullPath);
        }
      }
    };
    scan(path.join(this.srcDir, 'components'), '.component.js');
    scan(path.join(this.srcDir, 'pages'), '.page.js');

    const mainFile = path.join(this.srcDir, 'main.app.js');
    if (fs.existsSync(mainFile)) {
      files.push(mainFile);
    }
    this.__bridgeConsumerFiles = files;
    return files;
  }

  /**
   * Reads a bridge consumer's source, caching it for the duration of a build.
   * Reachability and usage validation both need every consumer's text.
   * @param {string} filePath - The consumer file.
   * @returns {string} Its source.
   * @private
   */
  readBridgeConsumer(filePath) {
    if (!this.__bridgeConsumerSources) {
      this.__bridgeConsumerSources = new Map();
    }
    let source = this.__bridgeConsumerSources.get(filePath);
    if (source === undefined) {
      source = fs.readFileSync(filePath, 'utf-8');
      this.__bridgeConsumerSources.set(filePath, source);
    }
    return source;
  }

  /**
   * Processes bridge modules.
   *
   * Bridges are reached through imports, so the compiler can see exactly which
   * ones the application consumes and emit only those.
   * @returns {{registrations: string, bridgesJs: string, bridges: Map<string, object>}}
   *   Registration calls for the inspector, the emitted declarations, and the
   *   descriptor of every bridge keyed by absolute path.
   * @private
   */
  processBridges() {
    let registrations = '';
    let bridgesJs = '';
    /** @type {Map<string, object>} */
    const bridges = new Map();

    for (const filePath of this.findBridgeFiles()) {
      const descriptor = analyzeBridgeFile(filePath, replaceEnvVariables);
      if (!descriptor) {
        throw new BuildError(
          AvenxErrorCodes.COMPILER_BRIDGE_INVALID_MODULE,
          path.relative(this.rootDir, filePath),
        );
      }

      bridges.set(path.resolve(filePath), descriptor);
    }

    // Bridge names become identifiers in the bundle, so they have to be unique.
    const byName = new Map();
    for (const descriptor of bridges.values()) {
      if (!byName.has(descriptor.name)) {
        byName.set(descriptor.name, []);
      }
      byName.get(descriptor.name).push(descriptor.filePath);
    }
    const duplicates = [...byName.entries()].filter(([, paths]) => paths.length > 1);
    if (duplicates.length > 0) {
      const details = duplicates
        .map(([name, paths]) => `  "${name}":\n${paths.map((item) => `    - ${item}`).join('\n')}`)
        .join('\n');
      throw new BuildError(AvenxErrorCodes.COMPILER_BRIDGE_DUPLICATE_NAME, details);
    }

    for (const descriptor of bridges.values()) {
      for (const specifier of descriptor.unsupportedImports) {
        throw new BuildError(
          AvenxErrorCodes.COMPILER_BRIDGE_UNSUPPORTED_IMPORT,
          descriptor.name,
          specifier,
        );
      }
    }

    // Reachability: a modern bridge ships only when something imports it,
    // directly or through another bridge.
    const reachable = new Set();
    const visit = (resolvedPath) => {
      const key = path.resolve(resolvedPath);
      if (reachable.has(key)) return;
      const descriptor = bridges.get(key);
      if (!descriptor) return;
      reachable.add(key);
      for (const entry of descriptor.bridgeImports) {
        visit(entry.resolved);
      }
    };

    for (const consumer of this.findBridgeConsumerFiles()) {
      const source = this.readBridgeConsumer(consumer);
      for (const entry of findBridgeImports(consumer, source)) {
        if (!bridges.has(path.resolve(entry.resolved))) {
          throw new BuildError(
            AvenxErrorCodes.COMPILER_BRIDGE_NOT_FOUND,
            entry.specifier,
            path.relative(this.rootDir, consumer),
            entry.resolved,
            [...bridges.values()].map((item) => item.name).join(', ') || 'none',
          );
        }
        visit(entry.resolved);
      }
    }

    // Emit dependencies before dependants so each IIFE can alias the bridges
    // it imports. A cycle has no such order, and the emitted bundle would throw
    // a temporal dead zone error at load, so reject it here instead.
    const emitted = new Set();
    const visiting = [];
    const emit = (resolvedPath) => {
      const key = path.resolve(resolvedPath);
      if (emitted.has(key)) return;
      const descriptor = bridges.get(key);
      if (!descriptor) return;

      const cycleStart = visiting.findIndex((item) => item.key === key);
      if (cycleStart !== -1) {
        const cycle = [...visiting.slice(cycleStart).map((item) => item.name), descriptor.name];
        throw new BuildError(AvenxErrorCodes.COMPILER_BRIDGE_CIRCULAR_IMPORT, cycle.join(' -> '));
      }

      visiting.push({ key, name: descriptor.name });
      for (const entry of descriptor.bridgeImports) {
        emit(entry.resolved);
      }
      visiting.pop();
      emitted.add(key);
      const source = replaceEnvVariables(fs.readFileSync(descriptor.filePath, 'utf-8'));
      logger.info(`[Bridge] ${descriptor.name}`);
      bridgesJs += `\n${emitBridge(descriptor, source, bridges)}\n`;
      registrations += `app.registerBridge('${descriptor.name}', ${descriptor.binding});\n`;
    };
    for (const key of reachable) {
      emit(key);
    }

    const unused = [...bridges.values()].filter((item) => !reachable.has(path.resolve(item.filePath)));
    for (const descriptor of unused) {
      logger.info(`[Bridge] ${descriptor.name} — not imported anywhere, omitted from the bundle`);
    }

    return { registrations, bridgesJs, bridges };
  }

  /**
   * Reports template members and event subscriptions that a bridge does not
   * declare. These are silent `undefined` reads at runtime, so they are worth
   * surfacing at build time with a suggestion.
   * @param {Map<string, object>} bridges - Discovered bridges by absolute path.
   * @private
   */
  validateBridgeUsage(bridges) {
    if (bridges.size === 0) return;

    for (const consumer of this.findBridgeConsumerFiles()) {
      const source = this.readBridgeConsumer(consumer);
      const imports = findBridgeImports(consumer, source);
      if (imports.length === 0) continue;

      const relative = path.relative(this.rootDir, consumer);
      // Scan the body only: an import specifier such as './auth.bridge.js'
      // would otherwise look like a member access on `auth`.
      const body = source.replace(/^[ \t]*import\s+(?:[\s\w$,{}*]*?\s+from\s+)?['"][^'"]*['"];?[ \t]*\r?\n?/gm, '');
      const byLocal = new Map();
      for (const entry of imports) {
        const descriptor = bridges.get(path.resolve(entry.resolved));
        if (descriptor) {
          byLocal.set(entry.local, descriptor);
        }
      }

      for (const [local, descriptor] of byLocal) {
        const members = declaredMembers(descriptor);
        const accessRegex = new RegExp(`\\b${local}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, 'g');
        const reported = new Set();
        let match;
        while ((match = accessRegex.exec(body)) !== null) {
          const member = match[1];
          if (members.includes(member) || reported.has(member)) continue;
          reported.add(member);
          reportWarning(
            AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_MEMBER,
            new BuildError(
              AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_MEMBER,
              descriptor.name,
              member,
              relative,
              suggestName(member, members),
              members.join(', '),
            ),
            this.config,
          );
        }
      }

      for (const { target, event } of extractSubscriptions(body)) {
        const descriptor = byLocal.get(target);
        if (!descriptor || descriptor.events.includes(event)) continue;
        reportWarning(
          AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_EVENT,
          new BuildError(
            AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_EVENT,
            descriptor.name,
            event,
            relative,
            suggestName(event, descriptor.events),
            descriptor.events.join(', ') || 'none',
          ),
          this.config,
        );
      }
    }
  }

  /**
   * Processes guard classes from the global and guards directories.
   * @returns {string} The concatenated guard source code.
   * @private
   */
  processGuards() {
    const globalDir = path.join(this.srcDir, 'global');
    const guardsDir = path.join(this.srcDir, 'guards');
    let guardsJs = '';

    const processFile = (dir, file) => {
      const name = path.basename(file, '.guard.js');

      const capitalizedName =
        name
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('') + 'Guard';

      logger.info(`[Guard] ${capitalizedName}`);

      const content = replaceEnvVariables(fs.readFileSync(path.join(dir, file), 'utf-8'));

      const cleaned = rewriteRuntimeImports(content)
        .replace(/export\s+default\s+/g, '')
        .replace(/export\s+/g, '');

      guardsJs += `\n${cleaned}\n`;
    };

    if (fs.existsSync(globalDir)) {
      fs.readdirSync(globalDir).forEach((file) => {
        if (file.endsWith('.guard.js')) {
          processFile(globalDir, file);
        }
      });
    }

    if (fs.existsSync(guardsDir)) {
      fs.readdirSync(guardsDir).forEach((file) => {
        if (file.endsWith('.guard.js')) {
          processFile(guardsDir, file);
        }
      });
    }

    return guardsJs;
  }

  /**
   * Processes all components in the src/components folder recursively.
   * Resolves component dependencies and detects circular import loops using DFS.
   * @returns {string} The concatenated source code of all compiled components.
   * @private
   */
  processComponents() {
    let componentsJs = '';
    const compDir = path.join(this.srcDir, 'components');
    const classNameMap = new Map();
    const pathToClassName = new Map();

    const toClassName = (fileName) =>
      path
        .basename(fileName, '.component.js')
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;

      fs.readdirSync(dir).forEach((file) => {
        const fullPath = path.join(dir, file);

        if (fs.statSync(fullPath).isDirectory()) {
          scan(fullPath);
        } else if (file.endsWith('.component.js')) {
          const className = toClassName(file);

          if (!classNameMap.has(className)) {
            classNameMap.set(className, []);
          }

          classNameMap.get(className).push(fullPath);
          pathToClassName.set(path.resolve(fullPath), className);
        }
      });
    };

    scan(compDir);

    const duplicates = [...classNameMap.entries()].filter(([, paths]) => paths.length > 1);

    if (duplicates.length > 0) {
      const details = duplicates
        .map(([className, paths]) => `  "${className}":\n${paths.map((p) => `    - ${p}`).join('\n')}`)
        .join('\n');

      throw new BuildError(AvenxErrorCodes.COMPILER_DUPLICATE_COMPONENT_NAME, details);
    }

    // Build dependency graph for components
    const graph = new Map();
    classNameMap.forEach((paths, className) => {
      const fullPath = paths[0];
      const deps = new Set();
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Extract dependencies from JS import statements
        const importRegex = /import\s+(?:[\s\w$,{}*]*?\s+from\s+['"](.*?)['"]|['"](.*?)['"]);?/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const importSpecifier = match[1] || match[2];
          if (importSpecifier && importSpecifier.startsWith('.')) {
            let resolved = path.resolve(path.dirname(fullPath), importSpecifier);
            if (!resolved.endsWith('.js')) {
              if (fs.existsSync(`${resolved}.component.js`)) {
                resolved = `${resolved}.component.js`;
              } else if (fs.existsSync(`${resolved}.js`)) {
                resolved = `${resolved}.js`;
              }
            }
            const targetClassName = pathToClassName.get(resolved);
            if (targetClassName && targetClassName !== className) {
              deps.add(targetClassName);
            }
          }
        }

        // Extract dependencies from HTML template tags (e.g. <ChildComp />)
        const tagRegex = /<([A-Z][a-zA-Z0-9]*)\b/g;
        while ((match = tagRegex.exec(content)) !== null) {
          const tagName = match[1];
          if (classNameMap.has(tagName) && tagName !== className) {
            deps.add(tagName);
          }
        }
      }
      graph.set(className, Array.from(deps));
    });

    // Cycle detection & topological sort using DFS
    const visited = new Set();
    const visiting = new Map();
    const reportedCycles = new Set();
    const orderedClasses = [];

    const dfs = (className, stack = []) => {
      if (visited.has(className)) return;
      if (visiting.has(className)) {
        const startIndex = stack.indexOf(className);
        const cyclePath = stack.slice(startIndex).concat(className);
        const cycleStr = cyclePath.join(' -> ');
        if (!reportedCycles.has(cycleStr)) {
          reportedCycles.add(cycleStr);
          reportWarning(
            AvenxErrorCodes.COMPILER_CIRCULAR_DEPENDENCY,
            new BuildError(AvenxErrorCodes.COMPILER_CIRCULAR_DEPENDENCY, cycleStr),
            this.config,
          );
        }
        return;
      }

      visiting.set(className, stack.length);
      stack.push(className);

      const deps = graph.get(className) || [];
      for (const dep of deps) {
        dfs(dep, stack);
      }

      stack.pop();
      visiting.delete(className);
      visited.add(className);
      orderedClasses.push(className);
    };

    classNameMap.forEach((_, className) => {
      if (!visited.has(className)) {
        dfs(className);
      }
    });

    const isTreeShakeEnabled =
      (!this.config || (this.config.treeShakeComponents !== false && this.config.treeShake !== false)) &&
      (!this.options || (this.options.treeShakeComponents !== false && this.options.treeShake !== false));

    const usedComponents = isTreeShakeEnabled
      ? this.findUsedComponents(classNameMap, pathToClassName, graph)
      : new Set(classNameMap.keys());

    const classesToCompile = orderedClasses.filter((className) => usedComponents.has(className));

    classesToCompile.forEach((className) => {
      const paths = classNameMap.get(className);
      if (paths && paths.length > 0) {
        const fullPath = paths[0];
        logger.info(`[Compiling] ${path.basename(fullPath)}`);
        const originalSource = fs.readFileSync(fullPath, 'utf-8');
        const compiled = this.componentParser.parse(fullPath);
        const lineCount = compiled.split(/\r?\n/).length;

        if (this.__bundleSections) {
          this.__bundleSections.push({
            filePath: path.relative(this.rootDir, fullPath),
            originalCode: originalSource,
            startLine: componentsJs.split(/\r?\n/).length,
            lineCount,
          });
        }

        componentsJs += compiled;
      }
    });

    return componentsJs;
  }

  /**
   * Identifies which components are actively referenced (used) by entry point files
   * (pages, main.app.js, global files, index.html) or transitively by other used components.
   * @param {Map<string, string[]>} classNameMap
   * @param {Map<string, string>} pathToClassName
   * @param {Map<string, string[]>} graph
   * @returns {Set<string>} Set of component class names that are used.
   * @private
   */
  findUsedComponents(classNameMap, pathToClassName, graph) {
    const entryFiles = [];
    const pageDir = path.join(this.srcDir, 'pages');
    const globalDir = path.join(this.srcDir, 'global');
    const guardsDir = path.join(this.srcDir, 'guards');
    const mainFile = path.join(this.srcDir, 'main.app.js');
    const indexHtml = path.join(this.rootDir, 'index.html');

    const scanFiles = (dir, ext) => {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).forEach((file) => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          scanFiles(fullPath, ext);
        } else if (file.endsWith(ext)) {
          entryFiles.push(fullPath);
        }
      });
    };

    scanFiles(pageDir, '.page.js');
    scanFiles(globalDir, '.js');
    scanFiles(guardsDir, '.js');

    if (fs.existsSync(mainFile)) {
      entryFiles.push(mainFile);
    }
    if (fs.existsSync(indexHtml)) {
      entryFiles.push(indexHtml);
    }

    // If no entry points exist in project (e.g. isolated component unit tests), return all components
    if (entryFiles.length === 0) {
      return new Set(classNameMap.keys());
    }

    const toClassName = (name) => {
      const base = name.replace(/\.component\.js$/, '');
      return base
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    };

    const rootComponents = new Set();

    entryFiles.forEach((filePath) => {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');

      // 1. Scan template tags
      const tagRegex = /<([a-zA-Z0-9_-]+)\b/g;
      let match;
      while ((match = tagRegex.exec(content)) !== null) {
        const rawTag = match[1];
        if (classNameMap.has(rawTag)) {
          rootComponents.add(rawTag);
        } else {
          const className = toClassName(rawTag);
          if (classNameMap.has(className)) {
            rootComponents.add(className);
          }
        }
      }

      // 2. Scan JS imports
      const importRegex = /import\s+(?:[\s\w$,{}*]*?\s+from\s+['"](.*?)['"]|['"](.*?)['"]);?/g;
      while ((match = importRegex.exec(content)) !== null) {
        const importSpecifier = match[1] || match[2];
        if (importSpecifier && importSpecifier.startsWith('.')) {
          let resolved = path.resolve(path.dirname(filePath), importSpecifier);
          if (!resolved.endsWith('.js')) {
            if (fs.existsSync(`${resolved}.component.js`)) {
              resolved = `${resolved}.component.js`;
            } else if (fs.existsSync(`${resolved}.js`)) {
              resolved = `${resolved}.js`;
            }
          }
          const targetClassName = pathToClassName.get(resolved);
          if (targetClassName) {
            rootComponents.add(targetClassName);
          }
        }
      }
    });

    // BFS transitive dependency traversal
    const usedComponents = new Set(rootComponents);
    const queue = Array.from(rootComponents);

    while (queue.length > 0) {
      const current = queue.shift();
      const deps = graph.get(current) || [];
      deps.forEach((dep) => {
        if (!usedComponents.has(dep)) {
          usedComponents.add(dep);
          queue.push(dep);
        }
      });
    }

    return usedComponents;
  }

  /**
   * Processes all pages in the src/pages folder recursively.
   * @returns {{pagesJs: string, registrations: string}} The compiled pages code and their registrations.
   * @private
   */
  processPages() {
    let pagesJs = '';
    let registrations = '';
    const pageDir = path.join(this.srcDir, 'pages');

    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;

      fs.readdirSync(dir).forEach((file) => {
        const fullPath = path.join(dir, file);

        if (fs.statSync(fullPath).isDirectory()) {
          scan(fullPath);
        } else if (file.endsWith('.page.js')) {
          logger.info(`[Compiling Page] ${file}`);

          const name = path
            .basename(file, '.page.js')
            .split(/[-_]/)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');

          const originalSource = fs.readFileSync(fullPath, 'utf-8');
          const compiled = this.componentParser.parse(fullPath, 'page');
          const lineCount = compiled.split(/\r?\n/).length;

          if (this.__bundleSections) {
            this.__bundleSections.push({
              filePath: path.relative(this.rootDir, fullPath),
              originalCode: originalSource,
              startLine: pagesJs.split(/\r?\n/).length,
              lineCount,
            });
          }

          pagesJs += compiled;
          registrations += `app.registerPage('${name}', ${name});\n`;
        }
      });
    };

    scan(pageDir);

    return { pagesJs, registrations };
  }

  /**
   * Processes the main application entry point.
   * @param {string} registrations - The bridge and page registration code to inject.
   * @returns {string} The wrapped main application code.
   * @private
   */

  /**
   * Compiles a single component file.
   * @param {string} filePath
   * @returns {string}
   */
  compileComponent(filePath) {
    return this.componentParser.parse(filePath);
  }

  /**
   * Compiles a single page file.
   * @param {string} filePath
   * @returns {string}
   */
  compilePage(filePath) {
    return this.componentParser.parse(filePath, 'page');
  }

  /**
   * Processes the main application file.
   * @param {Array<string>} registrations - Mapped component registration lines.
   */
  processMain(registrations) {
    const mainFile = path.join(this.srcDir, 'main.app.js');

    if (fs.existsSync(mainFile)) {
      let main = rewriteRuntimeImports(replaceEnvVariables(fs.readFileSync(mainFile, 'utf-8')));

      if (registrations) {
        let appName = 'app';

        const appMatch = main.match(/(?:const|let|var)?\s*([\w$.]+)\s*=\s*new\s+AvenxApp\(/);

        if (appMatch) {
          appName = appMatch[1].trim();
        }

        if (appName !== 'app') {
          registrations = registrations.replace(/\bapp\.register/g, `${appName}.register`);
        }

        if (main.includes('// @avenx-inject')) {
          main = main.replace('// @avenx-inject', registrations);
        } else {
          const appDeclRegex = /((?:const|let|var)?\s*[\w$.]+\s*=\s*new\s+AvenxApp\([\s\S]*?\);?)/;

          if (appDeclRegex.test(main)) {
            main = main.replace(appDeclRegex, `$1\n${registrations}`);
          }
        }
      }

      return `\n(function(){\n${main}\n})();`;
    }

    return '';
  }
}

export default AvenxCompiler;
