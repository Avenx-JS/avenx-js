import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from './config.js';
const findProjectRoot = loadConfig.findProjectRoot;
import StyleProcessor from './compiler/StyleProcessor.js';
import ComponentParser from './compiler/ComponentParser.js';
import { logger } from './core/runtime/AvenxLogger.js';
import { performance } from 'perf_hooks';
import { AvenxErrorCodes, formatMessage } from './core/runtime/AvenxError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUNDLE_SIZE_WARNING_THRESHOLD_KB = 50;
/**
 * Formats a compiler error message with provided code and arguments.
 * @param {string} code - The compiler error code.
 * @param {...any} args - The arguments to replace in the error message template.
 * @returns {string} The formatted error message.
 */
function formatCompilerError(code, ...args) {
  return formatMessage(code, ...args);
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
    this.styleProcessor = new StyleProcessor(config.style || {});
    /**
     * @type {ComponentParser}
     */
    this.componentParser = new ComponentParser(this.styleProcessor, config.voidTags);

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
        logger.error(`❌ ${formatCompilerError(AvenxErrorCodes.COMPILER_DIST_CREATION_FAILED, this.distDir)}`);
      }
    }
  }

  /**
   * Executes the full build process.
   * Includes resetting style processor, generating runtime, processing bridges, components, and main app.
   */
  build() {
    logger.info('--- Avenx-JS Compiler ---');
    const startTime = performance.now();

    if (!fs.existsSync(this.srcDir)) {
      logger.error(`❌ ${formatCompilerError(AvenxErrorCodes.COMPILER_SRC_DIR_MISSING, this.srcDir)}`);
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

    const jsFileName = `${this.outputName}.js`;
    const cssFileName = `${this.outputName}.css`;

    fs.writeFileSync(path.join(this.distDir, jsFileName), bundleJs);
    fs.writeFileSync(path.join(this.distDir, cssFileName), this.styleProcessor.getGlobalStyles());

    const files = [jsFileName, cssFileName];

    logger.info('\nAsset sizes:');

    files.forEach((file) => {
      const filePath = path.join(this.distDir, file);
      const bytes = fs.statSync(filePath).size;
      const sizeKb = bytes / 1024;

      logger.info(`${file}: ${sizeKb.toFixed(2)} KB`);

      if (sizeKb > BUNDLE_SIZE_WARNING_THRESHOLD_KB) {
        logger.warn(
          formatMessage(
            AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED,
            file,
            BUNDLE_SIZE_WARNING_THRESHOLD_KB,
            sizeKb.toFixed(2)
          )
        );
      }
    });

    logger.info('-----------------------');
    logger.info(`\nBuild erfolgreich: ${this.distDir}/${jsFileName} & ${this.distDir}/${cssFileName}`);

    const endTime = performance.now();
    logger.info(`Build completed in ${Math.round(endTime - startTime)} ms`);
  }

  /**
   * Reads the core runtime bundle file.
   * @returns {string} The concatenated runtime source code.
   * @private
   */
  getRuntime() {
    const runtimePath = path.join(__dirname, '../dist/runtime.js');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    return content.replace(/import\s+(?:[\s\w$,{}*]*?\s+from\s+['"].*?['"]|['"].*?['"]);?\r?\n?/g, '');
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
        .replace(/import\s+(?:[\s\w$,{}*]*?\s+from\s+['"].*?['"]|['"].*?['"]);?\r?\n?/g, '')
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
    const classNameMap = new Map();

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
        }
      });
    };

    scan(compDir);

    const duplicates = [...classNameMap.entries()].filter(([, paths]) => paths.length > 1);

    if (duplicates.length > 0) {
      const details = duplicates
        .map(([className, paths]) => `  "${className}":\n${paths.map((p) => `    - ${p}`).join('\n')}`)
        .join('\n');

      throw new Error(formatCompilerError(AvenxErrorCodes.COMPILER_DUPLICATE_COMPONENT_NAME, details));
    }

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
      let main = fs
        .readFileSync(mainFile, 'utf-8')
        .replace(/import\s+(?:[\s\w$,{}*]*?\s+from\s+['"].*?['"]|['"].*?['"]);?\r?\n?/g, '');

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
