// Type definitions for @avenx/vite
// Project: Avenx-JS
// Definitions by: Avenx Team

import type { Plugin } from 'vite';

/** Options accepted by the Avenx Vite plugin. */
export interface AvenxVitePluginOptions {
  /** Logs every resolve, load and compile the plugin handles. Default `false`. */
  debug?: boolean;

  /**
   * Content-Security-Policy posture. With `strict: true`, a module whose
   * expressions did not all compile to functions fails the transform (AVX_C31)
   * instead of being left to the runtime interpreter, which would need
   * `'unsafe-eval'`. Equivalent to `csp.strict` in avenx.config.json.
   */
  csp?: { strict?: boolean };

  /**
   * A parsed avenx.config.json to compile with. `csp.strict` is read from here
   * as well as from `csp` above.
   */
  config?: Record<string, unknown>;

  /** Options passed to the style processor. */
  style?: Record<string, unknown>;

  /** Extra tag names to treat as void elements. */
  voidTags?: string[];
}

/** Creates the Avenx Vite plugin. */
export function avenxPlugin(options?: AvenxVitePluginOptions): Plugin;

/** Alias of {@link avenxPlugin}. */
export const avenxVite: typeof avenxPlugin;

export default avenxPlugin;
