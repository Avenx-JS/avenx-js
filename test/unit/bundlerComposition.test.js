import assert from 'node:assert/strict';
import path from 'node:path';
import { bundle } from '../../lib/bundler/index.js';
import { minify } from '../../lib/bundler/minify.js';

const rootDir = process.cwd();
const id = path.join(rootDir, 'composition-entry.js');
const source = '/* two\n * comment lines */\nglobalThis.value = "上海 😀";\n';
const moduleCode = `// ${id}\nvar __avx0 = (function () {\nvar __x = {};\n${source}\nreturn __x;\n})();\n`;
for (const shouldMinify of [false, true]) {
  const result = bundle({
    entries: [id], virtualModules: new Map([[id, source]]), rootDir,
    minify: shouldMinify, sourceMap: true, banner: '// banner\n// second line',
    footer: 'globalThis.exports = __avx_entry;',
  });
  const expected = shouldMinify ? minify(moduleCode) : moduleCode;
  assert.ok(result.code.includes(expected));
  assert.deepEqual(result.moduleSizes, [{ id, bytes: Buffer.byteLength(expected, 'utf8') }]);
  assert.ok(result.stats.bytes > result.moduleSizes[0].bytes, 'common wrapper and footer are separate overhead');
  assert.ok(result.map.mappings, 'range tracking retains source-map output');
}
console.log('Exact module sizes include UTF-8, multiline comments and wrappers in both modes.');
