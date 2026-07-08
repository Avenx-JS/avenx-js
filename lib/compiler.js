const fs = require('fs');
const path = require('path');
const loadConfig = require('./config');
const StyleProcessor = require('./compiler/StyleProcessor');
const ComponentParser = require('./compiler/ComponentParser');
const { logger } = require('./core/runtime/AvenxLogger');

const BUNDLE_SIZE_WARNING_THRESHOLD_KB = 50;

const AvenxCompilerErrors = {
  AVX_C01: 'Could not create dist directory at "{0}".',
  AVX_C02: '"src" directory not found at "{0}". Run "avenx init" to scaffold a project.',
  AVX_C03:
    'Duplicate component name(s) detected. These files compile to the same class name:\n{0}\n' +
    'Fix by renaming or moving one of the files (e.g. "card.component.js" -> "profile-card.component.js").',
};

/**
 * Formats a compiler error message with provided code and arguments.
 * @param {string} code - The compiler error code.
 * @param {...any} args - The arguments to replace in the error message template.
 * @returns {string} The formatted error message.
 */
function formatCompilerError(code, ...args) {
  let message = AvenxCompilerErrors[code] || 'An unknown compiler error occurred.';
  args.forEach((arg, idx) => {
    message = message.replace(`{${idx}}`, String(arg));
  });
  return `[${code}] ${message}`;
}

/**
 * AvenxCompiler is the main orchestrator for the Avenx-JS build process.
 * It coordinates the parsing of components, processing of styles, and the
 * final bundling of the application.
 */
class AvenxCompiler {
  /**
   * Creates an instance of AvenxCompiler and initializes its sub-processors.
   * Uses the current working directory as the project root.
   */
  constructor() {
    /**
     * The root directory of the project.
     * @type {string}
     */
    this.rootDir = process.cwd();
    const config = loadConfig();

    // Configure logger for build-time compiler
    logger.configure({
      level: (config.logging && config.logging.level) || 'info',
      silent:
        (config.logging &&
          (config.logging.silent || config.logging.level === 'silent' || config.logging.level === 'off')) ||
        false,
      formatter: (level, args) => args, // CLI output doesn't need prefixes for generic info logs
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
     * @type {StyleProcessor}
     */
    this.styleProcessor = new StyleProcessor();
    /**
     * @type {ComponentParser}
     */
    this.componentParser = new ComponentParser(this.styleProcessor);

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
        logger.error(`❌ ${formatCompilerError('AVX_C01', this.distDir)}`);
      }
    }
  }

  /**
   * Executes the full build process.
   * Includes resetting style processor, generating runtime, processing bridges, components, and main app.
   */
  build() {
    logger.info('--- Avenx-JS Compiler ---');

    if (!fs.existsSync(this.srcDir)) {
      logger.error(`❌ ${formatCompilerError('AVX_C02', this.srcDir)}`);
      return;
    }

    this.styleProcessor.reset();

    let bundleJs = this.getRuntime();
    const bridgeData = this.processBridges();
    bundleJs += this.processGuards();

    try {
      bundleJs += this.processComponents();
    } catch (err) {
      logger.error(`❌ ${err.message}`);
      return; // halt build — do not write dist files
    }

    const pageData = this.processPages();
    bundleJs += pageData.pagesJs;
    bundleJs += this.processMain((bridgeData.registrations || '') + '\n' + (pageData.registrations || ''));

    fs.writeFileSync(path.join(this.distDir, 'bundle.js'), bundleJs);
    fs.writeFileSync(path.join(this.distDir, 'bundle.css'), this.styleProcessor.getGlobalStyles());

    const files = ['bundle.js', 'bundle.css'];

    logger.info('\nAsset sizes:');

    files.forEach((file) => {
      const filePath = path.join(this.distDir, file);
      const bytes = fs.statSync(filePath).size;
      const sizeKb = bytes / 1024;

      logger.info(`${file}: ${sizeKb.toFixed(2)} KB`);

      if (sizeKb > BUNDLE_SIZE_WARNING_THRESHOLD_KB) {
        logger.warn(`WARNING: ${file} exceeds ${BUNDLE_SIZE_WARNING_THRESHOLD_KB} KB (${sizeKb.toFixed(2)} KB)`);
      }
    });

    logger.info('-----------------------');
    logger.info(`\nBuild erfolgreich: ${this.distDir}/bundle.js & ${this.distDir}/bundle.css`);
  }

