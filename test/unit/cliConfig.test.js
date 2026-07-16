import assert from 'assert';
import path from 'path';
import fs from 'fs';

// Set env to test so that loadConfig throws validation errors instead of process.exit
process.env.NODE_ENV = 'test';

import loadConfig from '../../lib/config.js';
import AvenxCompiler from '../../lib/compiler.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

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
    // Test 3: Warnings for unknown options
    // ----------------------------------------------------
    console.log('  Testing warnings for unknown configuration options...');
    const warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (...args) => {
      warnings.push(args.join(' '));
    };

    try {
      // 1. Unknown top-level option with a close match suggestion
      writeTestConfig({ srcdir: 'app-src' });
      loadConfig();
      assert.ok(warnings.length > 0, 'Expected warnings to be emitted');
      assert.ok(
        warnings[0].includes('Unknown configuration option "srcdir" in avenx.config.json. Did you mean "srcDir"?'),
        `Unexpected warning: ${warnings[0]}`
      );
      assert.ok(
        warnings[0].includes('Supported top-level options are: srcDir, distDir, templatesDir, server, style, outputName, logging.'),
        `Unexpected warning: ${warnings[0]}`
      );
      warnings.length = 0;

      // 2. Unknown top-level option without a suggestion
      writeTestConfig({ randomFieldXYZ: 123 });
      loadConfig();
      assert.ok(warnings.length > 0, 'Expected warnings to be emitted');
      assert.ok(
        warnings[0].includes('Unknown configuration option "randomFieldXYZ" in avenx.config.json.'),
        `Unexpected warning: ${warnings[0]}`
      );
      assert.ok(
        !warnings[0].includes('Did you mean'),
        `Warning should not have suggestions: ${warnings[0]}`
      );
      warnings.length = 0;

      // 3. Unknown nested server option with a suggestion
      writeTestConfig({ server: { portt: 3000 } });
      loadConfig();
      assert.ok(warnings.length > 0, 'Expected warnings to be emitted');
      assert.ok(
        warnings[0].includes('Unknown configuration option "server.portt" in avenx.config.json. Did you mean "server.port"?'),
        `Unexpected warning: ${warnings[0]}`
      );
      warnings.length = 0;

      // 4. Unknown nested style option with a suggestion
      writeTestConfig({ style: { preprocessorr: 'sass' } });
      loadConfig();
      assert.ok(warnings.length > 0, 'Expected warnings to be emitted');
      assert.ok(
        warnings[0].includes('Unknown configuration option "style.preprocessorr" in avenx.config.json. Did you mean "style.preprocessor"?'),
        `Unexpected warning: ${warnings[0]}`
      );
      warnings.length = 0;

      // 5. Unknown nested logging option with a suggestion
      writeTestConfig({ logging: { levels: 'debug' } });
      loadConfig();
      assert.ok(warnings.length > 0, 'Expected warnings to be emitted');
      assert.ok(
        warnings[0].includes('Unknown configuration option "logging.levels" in avenx.config.json. Did you mean "logging.level"?'),
        `Unexpected warning: ${warnings[0]}`
      );
      warnings.length = 0;

    } finally {
      logger.warn = originalWarn;
      cleanupTestConfig();
    }

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
