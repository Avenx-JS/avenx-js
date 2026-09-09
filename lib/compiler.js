import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import loadConfig from './config.js';
const findProjectRoot = loadConfig.findProjectRoot;
import StyleProcessor from './compiler/StyleProcessor.js';
import ComponentParser from './compiler/ComponentParser.js';
import {
  analyzeBridgeFile,
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
import { assertValidOutputs } from './compiler/bundle/validate.js';
import { NAMESPACE_GLOBAL, PUBLIC_GLOBALS } from './core/globals.js';
import { buildSidecar, sidecarFileName } from './compiler/sourceMapTrace.js';
import {
  bridgeModule,
  componentModule,
  devtoolsModule,
  entryModule,
  globalsModule,
  rewindConfigModule,
} from './compiler/modules.js';
import { bundle, ResolveError, BindingError, DynamicImportError, EmitError, ModuleParseError } from './bundler/index.js';
import { AppModel } from './compiler/atlas/AppModel.js';
import { addBridgeUnit, addRenderEdges } from './compiler/atlas/build.js';
import { addRoutesAndGuards } from './compiler/atlas/routes.js';
import { atlasFileName, serializeAtlas } from './compiler/atlas/emit.js';
import { reportAtlasDiagnostics } from './compiler/atlas/diagnostics.js';
import { reportRewindDiagnostics } from './compiler/rewind/diagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Default size above which a build warns about the JavaScript it produced.
 *
 * Raised from 50 KB when the bundler replaced the concatenator, because 50 KB
 * was never satisfiable: the framework runtime alone is several times that, so
 * AVX_W01 fired on `avenx init` output and on every build after it. A warning
 * that always fires is a warning nobody reads, and it made the repository's own
 * bundle-size CI gate permanently red.
 *
 * The number is a ceiling for the whole bundle -- runtime included -- chosen to
 * sit above what an application of a few dozen components costs and to fire
 * when something large joins the graph. `bundleSizeWarningKb` in
 * avenx.config.json overrides it, because the honest number depends on what the
 * application is.
 * @type {number}
 */
const BUNDLE_SIZE_WARNING_THRESHOLD_KB = 600;

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
    this.componentParser.renderFallbacks = [];
    this.__bridgeConsumerFiles = null;
    this.__bridgeConsumerSources = null;
    this.beginModel();

    /**
     * The modules the compiler generates, keyed by the path they stand for.
     *
     * A component's module is keyed by the component file's own path, so an
     * `import './counter.component.js'` written by a developer resolves to the
     * compiled class rather than to the template source, which is not
     * JavaScript and would not parse.
     * @type {Map<string, string>}
     */
    const virtualModules = new Map();

    /** @type {Array<{name: string, file: string, kind: string}>} */
    const registrations = [];

    const bridgeData = this.processBridges(virtualModules, registrations);
    this.componentParser.setBridges(bridgeData.bridges);
    // Every component and page name, discovered up front so a template tag can
    // be validated against the whole project (AVX_W46) as each file is parsed.
    this.collectComponentNames();
    this.validateBridgeUsage(bridgeData.bridges);
    // Guards resolve their bridge imports the way everything else does now:
    // through the module graph, from the import the developer wrote.
    this.__guardBridges = bridgeData.bridges;
    this.processGuards(virtualModules);
    this.processComponents(virtualModules);
    this.processPages(virtualModules, registrations);

    const jsFileName = `${this.outputName}.js`;
    const jsMapFileName = `${this.outputName}.js.map`;
    const cssFileName = `${this.outputName}.css`;
    const traceMapFileName = sidecarFileName(this.outputName);
    const atlasMapFileName = atlasFileName(this.outputName);

    const shouldEmitJsMap =
      this.config.sourceMap === true ||
      this.config.sourcemap === true ||
      (!this.production && this.config.sourceMap !== false);

    const entryId = this.buildEntryModule(virtualModules, registrations);

    const result = this.runBundler({
      entryId,
      virtualModules,
      sourceMap: shouldEmitJsMap,
      file: jsFileName,
    });

    let bundleJs = result.code;
    if (shouldEmitJsMap) {
      bundleJs += `\n//# sourceMappingURL=${jsMapFileName}\n`;
    }

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
      includeSources: this.includedStylesheets(result.included),
    });
    const sourceMap = this.styleProcessor.getSourceMap(this.distDir, cssFileName);
    const cssWithMapComment = isDevMode ? baseCssContent : baseCssContent + `\n/*# sourceMappingURL=${cssFileName}.map */\n`;

    // The trace sidecar maps recorded action and computed names back to a file
    // and a line. It sits beside the bundle and is never referenced by it, so
    // an application that records no traces downloads nothing extra and a
    // deployment that does not want the file simply does not upload it.
    const traceSidecar = buildSidecar(this.componentParser.locations, bridgeData.bridges, this.rootDir);

    // The Atlas is finished here, after every unit has been parsed, and sits
    // beside the bundle on the same terms as the trace sidecar: never
    // referenced by it, so it costs a browser nothing.
    this.reportRenderFallbacks();

    this.finishModel();
    reportAtlasDiagnostics(this.model, this.config);
    reportRewindDiagnostics(this.model, this.config);
    const atlasJson = serializeAtlas(this.model, {
      srcDir: path.relative(this.rootDir, this.srcDir).split(path.sep).join('/') || '.',
    });

    const files = [jsFileName, cssFileName, `${cssFileName}.map`, traceMapFileName, atlasMapFileName];
    if (shouldEmitJsMap) {
      files.push(jsMapFileName);
    }

    const outputs = new Map([
      [jsFileName, bundleJs],
      [cssFileName, cssWithMapComment],
      [`${cssFileName}.map`, JSON.stringify(sourceMap, null, 2)],
      [traceMapFileName, JSON.stringify(traceSidecar, null, 2)],
      [atlasMapFileName, atlasJson],
    ]);

    if (shouldEmitJsMap) {
      outputs.set(jsMapFileName, JSON.stringify(result.map, null, 2));
    }

    // A build may not report success unless what it produced parses. The check
    // runs before anything is written, so a bundle that does not parse never
    // reaches distDir and the previous build is left intact.
    assertValidOutputs(outputs);

    // Every artifact is produced before any of them is written, and written to
    // a staging directory before any of them is promoted. Writing bundle.js
    // first and then failing while producing the CSS used to leave a new script
    // beside a stale stylesheet — output that never existed as a whole build.
    const staging = this.writeStaging(outputs);

    try {
      this.reportBundleStats(result.stats);
      logger.info('\nAsset sizes:');

      files.forEach((file) => {
        const filePath = path.join(staging, file);
        const bytes = fs.statSync(filePath).size;
        const sizeKb = bytes / 1024;

        // The transferred size is what a browser actually pays, and it is the
        // number that moved least when the bundler replaced esbuild's mangling
        // minifier with Avenx's conservative one. Reporting only the raw figure
        // would tell a developer the wrong story about their own bundle.
        const transferred =
          file.endsWith('.js') || file.endsWith('.css')
            ? ` (${(zlib.gzipSync(fs.readFileSync(filePath)).length / 1024).toFixed(2)} KB gzipped)`
            : '';

        logger.info(`${file}: ${sizeKb.toFixed(2)} KB${transferred}`);

        // The trace sidecar and the Atlas are build artifacts for the CLI,
        // not something a browser downloads, so neither is weighed against the
        // bundle budget.
        if (file !== traceMapFileName && file !== atlasMapFileName && sizeKb > this.bundleSizeWarningKb()) {
          // Escalating AVX_W01 to an error throws from here. That happens
          // before promotion, so the size limit is enforced on output that
          // never reaches distDir.
          reportWarning(
            AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED,
            new BuildError(
              AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED,
              file,
              this.bundleSizeWarningKb(),
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

    return { mode: this.mode, distDir: this.distDir, files, durationMs, bundle: result.stats };
  }

  /**
   * The size above which the build warns about the JavaScript it produced.
   *
   * Configurable because the honest number depends on what an application is.
   * The default is a ceiling for the whole bundle including the runtime, not a
   * budget for application code, and a threshold nothing can satisfy is a
   * threshold everyone learns to ignore.
   * @returns {number} The threshold in KB.
   * @private
   */
  bundleSizeWarningKb() {
    const configured = this.config && this.config.bundleSizeWarningKb;
    return typeof configured === 'number' && configured > 0 ? configured : BUNDLE_SIZE_WARNING_THRESHOLD_KB;
  }

  /**
   * Assembles the module the bundle is rooted at.
   *
   * `main.app.js` stays the developer's file. What the compiler discovered for
   * them -- the pages under `src/pages/`, the bridges something imports -- is
   * added as ordinary imports and registration calls, in the same place the old
   * pipeline injected them.
   * @param {Map<string, string>} virtualModules - The generated module table.
   * @param {Array<object>} registrations - Units to import and register.
   * @returns {string} The entry module's id.
   * @private
   */
  buildEntryModule(virtualModules, registrations) {
    const prelude = [];

    const globalsId = path.join(this.srcDir, '__avenx_globals__.js');
    virtualModules.set(globalsId, globalsModule(PUBLIC_GLOBALS, NAMESPACE_GLOBAL));
    prelude.push(globalsId);

    // Development builds carry the trace recorder, because `avenx serve
    // --trace` installs it through the namespace. Production builds do not
    // reference it, so it is shaken out -- which is the difference between the
    // two modes, and the whole of it.
    if (!this.production) {
      const devtoolsId = path.join(this.srcDir, '__avenx_devtools__.js');
      virtualModules.set(devtoolsId, devtoolsModule(NAMESPACE_GLOBAL));
      prelude.push(devtoolsId);
    }

    const rewindSettings = this.rewindSettings();
    if (rewindSettings) {
      const rewindId = path.join(this.srcDir, '__avenx_rewind__.js');
      virtualModules.set(rewindId, rewindConfigModule(rewindSettings));
      prelude.push(rewindId);
    }

    const mainFile = path.join(this.srcDir, 'main.app.js');
    const source = fs.existsSync(mainFile) ? replaceEnvVariables(fs.readFileSync(mainFile, 'utf-8')) : '';

    const entryId = fs.existsSync(mainFile) ? mainFile : path.join(this.srcDir, '__avenx_entry__.js');
    virtualModules.set(entryId, entryModule({ source, registrations, prelude }));
    return entryId;
  }

  /**
   * Runs the bundler and translates its failures into build diagnostics.
   *
   * Each of these used to be silence. An unresolvable import was deleted, a
   * mistyped named import became `undefined`, and the build said it had
   * succeeded. Turning them into coded, located errors is the point of the
   * migration, so the translation is explicit rather than a generic wrapper.
   * @param {object} options - Bundling options.
   * @param {string} options.entryId - The entry module id.
   * @param {Map<string, string>} options.virtualModules - Generated modules.
   * @param {boolean} options.sourceMap - Whether to emit a source map.
   * @param {string} options.file - The output file name.
   * @returns {{code: string, map: object|null, stats: object}} The bundle.
   * @throws {BuildError} When the application does not link.
   * @private
   */
  runBundler({ entryId, virtualModules, sourceMap, file }) {
    const treeShake = !(this.config && (this.config.treeShake === false || this.config.treeShakeComponents === false));
    const shouldMinify =
      this.config && typeof this.config.minify === 'boolean' ? this.config.minify : this.production;

    try {
      return bundle({
        entries: [entryId],
        virtualModules,
        rootDir: this.rootDir,
        treeShake,
        minify: shouldMinify,
        sourceMap,
        file,
      });
    } catch (error) {
      throw this.describeBundleFailure(error);
    }
  }

  /**
   * Turns a bundler error into a located BuildError.
   * @param {Error} error - What the bundler threw.
   * @returns {Error} A BuildError, or the original when it is not ours.
   * @private
   */
  describeBundleFailure(error) {
    const relative = (file) => (file && path.isAbsolute(file) ? path.relative(this.rootDir, file) : file || 'the bundle');

    if (error instanceof ResolveError) {
      return new BuildError(
        AvenxErrorCodes.COMPILER_UNRESOLVED_IMPORT,
        error.specifier,
        relative(error.importer),
        error.reason,
      );
    }
    if (error instanceof BindingError) {
      return new BuildError(
        AvenxErrorCodes.COMPILER_MISSING_EXPORT,
        relative(error.importer),
        error.message,
        relative(error.importer),
      );
    }
    if (error instanceof DynamicImportError) {
      return new BuildError(AvenxErrorCodes.COMPILER_UNRESOLVED_IMPORT, 'a computed dynamic import', relative(error.importer), error.message);
    }
    if (error instanceof ModuleParseError) {
      return new BuildError(AvenxErrorCodes.COMPILER_MODULE_UNREADABLE, relative(error.file), error.message);
    }
    if (error instanceof EmitError) {
      // A live-binding collision is two modules publishing one bundle-scope
      // name, which is what AVX_C16 has always described.
      if (error.kind === 'live-binding-collision') {
        return new BuildError(AvenxErrorCodes.COMPILER_DUPLICATE_BUNDLE_BINDING, error.message, relative(error.file), '');
      }

      // A cycle between bridges is a bridge problem, and saying so is more use
      // than the general module-cycle message. Bridge cycles were always fatal
      // and stay fatal: a bridge's default export is a value, and a value
      // cannot cross a cycle in a browser either.
      const bridgeCycle = (error.cycles || []).find(
        (cycle) => cycle.length > 1 && cycle.every((id) => id.endsWith('.bridge.js')),
      );
      if (bridgeCycle) {
        const names = bridgeCycle.map((id) => path.basename(id, '.bridge.js'));
        return new BuildError(AvenxErrorCodes.COMPILER_BRIDGE_CIRCULAR_IMPORT, names.join(' -> '));
      }

      return new BuildError(AvenxErrorCodes.COMPILER_BUNDLE_CYCLE, error.message, relative(error.file));
    }
    return error;
  }

  /**
   * The stylesheets belonging to units that reached the bundle.
   *
   * Every component is compiled so Atlas can describe the project as written,
   * which means the style processor has seen more stylesheets than the
   * application uses. A component the bundler shook out must not leave its CSS
   * behind: the old pipeline only ever parsed the components it kept, so
   * omitting them here preserves what a developer actually observed.
   * @param {Set<string>} included - Module ids that reached the bundle.
   * @returns {Set<string>} Absolute paths of the stylesheets to emit.
   * @private
   */
  includedStylesheets(included) {
    const sheets = new Set();
    for (const id of included) {
      const match = /\.(component|page)\.js$/.exec(id);
      if (!match) continue;
      sheets.add(id.replace(/\.(component|page)\.js$/, `.${match[1]}.css`));
    }
    return sheets;
  }

  /**
   * Reports what the bundle contains, and what was left out.
   *
   * The old build could not have printed this: the runtime arrived as one
   * prebuilt file, so there was no count of modules and no notion of a module
   * being dropped. Printing it now is the same house rule the render-program
   * fallback follows -- say what the build did, including what it removed.
   * @param {object} stats - The bundler's report.
   * @private
   */
  reportBundleStats(stats) {
    if (!stats) return;
    const parts = [`${stats.modulesEmitted} modules`];
    if (stats.modulesShaken > 0) {
      parts.push(`${stats.modulesShaken} shaken out`);
    }
    if (stats.externals > 0) {
      parts.push(`${stats.externals} from node_modules`);
    }
    logger.info(`\nBundled ${parts.join(' · ')}`);
  }

  /**
   * Reports templates that could not be compiled to a render program.
   *
   * A component without a program still renders correctly -- it takes the
   * string renderer, which re-renders and re-diffs the whole template on every
   * update. That is a real and invisible cost, so it is named. The same house
   * rule Atlas follows: an analysis that stopped short says where.
   * @private
   */
  reportRenderFallbacks() {
    const fallbacks = this.componentParser.renderFallbacks;
    if (!fallbacks || fallbacks.length === 0) {
      return;
    }

    // Grouped by reason rather than listed per component: "eleven templates
    // contain a list" is one thing to act on, eleven lines are eleven.
    const byReason = new Map();
    for (const entry of fallbacks) {
      if (!byReason.has(entry.reason)) {
        byReason.set(entry.reason, []);
      }
      byReason.get(entry.reason).push(entry.name);
    }

    const detail = [...byReason.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([reason, names]) => `  ${reason}: ${names.sort().join(', ')}`)
      .join('\n');

    reportWarning(
      AvenxErrorCodes.COMPILER_RENDER_NOT_COMPILED,
      new BuildError(AvenxErrorCodes.COMPILER_RENDER_NOT_COMPILED, fallbacks.length, detail),
      this.config,
    );
  }

  /**
   * The Rewind journal settings this project overrides, if any.
   *
   * A project that leaves `rewind` alone produces no configuration module at
   * all, so the defaults baked into the journal are the only thing shipped.
   * @returns {object|null} The settings, or null when there are none.
   * @private
   */
  rewindSettings() {
    const rewind = this.config && this.config.rewind;
    if (!rewind) return null;

    const settings = {};
    if (rewind.onConflict && rewind.onConflict !== 'safe') {
      settings.onConflict = rewind.onConflict;
    }
    if (typeof rewind.maxSnapshotItems === 'number' && rewind.maxSnapshotItems !== 10000) {
      settings.maxSnapshotItems = rewind.maxSnapshotItems;
    }
    return Object.keys(settings).length > 0 ? settings : null;
  }

  /**
   * Starts a fresh Atlas model for this run and attaches it to the parser.
   *
   * Called at the top of both `build` and `analyze` so a compiler instance can
   * be reused — `avenx watch` does exactly that — without the second run
   * inheriting the first run's nodes.
   * @returns {AppModel} The model being populated.
   */
  beginModel() {
    this.model = new AppModel();
    this.componentParser.setRootDir(this.rootDir);
    this.componentParser.setModel(this.model);
    return this.model;
  }

  /**
   * Completes the Atlas model once every unit has been parsed.
   *
   * Render edges are resolved here rather than during parsing because a
   * component's template can name a child that has not been compiled yet, and
   * an edge to a node that does not exist yet would be dropped.
   * @returns {AppModel} The finished model.
   * @private
   */
  finishModel() {
    const known = new Map();
    for (const unit of this.componentParser.__atlasUnits) {
      known.set(unit.name, `${unit.kind}:${unit.name}`);
    }

    for (const unit of this.componentParser.__atlasUnits) {
      addRenderEdges(this.model, {
        ownerId: `${unit.kind}:${unit.name}`,
        content: unit.content,
        masked: unit.masked,
        starts: unit.starts,
        file: path.relative(this.rootDir, unit.filePath).split(path.sep).join('/'),
        known,
      });
    }

    addRoutesAndGuards(this.model, { srcDir: this.srcDir, rootDir: this.rootDir });

    return this.model;
  }

  /**
   * Builds the Atlas model without emitting a bundle.
   *
   * `avenx atlas`, `avenx impact` and `avenx why` need the model and nothing
   * else, and writing a bundle to answer a query would be both slow and rude
   * — it would overwrite whatever is in `dist/`. The work here is the same
   * parse the build performs, so the two can never disagree.
   * @param {object} [options] - Analysis options.
   * @param {boolean} [options.tolerant] - Record a failing phase on the model
   *   and carry on, rather than throwing. Defaults to true, because a query is
   *   often asked precisely because the project is broken.
   * @returns {AppModel} The finished model.
   */
  analyze(options = {}) {
    if (!fs.existsSync(this.srcDir)) {
      throw new BuildError(AvenxErrorCodes.COMPILER_SRC_DIR_MISSING, this.srcDir);
    }

    const tolerant = options.tolerant !== false;
    this.__analyzing = true;

    this.styleProcessor.reset();
    this.__bridgeConsumerFiles = null;
    this.__bridgeConsumerSources = null;
    this.beginModel();

    // A query is asked *about* code, often precisely because something is
    // wrong with it. A malformed bridge should cost the model that bridge, not
    // the whole answer, so each phase is allowed to fail on its own and the
    // failure is recorded where the caller can report it.
    const phase = (name, run) => {
      try {
        return run();
      } catch (err) {
        if (!tolerant) throw err;
        this.model.errors.push({
          phase: name,
          code: err.code || 'AVX_UNK',
          message: String(err.message || err),
        });
        return null;
      }
    };

    try {
      const bridgeData = phase('bridges', () => this.processBridges());
      this.componentParser.setBridges((bridgeData && bridgeData.bridges) || new Map());
      phase('componentNames', () => this.collectComponentNames());
      phase('components', () => this.processComponents());
      phase('pages', () => this.processPages());
      return this.finishModel();
    } finally {
      this.__analyzing = false;
    }
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
    // Guards import bridges too. Leaving them out of consumer discovery made a
    // bridge whose only importer was a guard look unreachable, so it was
    // tree-shaken out of the bundle and the guard's alias resolved to an
    // undefined identifier -- a ReferenceError that stopped the application
    // booting at all.
    scan(path.join(this.srcDir, 'guards'), '.guard.js');
    scan(path.join(this.srcDir, 'global'), '.guard.js');

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
   * A bridge file is already valid JavaScript, so this generates a module that
   * is almost the file itself: its default export is named so the runtime can
   * be told what to call it, and that is all. Its own imports -- the runtime,
   * other bridges -- stay as written and become real edges in the graph, which
   * is what replaced the old alias-and-concatenate scheme along with its
   * hand-rolled cycle detection and emission ordering.
   * @param {Map<string, string>} [virtualModules] - Generated module table to fill.
   * @param {Array<object>} [registrations] - Units to import and register.
   * @returns {{bridges: Map<string, object>}} The descriptor of every bridge,
   *   keyed by absolute path.
   * @private
   */
  processBridges(virtualModules = null, registrations = null) {
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

    // Every bridge enters the model, reachable or not: `avenx atlas` should
    // describe the project as written, and a bridge omitted from the bundle
    // for having no importer is exactly what `inspect` needs to report.
    if (this.model) {
      for (const descriptor of bridges.values()) {
        addBridgeUnit(this.model, descriptor, {
          rootDir: this.rootDir,
          source: replaceEnvVariables(fs.readFileSync(descriptor.filePath, 'utf-8')),
          bridges,
        });
      }
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

    // Emission order and cycle detection are the bundler's job now: it orders
    // the whole graph topologically and reports a cycle that carries a binding
    // which cannot cross it, rather than every cycle regardless of what it
    // carries. A bridge module is generated for each reachable bridge and the
    // graph decides the rest.
    for (const key of reachable) {
      const descriptor = bridges.get(key);
      if (!descriptor) continue;
      logger.info(`[Bridge] ${descriptor.name}`);

      if (virtualModules) {
        const source = replaceEnvVariables(fs.readFileSync(descriptor.filePath, 'utf-8'));
        virtualModules.set(
          path.resolve(descriptor.filePath),
          bridgeModule({ name: descriptor.name, binding: descriptor.binding, source }),
        );
      }
      if (registrations) {
        registrations.push({ name: descriptor.name, file: path.resolve(descriptor.filePath), kind: 'bridge' });
      }
    }

    const unused = [...bridges.values()].filter((item) => !reachable.has(path.resolve(item.filePath)));
    for (const descriptor of unused) {
      logger.info(`[Bridge] ${descriptor.name} — not imported anywhere, omitted from the bundle`);
    }

    return { bridges };
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
   * Registers guard modules with environment variables substituted.
   *
   * A guard file is already valid JavaScript -- `export default class AuthGuard
   * extends AvenxGuard` with ordinary imports -- so nothing is rewritten. The
   * bridge alias machinery this replaced existed only because
   * `rewriteRuntimeImports` deleted a guard's bridge import and left the local
   * name undefined, which reported AVX_R07 on every navigation through it.
   * With imports resolved rather than deleted, the import means what it says.
   *
   * A guard nothing imports is no longer emitted at all, where the old pipeline
   * concatenated every `.guard.js` in the project whether or not a route used
   * it.
   * @param {Map<string, string>} virtualModules - Generated module table to fill.
   * @returns {void}
   * @private
   */
  processGuards(virtualModules) {
    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.guard.js')) continue;
        const filePath = path.join(dir, file);
        const name = path
          .basename(file, '.guard.js')
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('') + 'Guard';
        logger.info(`[Guard] ${name}`);
        virtualModules.set(path.resolve(filePath), replaceEnvVariables(fs.readFileSync(filePath, 'utf-8')));
      }
    };

    scan(path.join(this.srcDir, 'global'));
    scan(path.join(this.srcDir, 'guards'));
  }

  /**
   * Collects every registered component and page name by filename and hands
   * the set to the parser before any file is compiled.
   *
   * The unresolved-component check (AVX_W46) runs per file, while a file is
   * being parsed, so it cannot rely on the running scan having reached every
   * sibling yet. Discovering all names up front from filenames — the same
   * PascalCase derivation `processComponents`/`processPages` use — means the
   * check sees the whole project regardless of the order files are visited or
   * whether tree shaking drops a component from the output.
   * @returns {Set<string>} The registered component and page names.
   * @private
   */
  collectComponentNames() {
    const names = new Set();

    const toClassName = (fileName, suffix) =>
      path
        .basename(fileName, suffix)
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

    const scan = (dir, suffix) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          scan(fullPath, suffix);
        } else if (entry.endsWith(suffix)) {
          names.add(toClassName(entry, suffix));
        }
      }
    };

    scan(path.join(this.srcDir, 'components'), '.component.js');
    scan(path.join(this.srcDir, 'pages'), '.page.js');

    this.componentParser.setComponentNames(names);
    return names;
  }

  /**
   * Compiles every component in `src/components` into an ES module.
   *
   * Every component is compiled, and the bundler decides which ones ship: a
   * component is in the bundle when something imports it, transitively from the
   * entry. That replaces `findUsedComponents`, which scanned template tags and
   * import statements with regular expressions to guess the same answer, and
   * could only ever approximate it -- a component it wrongly kept was dead
   * weight, and one it wrongly dropped was a runtime failure.
   * @param {Map<string, string>} [virtualModules] - Generated module table to fill.
   * @returns {void}
   * @private
   */
  processComponents(virtualModules = null) {
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

    orderedClasses.forEach((className) => {
      const paths = classNameMap.get(className);
      if (!paths || paths.length === 0) return;
      const fullPath = paths[0];
      logger.info(`[Compiling] ${path.basename(fullPath)}`);
      const compiled = this.componentParser.parse(fullPath);
      if (virtualModules) {
        virtualModules.set(path.resolve(fullPath), this.wrapUnit(fullPath, compiled));
      }
    });
  }

  /**
   * Frames a compiled class as an ES module.
   * @param {string} filePath - The unit's source path.
   * @param {string} compiled - The class declaration the parser produced.
   * @returns {string} The module source.
   * @private
   */
  wrapUnit(filePath, compiled) {
    const meta = this.componentParser.moduleMeta.get(path.resolve(filePath));
    if (!meta) {
      throw new BuildError(
        AvenxErrorCodes.COMPILER_MODULE_UNREADABLE,
        path.relative(this.rootDir, filePath),
        'the compiler produced no module information for this unit',
      );
    }
    return componentModule({
      className: meta.className,
      body: compiled,
      isPage: meta.isPage,
      imports: meta.imports,
      bridgeBindings: meta.bridgeBindings,
    });
  }

  /**
   * Compiles every page in `src/pages` into an ES module.
   *
   * Pages are the one unit a developer never imports: they are discovered by
   * directory and routed by name, so the entry module imports and registers
   * them on their behalf. That is the same contract as before -- what changed
   * is that the registration now names an imported binding rather than a
   * class that happened to be in scope because it had been concatenated above.
   * @param {Map<string, string>} [virtualModules] - Generated module table to fill.
   * @param {Array<object>} [registrations] - Units to import and register.
   * @returns {void}
   * @private
   */
  processPages(virtualModules = null, registrations = null) {
    const pageDir = path.join(this.srcDir, 'pages');

    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;

      fs.readdirSync(dir).forEach((file) => {
        const fullPath = path.join(dir, file);

        if (fs.statSync(fullPath).isDirectory()) {
          scan(fullPath);
          return;
        }
        if (!file.endsWith('.page.js')) return;

        logger.info(`[Compiling Page] ${file}`);

        const name = path
          .basename(file, '.page.js')
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('');

        const compiled = this.componentParser.parse(fullPath, 'page');
        if (virtualModules) {
          virtualModules.set(path.resolve(fullPath), this.wrapUnit(fullPath, compiled));
        }
        if (registrations) {
          registrations.push({ name, file: path.resolve(fullPath), kind: 'page' });
        }
      });
    };

    scan(pageDir);
  }

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

}

export default AvenxCompiler;