  /**
   * Reads the core runtime files and prepares them for the bundle.
   * Strips imports and exports for a single-file bundle.
   * @returns {string} The concatenated runtime source code.
   * @private
   */
  getRuntime() {
    const runtimeFiles = [
      'runtime/AvenxError.js',
      'runtime/AvenxLogger.js',
      'reactive/watcher.js',
      'security/evaluator.js',
      'security/escapeHtml.js',
      'reactive/proxyHandler.js',
      'reactive/createState.js',
      'reactive/createComputed.js',
      'renderer/renderTemplate.js',
      'renderer/domPatch.js',
      'renderer/listManager.js',
      'events/eventExecutor.js',
      'events/bindEvents.js',
      'runtime/lifecycle.js',
      'runtime/AvenxBridge.js',
      'runtime/AvenxComponent.js',
      'runtime/AvenxPage.js',
      'runtime/AvenxGuard.js',
      'runtime/AvenxRouter.js',
      'runtime/AvenxApp.js',
    ];

    return runtimeFiles
      .map((file) => fs.readFileSync(path.join(this.coreDir, file), 'utf-8'))
      .map((source) => source.replace(/^import\s+.*?;\s*$/gm, '').replace(/export\s+/g, ''))
      .join('\n');
  }

  /**
   * Processes bridge registrations from the global directory.
   * @returns {{registrations: string}} The registration code for bridges.
   * @private
   */
  processBridges() {
    const globalDir = path.join(this.srcDir, 'global');
    let registrations = '';
    if (fs.existsSync(globalDir)) {
      fs.readdirSync(globalDir).forEach((file) => {
        if (file.endsWith('.bridge.js')) {
          const name = path.basename(file, '.bridge.js');
          const capitalizedName =
            name
              .split(/[-_]/)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join('') + 'Bridge';

          logger.info(`[Bridge] ${capitalizedName}`);
          const content = fs.readFileSync(path.join(globalDir, file), 'utf-8');
          const match = content.match(/export\s+default\s+([\s\S]*)/);
          if (match) {
            const objStr = match[1].trim().replace(/;$/, '');
            registrations += `app.registerBridge('${capitalizedName}', ${objStr});\n`;
          }
        }
      });
    }
    return { registrations };
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
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const cleaned = content
        .replace(/^import\s+.*?;\s*$/gm, '')
        .replace(/import\s+.*?\s+from\s+['"].*?['"];?/gm, '')
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
   * @returns {string} The concatenated source code of all compiled components.
   * @private
   */
  processComponents() {
    let componentsJs = '';
    const compDir = path.join(this.srcDir, 'components');
    const classNameMap = new Map(); // className -> [file paths]

    // Same naming convention used elsewhere in this file (bridges/guards)
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
          if (!classNameMap.has(className)) classNameMap.set(className, []);
          classNameMap.get(className).push(fullPath);
        }
      });
    };

    scan(compDir);

    // Halt the build if any two files would generate the same class name
    const duplicates = [...classNameMap.entries()].filter(([, paths]) => paths.length > 1);
    if (duplicates.length > 0) {
      const details = duplicates
        .map(([className, paths]) => `  "${className}":\n${paths.map((p) => `    - ${p}`).join('\n')}`)
        .join('\n');
      throw new Error(formatCompilerError('AVX_C03', details));
    }

    // Safe to compile now — no name collisions
    classNameMap.forEach((paths) => {
      const fullPath = paths[0];
      logger.info(`[Compiling] ${path.basename(fullPath)}`);
      componentsJs += this.componentParser.parse(fullPath);
    });

    return componentsJs;
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
          pagesJs += this.componentParser.parse(fullPath, 'page');
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
  processMain(registrations) {
    const mainFile = path.join(this.srcDir, 'main.app.js');
    if (fs.existsSync(mainFile)) {
      let main = fs
        .readFileSync(mainFile, 'utf-8')
        .replace(/import\s*{\s*AvenxApp\s*}\s*from\s*['"].*?['"];?/g, '')
        .replace(/import\s+.*?\s+from\s+['"].*?['"];?/gm, '');

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

module.exports = AvenxCompiler;
