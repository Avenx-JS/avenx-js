import assert from 'assert';
import { reportWarning } from '../../lib/compiler/utils/warningReporter.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

try {
  console.log('🧪 Testing Warning Severity Settings and reportWarning Utility...');

  let loggedWarnings = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => loggedWarnings.push(args.join(' '));

  try {
    // 1. reportWarning default ("warn")
    loggedWarnings = [];
    reportWarning(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, 'Test warning message', {});
    assert.strictEqual(loggedWarnings.length, 1);
    assert.ok(loggedWarnings[0].includes('Test warning message'));

    // 2. reportWarning suppressed ("off" / "ignore")
    loggedWarnings = [];
    reportWarning(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, 'Test warning message', {
      warnings: { [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'off' },
    });
    assert.strictEqual(loggedWarnings.length, 0, 'Warning should be suppressed when severity is "off"');

    loggedWarnings = [];
    reportWarning(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, 'Test warning message', {
      warnings: { [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'ignore' },
    });
    assert.strictEqual(loggedWarnings.length, 0, 'Warning should be suppressed when severity is "ignore"');

    // 3. reportWarning elevated to error ("error")
    loggedWarnings = [];
    let errorThrown = false;
    try {
      reportWarning(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, 'Elevated error message', {
        warnings: { [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'error' },
      });
    } catch (err) {
      errorThrown = true;
      assert.ok(err.message.includes('Elevated error message'));
    }
    assert.strictEqual(errorThrown, true, 'Expected reportWarning to throw when severity is "error"');
    assert.strictEqual(loggedWarnings.length, 0, 'Logger should not log when elevated to error');

    // Code > rule name > category > default, independent of key order.
    assert.throws(() => reportWarning('AVX_W65', 'Missing alt', {
      warnings: { accessibility: 'error' },
    }), /Missing alt/);
    loggedWarnings = [];
    reportWarning('AVX_W65', 'Missing alt', {
      warnings: { accessibility: 'error', 'img-alt': 'off' },
    });
    assert.strictEqual(loggedWarnings.length, 0);
    reportWarning('AVX_W65', 'Missing alt', {
      warnings: { AVX_W65: 'warn', 'img-alt': 'off', accessibility: 'error' },
    });
    assert.strictEqual(loggedWarnings.length, 1);
    assert.throws(() => reportWarning('AVX_W65', 'Named rule', {
      warnings: { 'img-alt': 'error' },
    }), /Named rule/);
    loggedWarnings = [];
    reportWarning('AVX_W03', 'Other category', {
      warnings: { accessibility: 'off' },
    });
    assert.strictEqual(loggedWarnings.length, 1, 'Unrelated categories retain their default');
    reportWarning('AVX_W03', 'Unknown key', { warnings: { undefined: 'off' } });
    assert.strictEqual(loggedWarnings.length, 2, 'Unknown keys cannot suppress warnings without a rule');

    // 4. ComponentParser template validation with severity overrides
    const styleProc = new StyleProcessor();

    // Default: warns on undeclared reference AVX_W03
    loggedWarnings = [];
    const parserWarn = new ComponentParser(styleProc, [], { warnings: {} });
    parserWarn.validateTemplate('<div>{{ undeclaredVar }}</div>', {}, {}, {}, 'Test.component.js', 'TestComponent');
    assert.strictEqual(loggedWarnings.length, 1);
    assert.ok(loggedWarnings[0].includes('undeclaredVar'));

    // Suppressed: "off"
    loggedWarnings = [];
    const parserOff = new ComponentParser(styleProc, [], {
      warnings: { [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'off' },
    });
    parserOff.validateTemplate('<div>{{ undeclaredVar }}</div>', {}, {}, {}, 'Test.component.js', 'TestComponent');
    assert.strictEqual(loggedWarnings.length, 0);

    // Elevated: "error"
    errorThrown = false;
    const parserErr = new ComponentParser(styleProc, [], {
      warnings: { [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'error' },
    });
    try {
      parserErr.validateTemplate('<div>{{ undeclaredVar }}</div>', {}, {}, {}, 'Test.component.js', 'TestComponent');
    } catch (err) {
      errorThrown = true;
      assert.ok(err.message.includes('AVX_W03'));
      assert.ok(err.message.includes('undeclaredVar'));
    }
    assert.strictEqual(errorThrown, true, 'ComponentParser should throw when AVX_W03 is configured as error');
  } finally {
    logger.warn = origWarn;
  }

  console.log('  ✅ Warning Severity Settings tests passed successfully!');
} catch (error) {
  console.error('❌ Warning Severity Settings tests failed!');
  console.error(error);
  process.exit(1);
}
