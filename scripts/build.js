import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Ensure dist directory exists
const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

async function build() {
  console.log('Building Avenx runtime...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'lib/core/index.js')],
    bundle: true,
    outfile: path.join(distDir, 'runtime.js'),
    format: 'iife',
    globalName: 'Avenx',
    footer: {
      js: `
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, Avenx);
} else if (typeof window !== 'undefined') {
  Object.assign(window, Avenx);
} else if (typeof global !== 'undefined') {
  Object.assign(global, Avenx);
}
`,
    },
    target: ['es2020'],
  });
  console.log('Runtime build successful: dist/runtime.js');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
