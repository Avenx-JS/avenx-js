import assert from 'assert';
import { AvenxError, AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import {
  CompilerError,
  TemplateValidationError,
  StyleCompilerError,
  BuildError,
} from '../../lib/compiler/errors/index.js';

/**
 * Unit tests for specialized compiler error types.
 */
function runTests() {
  console.log('🧪 Testing specialized compiler error classes...');

  // 1. CompilerError base class inheritance
  const baseErr = new CompilerError(AvenxErrorCodes.COMPILER_SRC_DIR_MISSING, '/path/to/src');
  assert.ok(baseErr instanceof Error, 'CompilerError should inherit from Error');
  assert.ok(baseErr instanceof AvenxError, 'CompilerError should inherit from AvenxError');
  assert.strictEqual(baseErr.name, 'CompilerError');
  assert.strictEqual(baseErr.code, 'AVX_C02');
  assert.ok(baseErr.message.includes('[AVX_C02]'));

  // 2. TemplateValidationError inheritance and properties
  const tplErr = new TemplateValidationError(AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE, 'CardComponent');
  assert.ok(tplErr instanceof Error, 'TemplateValidationError should inherit from Error');
  assert.ok(tplErr instanceof AvenxError, 'TemplateValidationError should inherit from AvenxError');
  assert.ok(tplErr instanceof CompilerError, 'TemplateValidationError should inherit from CompilerError');
  assert.strictEqual(tplErr.name, 'TemplateValidationError');
  assert.strictEqual(tplErr.code, 'AVX_W02');
  assert.ok(tplErr.message.includes('[AVX_W02]'));
  assert.ok(tplErr.message.includes('CardComponent'));

  // 3. StyleCompilerError inheritance and properties
  const styleErr = new StyleCompilerError(AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING, 'sass');
  assert.ok(styleErr instanceof Error, 'StyleCompilerError should inherit from Error');
  assert.ok(styleErr instanceof AvenxError, 'StyleCompilerError should inherit from AvenxError');
  assert.ok(styleErr instanceof CompilerError, 'StyleCompilerError should inherit from CompilerError');
  assert.strictEqual(styleErr.name, 'StyleCompilerError');
  assert.strictEqual(styleErr.code, 'AVX_W24');
  assert.ok(styleErr.message.includes('[AVX_W24]'));
  assert.ok(styleErr.message.includes('sass'));

  // 4. BuildError inheritance and properties
  const buildErr = new BuildError(AvenxErrorCodes.COMPILER_DUPLICATE_COMPONENT_NAME, 'Duplicate Details');
  assert.ok(buildErr instanceof Error, 'BuildError should inherit from Error');
  assert.ok(buildErr instanceof AvenxError, 'BuildError should inherit from AvenxError');
  assert.ok(buildErr instanceof CompilerError, 'BuildError should inherit from CompilerError');
  assert.strictEqual(buildErr.name, 'BuildError');
  assert.strictEqual(buildErr.code, 'AVX_C03');
  assert.ok(buildErr.message.includes('[AVX_C03]'));

  // 5. BuildError invalid config code (AVX_W25)
  const configErr = new BuildError(AvenxErrorCodes.COMPILER_INVALID_CONFIG, 'avenx.config.json', 'Unexpected token');
  assert.strictEqual(configErr.code, 'AVX_W25');
  assert.ok(configErr.message.includes('[AVX_W25]'));
  assert.ok(configErr.message.includes('avenx.config.json'));

  console.log('  ✅ Specialized compiler error classes unit tests passed!');
}

try {
  runTests();
} catch (error) {
  console.error('❌ Specialized compiler error classes unit tests failed!');
  console.error(error);
  process.exit(1);
}
