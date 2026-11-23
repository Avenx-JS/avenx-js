import zlib from 'node:zlib';
import { minify } from '../bundler/minify.js';

/**
 * Measure an emitted asset using the same minification and gzip settings in CI
 * and the installed CLI, using Avenx's dependency-free JavaScript minifier.
 * @param {string} content - The emitted asset contents.
 * @param {'js'|'css'} kind - The asset type.
 * @returns {Promise<{raw: number, minified: number, gzipped: number}>} Byte counts.
 */
export async function measureAsset(content, kind) {
  let minified;
  if (kind === 'css') {
    minified = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
      .replace(/\s*([{}:;])\s*/g, '$1').trim();
  } else if (kind === 'js') {
    minified = minify(content);
  } else {
    throw new Error(`Unsupported size measurement type: ${kind}`);
  }
  return {
    raw: Buffer.byteLength(content, 'utf8'),
    minified: Buffer.byteLength(minified, 'utf8'),
    gzipped: zlib.gzipSync(Buffer.from(minified, 'utf8')).length,
  };
}
