import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import loadConfig from '../../lib/config.js';
import { clearExpressionCache, compileExpression, getExpressionCacheStats } from '../../lib/core/expression/compile.js';

function testExpressionCacheCapacity() {
  console.log('  🧪 Testing the expressionCacheCapacity configuration option...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-expression-cache-'));
  const configPath = path.join(tmpDir, 'avenx.config.json');

  try {
    // The default capacity holds both compiled expressions.
    fs.writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf8');
    loadConfig(tmpDir);
    clearExpressionCache();
    compileExpression('a + 1');
    compileExpression('b + 2');
    assert.strictEqual(getExpressionCacheStats().size, 2, 'the default capacity holds both compiled expressions');

    // A capacity of one keeps the last one only.
    fs.writeFileSync(configPath, JSON.stringify({ expressionCacheCapacity: 1 }, null, 2), 'utf8');
    loadConfig(tmpDir);
    clearExpressionCache();
    compileExpression('a + 1');
    compileExpression('b + 2');
    assert.strictEqual(getExpressionCacheStats().size, 1, 'a capacity of one keeps the last compiled expression only');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('  ✅ Expression cache capacity tests passed!');
}

testExpressionCacheCapacity();
