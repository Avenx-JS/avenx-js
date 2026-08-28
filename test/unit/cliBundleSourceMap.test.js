import assert from 'node:assert';
import path from 'node:path';
import { encodeVLQ, generateTemplateSourceMap, composeBundleSourceMap } from '../../lib/compiler/sourcemap.js';

console.log('🧪 Testing CLI Bundle Source Maps & VLQ encoding...');

// 1. VLQ test
assert.strictEqual(encodeVLQ(0), 'A');
assert.strictEqual(encodeVLQ(1), 'C');
assert.strictEqual(encodeVLQ(-1), 'D');
assert.strictEqual(encodeVLQ(16), 'gB');
console.log('  ✓ VLQ encoding tests passed');

// 2. generateTemplateSourceMap test
const sampleTemplate = `<template>\n  <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n  count: 0\n};\n</script>`;
const sampleCompiled = `class SampleComponent extends AvenxComponent {\n  render() {\n    return '<div>' + this.count + '</div>';\n  }\n}`;
const templateMap = generateTemplateSourceMap('Sample.component.js', sampleTemplate, sampleCompiled);
assert.strictEqual(templateMap.version, 3);
assert.strictEqual(templateMap.file, 'Sample.component.js');
assert.ok(templateMap.mappings.length > 0);
assert.deepStrictEqual(templateMap.sources, ['Sample.component.js']);
assert.deepStrictEqual(templateMap.sourcesContent, [sampleTemplate]);
console.log('  ✓ generateTemplateSourceMap tests passed');

// 3. composeBundleSourceMap test
const bundleMap = composeBundleSourceMap('bundle.js', 100, [
  { filePath: 'src/components/A.component.js', originalCode: sampleTemplate, startLine: 10, lineCount: 20 },
]);
assert.strictEqual(bundleMap.version, 3);
assert.strictEqual(bundleMap.file, 'bundle.js');
assert.strictEqual(bundleMap.sources[0], 'src/components/A.component.js');
assert.strictEqual(bundleMap.sourcesContent[0], sampleTemplate);
assert.ok(bundleMap.mappings.length > 0);
console.log('  ✓ composeBundleSourceMap tests passed');

// 4. Test without sourcesContent
const mapWithoutContent = composeBundleSourceMap(
  'bundle.js',
  100,
  [{ filePath: 'src/components/A.component.js', originalCode: sampleTemplate, startLine: 10, lineCount: 20 }],
  { sourcesContent: false },
);
assert.strictEqual(mapWithoutContent.sourcesContent, undefined);
console.log('  ✓ composeBundleSourceMap (sourcesContent: false) passed');

console.log('✅ All CLI Bundle Source Map tests passed successfully!');