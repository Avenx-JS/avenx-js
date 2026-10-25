import { createCompiler } from './compiler.js';
import { handleAvenxHotUpdate } from './hmr.js';
import { loadStyle } from './css.js';
import pkg from '../package.json' with { type: 'json' };

import {
  isComponentFile,
  isPageFile,
  isComponentStyle,
  isPageStyle,
} from './utils.js';

const version = pkg.version;

/**
 * Creates the Avenx Vite plugin.
 * @param {object} options - Plugin configuration.
 * @param {boolean} [options.debug] - Enables debug logging.
 * @param {{strict?: boolean}} [options.csp] - Content-Security-Policy posture.
 *   With `strict: true` a module whose expressions did not all compile to
 *   functions fails the transform, instead of being left to the runtime
 *   interpreter -- which is what would need `'unsafe-eval'`. Equivalent to
 *   `csp.strict` in avenx.config.json, and read from `options.config` too.
 * @returns {import('vite').Plugin}
 */
export function avenxPlugin(options = {}) {
  const compiler = createCompiler(options);
  const debug = options.debug ?? false;

  /**
   * Logs debug information when debug mode is enabled.
   * @param {...any} args - Values to log.
   * @returns {void}
   */
  function log(...args) {
    if (debug) {
      console.log('[avenx-vite]', ...args);
    }
  }

  return {
    name: 'avenx-vite',

    enforce: 'pre',

    /**
     * Logs the plugin version when the Vite configuration has been resolved.
     * @returns {void}
     */
    configResolved() {
      console.log(`[avenx-vite] v${version} initialized`);
    },

    /**
     * Resolves Avenx source files.
     * @param {string} source
     * @returns {null}
     */
    resolveId(source) {
      if (
        isComponentFile(source) ||
        isPageFile(source) ||
        isComponentStyle(source) ||
        isPageStyle(source)
      ) {
        log('Resolve:', source);
      }

      return null;
    },

    /**
     * Loads Avenx source files.
     * @param {string} id
     * @returns {string|null}
     */
    load(id) {
      if (isComponentStyle(id) || isPageStyle(id)) {
        log('Load Style:', id);
        return loadStyle(id, compiler);
      }

      if (isComponentFile(id) || isPageFile(id)) {
        log('Load:', id);
      }

      return null;
    },

    /**
     * Compiles Avenx components and pages.
     * @param {string} code
     * @param {string} id
     * @returns {{code: string, map: null}|null}
     */
    transform(code, id) {
      if (isComponentFile(id)) {
        log('Compile Component:', id);

        const result = compiler.compileComponent(id, code);

        return {
          code: result.code,
          map: result.map,
        };
      }

      if (isPageFile(id)) {
        log('Compile Page:', id);

        const result = compiler.compilePage(id, code);

        return {
          code: result.code,
          map: result.map,
        };
      }

      return null;
    },

    /**
     * Handles Hot Module Replacement.
     * @param {import('vite').HmrContext} ctx
     * @returns {Array<never>|undefined}
     */
    handleHotUpdate(ctx) {
      return handleAvenxHotUpdate(ctx);
    },
  };
}

export { avenxPlugin as avenxVite, avenxPlugin as default };