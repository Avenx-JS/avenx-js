import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const distDir = path.join(rootDir, 'dist');

/**
 * Global the standalone bundle publishes itself as.
 * @type {string}
 */
const GLOBAL_NAME = 'AvenxPersistence';

/**
 * Publishes the bundle on the global object.
 *
 * esbuild's IIFE format declares the global name with `var`, which is enough
 * for a classic script but not for one loaded as a module or inside a wrapper.
 * Assigning explicitly makes the placement independent of how it is loaded —
 * the same thing the Avenx runtime build does.
 * @type {string}
 */
const GLOBAL_FOOTER = `
(function (root) {
  if (root) root.${GLOBAL_NAME} = ${GLOBAL_NAME};
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
`;

/**
 * Substitutes the standalone runtime resolver for the module-resolution one.
 *
 * Without this the bundle would inline a second copy of the Avenx runtime,
 * and a page would end up with two reactivity systems that do not know about
 * each other. The standalone build reads the runtime off the page instead.
 * @type {object}
 */
const useGlobalRuntime = {
  name: 'avenx-persistence-global-runtime',
  /**
   * @param {object} build - The esbuild plugin build API.
   */
  setup(build) {
    build.onResolve({ filter: /^\.\/runtime\.js$/ }, () => ({
      path: path.join(rootDir, 'src/runtime.global.js'),
    }));
  },
};

/**
 * The two artifacts. Both are built from one graph so they cannot drift; the
 * development variant stays readable so a stack trace points somewhere useful.
 * @type {Array<{file: string, label: string, minify: boolean}>}
 */
const VARIANTS = [
  { file: 'avenx-persistence.global.js', label: 'development', minify: false },
  { file: 'avenx-persistence.global.min.js', label: 'production', minify: true },
];

/**
 * Builds the standalone browser bundles.
 * @returns {Promise<void>}
 */
async function build() {
  fs.mkdirSync(distDir, { recursive: true });

  for (const variant of VARIANTS) {
    const outfile = path.join(distDir, variant.file);
    await esbuild.build({
      entryPoints: [path.join(rootDir, 'src/index.js')],
      outfile,
      platform: 'browser',
      bundle: true,
      format: 'iife',
      globalName: GLOBAL_NAME,
      footer: { js: GLOBAL_FOOTER },
      target: ['es2020'],
      minify: variant.minify,
      plugins: [useGlobalRuntime],
    });

    const size = (fs.statSync(outfile).size / 1024).toFixed(2);
    console.log(`  ${variant.file} (${variant.label}): ${size} KB`);
  }
}

build().catch((error) => {
  console.error('avenx-persistence build failed:', error);
  process.exit(1);
});
