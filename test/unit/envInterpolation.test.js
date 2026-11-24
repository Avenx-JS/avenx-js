import assert from 'assert';
import path from 'path';
import fs from 'fs';

process.env.NODE_ENV = 'test';

import loadConfig, { interpolateEnv } from '../../lib/config.js';

console.log('🧪 Testing Global Environment Variable Interpolation in avenx.config.json...');

// ----------------------------------------------------
// 1. Unit Tests for interpolateEnv helper function
// ----------------------------------------------------
console.log('  Testing interpolateEnv helper function directly...');

process.env.TEST_HOST = '127.0.0.1';
process.env.TEST_PORT = '8080';
process.env.TEST_STAGE = 'staging';

// Test single $VAR placeholder
assert.strictEqual(interpolateEnv('$TEST_STAGE'), 'staging');

// Test single ${VAR} placeholder
assert.strictEqual(interpolateEnv('${TEST_STAGE}'), 'staging');

// Test inline placeholders in longer string
assert.strictEqual(
  interpolateEnv('http://${TEST_HOST}:$TEST_PORT/api'),
  'http://127.0.0.1:8080/api'
);

// Test missing environment variable (replaces with empty string)
delete process.env.TEST_MISSING_VAR;
assert.strictEqual(interpolateEnv('prefix-${TEST_MISSING_VAR}-suffix'), 'prefix--suffix');
assert.strictEqual(interpolateEnv('$TEST_MISSING_VAR'), '');

// Test non-string values passed directly
assert.strictEqual(interpolateEnv(123), 123);
assert.strictEqual(interpolateEnv(true), true);
assert.strictEqual(interpolateEnv(null), null);
assert.strictEqual(interpolateEnv(undefined), undefined);

// Test array interpolation
const testArray = ['$TEST_STAGE', 'fixed', '${TEST_HOST}'];
assert.deepStrictEqual(interpolateEnv(testArray), ['staging', 'fixed', '127.0.0.1']);

// JSON keys remain own data properties, including names on Object.prototype.
const specialKeys = JSON.parse('{"__proto__":{"stage":"$TEST_STAGE"},"constructor":"$TEST_HOST","prototype":"$TEST_PORT"}');
const interpolatedKeys = interpolateEnv(specialKeys);
assert.deepStrictEqual(Object.keys(interpolatedKeys), Object.keys(specialKeys));
assert.strictEqual(Object.getPrototypeOf(interpolatedKeys), Object.prototype);
assert.deepStrictEqual(interpolatedKeys.__proto__, { stage: 'staging' });
assert.strictEqual(interpolatedKeys.constructor, '127.0.0.1');
assert.strictEqual(interpolatedKeys.prototype, '8080');
assert.strictEqual(interpolatedKeys.stage, undefined);
assert.strictEqual(specialKeys.__proto__.stage, '$TEST_STAGE');

// Test object interpolation
const testObj = {
  host: '$TEST_HOST',
  port: '${TEST_PORT}',
  nested: {
    stage: '$TEST_STAGE',
    count: 42,
  },
};
assert.deepStrictEqual(interpolateEnv(testObj), {
  host: '127.0.0.1',
  port: '8080',
  nested: {
    stage: 'staging',
    count: 42,
  },
});

console.log('  ✅ interpolateEnv helper unit tests passed!');

// ----------------------------------------------------
// 2. Integration Tests with loadConfig()
// ----------------------------------------------------
console.log('  Testing loadConfig integration with env variable interpolation...');

const configPath = path.join(process.cwd(), 'avenx.config.json');
const originalConfigExist = fs.existsSync(configPath);
let originalConfigContent = null;
if (originalConfigExist) {
  originalConfigContent = fs.readFileSync(configPath, 'utf8');
}

function writeTestConfig(obj) {
  fs.writeFileSync(configPath, JSON.stringify(obj), 'utf8');
}

function cleanupTestConfig() {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
  if (originalConfigExist) {
    fs.writeFileSync(configPath, originalConfigContent, 'utf8');
  }
}

try {
  process.env.AVENX_TEST_PORT = '9090';
  process.env.AVENX_TEST_HOST = '0.0.0.0';

  writeTestConfig({
    srcDir: 'src',
    distDir: 'dist',
    alias: { ['__proto__']: '$TEST_STAGE' },
    server: {
      port: '$AVENX_TEST_PORT',
      host: '${AVENX_TEST_HOST}',
    },
  });

  const loaded = loadConfig();
  assert.strictEqual(loaded.server.port, 9090);
  assert.strictEqual(loaded.server.host, '0.0.0.0');
  assert.deepStrictEqual(Object.entries(loaded.alias), [['__proto__', 'staging']]);

  console.log('  ✅ loadConfig environment variable interpolation passed!');
} finally {
  cleanupTestConfig();
  delete process.env.TEST_HOST;
  delete process.env.TEST_PORT;
  delete process.env.TEST_STAGE;
  delete process.env.AVENX_TEST_PORT;
  delete process.env.AVENX_TEST_HOST;
}

console.log('✅ All Environment Variable Interpolation tests successfully completed!');
