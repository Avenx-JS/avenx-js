import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PUBLIC_GLOBALS, NAMESPACE_GLOBAL } from '../lib/core/globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Ensure dist directory exists
const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

/**
 * Installs the runtime on the global object.
 *
 * Compiled applications are concatenated into one script and reference the
 * runtime by name, so the bundle has to publish itself somewhere reachable.
 * The complete surface goes on one namespace; only the names in
 * lib/core/globals.js are also published bare. See that file for why.
 * @type {string}
 */
const GLOBAL_FOOTER = `
(function (root) {
  if (!root) return;
  root.${NAMESPACE_GLOBAL} = ${NAMESPACE_GLOBAL};
  var bare = ${JSON.stringify(PUBLIC_GLOBALS)};
  for (var i = 0; i < bare.length; i++) {
    root[bare[i]] = ${NAMESPACE_GLOBAL}[bare[i]];
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : typeof global !== 'undefined'
        ? global
        : null,
);
`;

/**
 * Options shared by both runtime variants.
 *
 * The entry is lib/core/index.js and nothing else. Its graph is browser-only:
 * the testing utilities and the Node-side tooling live behind their own entry
 * points, so this build needs no shims for `fs` or `path`. If a Node builtin
 * ever appears in this bundle, something was re-exported from the runtime
 * barrel that does not belong there — fix the import, do not add a stub.
 * @type {object}
 */
const BASE_OPTIONS = {
  entryPoints: [path.join(rootDir, 'lib/core/index.js')],
  platform: 'browser',
  bundle: true,
  format: 'iife',
  globalName: 'Avenx',
  footer: { js: GLOBAL_FOOTER },
  target: ['es2020'],
};

/**
 * The two runtime artifacts the compiler chooses between.
 *
 * Both are built from the same graph, so they cannot drift in behaviour. The
 * production variant is minified; the development variant stays readable so a
 * stack trace from `avenx serve` points at something a developer can follow.
 * @type {Array<{file: string, label: string, minify: boolean}>}
 */
const VARIANTS = [
  { file: 'runtime.js', label: 'development', minify: false },
  { file: 'runtime.min.js', label: 'production', minify: true },
];

/**
 * Builds both runtime variants.
 * @returns {Promise<void>}
 */
async function build() {
  console.log('Building Avenx runtime...');

  for (const variant of VARIANTS) {
    await esbuild.build({
      ...BASE_OPTIONS,
      outfile: path.join(distDir, variant.file),
      minify: variant.minify,
      // Comments carry no runtime meaning and are most of the size delta.
      legalComments: variant.minify ? 'none' : 'inline',
    });

    const bytes = fs.statSync(path.join(distDir, variant.file)).size;
    console.log(`  ${variant.file} (${variant.label}): ${(bytes / 1024).toFixed(1)} KB`);
  }

  console.log('Runtime build successful.');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
