import assert from 'assert';
import path from 'path';
import fs from 'fs';

// Set env to test so that loadConfig throws validation errors instead of process.exit
process.env.NODE_ENV = 'test';

import loadConfig from '../../lib/config.js';
import AvenxCompiler from '../../lib/compiler.js';

try {
  console.log('🧪 Testing Avenx Config and Custom Directory CLI Options...');

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

  function assertThrows(fn, expectedMsgPart) {
    try {
      fn();
    } catch (err) {
      if (err.code === 'ERR_ASSERTION') throw err;
      assert.ok(
        err.message.includes(expectedMsgPart),
        `Expected error message "${err.message}" to contain "${expectedMsgPart}"`,
      );
      return;
    }
    assert.fail(`Expected to throw error containing "${expectedMsgPart}" but did not throw.`);
  }

  try {
    // ----------------------------------------------------
    // Test 1: Config loading & validation
    // ----------------------------------------------------
    console.log('  Testing default config load...');
    cleanupTestConfig(); // ensure no config file for default test
    const defaults = loadConfig();
    assert.strictEqual(defaults.srcDir, 'src');
    assert.strictEqual(defaults.distDir, 'dist');
    assert.strictEqual(defaults.templatesDir, '.avenxtemplates');
    assert.strictEqual(defaults.server.port, 3000);

    console.log('  Testing valid custom config merge...');
    writeTestConfig({
      srcDir: 'app-src',
      distDir: 'public-out',
      server: { port: 8080 },
    });
    const customConfig = loadConfig();
    assert.strictEqual(customConfig.srcDir, 'app-src');
    assert.strictEqual(customConfig.distDir, 'public-out');
    assert.strictEqual(customConfig.templatesDir, '.avenxtemplates');
    assert.strictEqual(customConfig.server.port, 8080);
    assert.strictEqual(customConfig.server.host, 'localhost');

    console.log('  Testing invalid config schema validations...');
    writeTestConfig({ srcDir: '' });
    assertThrows(() => loadConfig(), 'srcDir must be a non-empty string');

    writeTestConfig({ srcDir: '/absolute/path' });
    assertThrows(() => loadConfig(), 'srcDir must be a relative path');

    writeTestConfig({ distDir: 123 });
    assertThrows(() => loadConfig(), 'distDir must be a non-empty string');

    writeTestConfig({ distDir: '/absolute/dist' });
    assertThrows(() => loadConfig(), 'distDir must be a relative path');

    writeTestConfig({ templatesDir: '' });
    assertThrows(() => loadConfig(), 'templatesDir must be a non-empty string');

    writeTestConfig({ templatesDir: '/absolute/templates' });
    assertThrows(() => loadConfig(), 'templatesDir must be a relative path');

    writeTestConfig({ server: { port: '3000' } });
    assertThrows(() => loadConfig(), 'server.port must be a valid port number');

    writeTestConfig({ server: { port: 99999 } });
    assertThrows(() => loadConfig(), 'server.port must be a valid port number');

    writeTestConfig({ server: { host: '' } });
    assertThrows(() => loadConfig(), 'server.host must be a non-empty string');

    cleanupTestConfig();

    // ----------------------------------------------------
    // Test 2: Compiler overrides
    // ----------------------------------------------------
    console.log('  Testing AvenxCompiler constructor overrides...');
    const compiler = new AvenxCompiler({
      srcDir: 'custom-src',
      distDir: 'custom-dist',
      rootDir: '/tmp/test-project',
    });
    assert.strictEqual(compiler.rootDir, '/tmp/test-project');
    assert.strictEqual(compiler.srcDir, path.join('/tmp/test-project', 'custom-src'));
    assert.strictEqual(compiler.distDir, path.join('/tmp/test-project', 'custom-dist'));
  } finally {
    cleanupTestConfig();
  }

  console.log('  ✅ Avenx Config tests passed successfully!');
} catch (error) {
  console.error('❌ Avenx Config tests failed!');
  console.error(error);
  process.exit(1);
}
