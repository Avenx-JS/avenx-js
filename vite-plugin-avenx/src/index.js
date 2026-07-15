import { createCompiler } from './compiler.js';
import { wrapComponent, wrapPage } from './wrapper.js';
import { handleAvenxHotUpdate } from './hmr.js';
import { loadStyle } from './css.js';

import {
  isComponentFile,
  isPageFile,
  isComponentStyle,
  isPageStyle,
} from './utils.js';

/**
 * Creates the Avenx Vite plugin.
 * @param {object} options - Plugin configuration.
 * @param {boolean} [options.debug] - Enables debug logging.
 * @returns {import('vite').Plugin}
 */
export default function avenxPlugin(options = {}) {
  const compiler = createCompiler();
  const debug = options.debug ?? false;

  /**
   * Logs debug information when debug mode is enabled.
   * @param {...any} args - Values to log.
   * @returns {void}
   */
  function log(...args) {
    if (debug) {
      console.log('[vite-plugin-avenx]', ...args);
    }
  }

  return {
    name: 'vite-plugin-avenx',

    enforce: 'pre',

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
        return loadStyle(id);
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

        const result = compiler.compileComponent(id);

        return {
          code: wrapComponent(result.code, result.className),
          map: null,
        };
      }

      if (isPageFile(id)) {
        log('Compile Page:', id);

        const result = compiler.compilePage(id);

        return {
          code: wrapPage(result.code, result.className),
          map: null,
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