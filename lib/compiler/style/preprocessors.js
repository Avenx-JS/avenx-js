import { createRequire } from 'module';
import { logger } from '../../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { StyleCompilerError } from '../errors/index.js';
import { reportWarning } from '../utils/warningReporter.js';

// Keep optional dependency resolution anchored at the original public module.
const require = createRequire(new URL('../StyleProcessor.js', import.meta.url));

/** Optional CSS processors, cached for one StyleProcessor lifetime. */
export class StylePreprocessors {
  #reportedMissingPreprocessors = new Set();
  #requireModuleCache = new Map();

  /** Starts a build's warning set while retaining optional-module resolution. */
  resetWarnings() {
    this.#reportedMissingPreprocessors = new Set();
  }

  /**
   * Resolves one optional dependency once.
   * @param {string} name - Package name.
   * @returns {any} Loaded package or null.
   */
  #requireModule(name) {
    if (this.#requireModuleCache.has(name)) {
      return this.#requireModuleCache.get(name);
    }
    let mod = null;
    try {
      mod = require(name);
    } catch {
      // Ignore error if module cannot be loaded
    }
    this.#requireModuleCache.set(name, mod);
    return mod;
  }

  /**
   * Reports a missing package once per build.
   * @param {string} type - Processor syntax.
   * @param {string} packageName - Package name.
   * @param {object|null} config - Diagnostic configuration.
   */
  #reportMissingPreprocessor(type, packageName, config) {
    if (this.#reportedMissingPreprocessors.has(packageName)) {
      return;
    }
    this.#reportedMissingPreprocessors.add(packageName);
    reportWarning(
      AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING,
      new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, type, packageName),
      config,
    );
  }

  /**
   * Runs the selected optional processor.
   * @param {string} cssContent - Authored CSS.
   * @param {string} type - Processor syntax.
   * @param {object|null} config - Diagnostic configuration.
   * @returns {string} Compiled CSS or the original fallback.
   */
  preprocessCss(cssContent, type, config) {
    if (!type || type === 'none') return cssContent;

    try {
      if (type === 'sass' || type === 'scss') {
        const packageName = 'sass';
        const sass = this.#requireModule(packageName);
        if (!sass) {
          this.#reportMissingPreprocessor(type, packageName, config);
          return cssContent;
        }
        const result = sass.compileString(cssContent, {
          syntax: type === 'sass' ? 'indented' : 'scss',
        });
        return result.css;
      }

      if (type === 'postcss') {
        const packageName = 'postcss';
        const postcss = this.#requireModule(packageName);
        if (!postcss) {
          this.#reportMissingPreprocessor(type, packageName, config);
          return cssContent;
        }
        const result = postcss([]).process(cssContent);
        return result.css;
      }

      if (type === 'less') {
        const packageName = 'less';
        const less = this.#requireModule(packageName);
        if (!less) {
          this.#reportMissingPreprocessor(type, packageName, config);
          return cssContent;
        }
        let output = cssContent;
        less.render(cssContent, { syncImport: true }, (err, result) => {
          if (err) throw err;
          output = result.css;
        });
        return output;
      }
    } catch (err) {
      logger.error(new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_FAILED, type, err.message).message);
      return cssContent;
    }

    return cssContent;
  }
}

/**
 * Compiles a block within the same placeholder wrapper.
 * @param {string} rawGlobalCss - Global stylesheet context.
 * @param {string} blockBody - Block body.
 * @param {string} preprocessor - Syntax.
 * @param {Function} compile - CSS compiler.
 * @param {Function} filter - Placeholder rule filter.
 * @returns {string} The result.
 */
export function preprocessBlock(rawGlobalCss, blockBody, preprocessor, compile, filter) {
  const placeholder = '__avenx_temp_class__';
  const input = `${rawGlobalCss}\n\n.${placeholder} {\n${blockBody}\n}`;
  const compiled = compile(input, preprocessor);
  if (compiled === input) {
    return blockBody;
  }
  return filter(compiled, placeholder);
}
