/**
 * @file unresolvedDefWarning.test.js
 * @description An unresolved `@def` reference must report as a coded, readable
 * AVX_W58 warning, in the console and in `avenx check --json`.
 *
 * The warning was reported with an array of format arguments where
 * `reportWarning` expects an already-formatted message, so the logger printed
 * the arguments comma-joined -- no `[AVX_W58]` code, no sentence, no remedy --
 * and the JSON reporter fell back to `AVX_UNK` with a truncated file.
 */

import assert from 'assert';
import path from 'path';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { parseDiagnostic } from '../../bin/commands/build.js';

console.log('Testing unresolved @def warnings...');

const SOURCE_FILE = path.resolve(process.cwd(), 'src/components/card/card.component.css');
const RELATIVE_FILE = 'src/components/card/card.component.css';

/**
 * Applies variables to a stylesheet while capturing everything the warning
 * reporter logs, so a test can assert on the exact text a user would see.
 * @param {string} css - The stylesheet source.
 * @param {object} [config] - Project configuration (warning severities).
 * @param {object} [variables] - CSS variables to declare before processing.
 * @returns {{logged: string[], css: string, error: Error|null}} What happened.
 */
function apply(css, config = {}, variables = { primary: '#0af' }) {
  const processor = new StyleProcessor({}, config);
  for (const [name, value] of Object.entries(variables)) {
    processor.addVariable(name, value);
  }

  const logged = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => logged.push(args.join(' '));
  let error = null;
  let output = '';
  try {
    output = processor.applyVariables(css, SOURCE_FILE);
  } catch (err) {
    error = err;
  } finally {
    logger.warn = originalWarn;
  }
  return { logged, css: output, error };
}

const STYLESHEET = 'text {\n    color: @primary;\n    background: @bg;\n}';

// --- the message carries its code, its sentence and the stylesheet ---------
{
  const { logged } = apply(STYLESHEET);
  assert.strictEqual(logged.length, 1, 'one unresolved reference, one warning');
  const message = logged[0];
  assert.ok(
    message.startsWith(`[${AvenxErrorCodes.COMPILER_UNRESOLVED_DEF_REFERENCE}] `),
    `the warning must open with its code, got: ${message}`,
  );
  assert.ok(
    message.includes(`Unresolved @def variable "@bg" in stylesheet "${RELATIVE_FILE}".`),
    `the warning must name the variable and the stylesheet, got: ${message}`,
  );
  assert.ok(
    !message.includes(SOURCE_FILE),
    'the stylesheet path is reported project-relative, not as a machine path',
  );
  console.log('  ✅ the warning is formatted with its code and stylesheet');
}

// --- a near miss still suggests the declared variable ----------------------
{
  const { logged } = apply('text {\n    color: @primray;\n}');
  assert.strictEqual(logged.length, 1);
  assert.ok(
    logged[0].includes('Did you mean "@primary"?'),
    `a near miss must suggest the declared variable, got: ${logged[0]}`,
  );
  console.log('  ✅ the "Did you mean" suggestion survives formatting');
}

// --- no compiler warning ever reaches the logger without a code -----------
{
  const { logged } = apply('a {\n    color: @bg;\n    border-color: @brand;\n    outline: @footer;\n}');
  assert.strictEqual(logged.length, 3, 'three unresolved references, three warnings');
  for (const message of logged) {
    assert.match(
      message,
      /^\[AVX_[A-Z0-9]+\] /,
      `every compiler warning must open with its code, got: ${message}`,
    );
  }
  console.log('  ✅ no warning reaches the logger without a leading AVX_ code');
}

// --- `avenx check --json` keeps the code and the full file ----------------
{
  const { logged } = apply(STYLESHEET);
  const diagnostic = parseDiagnostic('warning', [logged[0]]);
  assert.strictEqual(diagnostic.code, 'AVX_W58', 'the JSON diagnostic keeps the warning code');
  assert.strictEqual(diagnostic.file, RELATIVE_FILE, 'the JSON diagnostic names the stylesheet');
  assert.ok(
    diagnostic.message.startsWith('Unresolved @def variable'),
    `the JSON message drops the code bracket, got: ${diagnostic.message}`,
  );
  console.log('  ✅ check --json reports AVX_W58 against the stylesheet');
}

// --- severity overrides still apply ---------------------------------------
{
  const off = apply(STYLESHEET, {
    warnings: { [AvenxErrorCodes.COMPILER_UNRESOLVED_DEF_REFERENCE]: 'off' },
  });
  assert.strictEqual(off.logged.length, 0, '"off" must silence the warning');

  const elevated = apply(STYLESHEET, {
    warnings: { [AvenxErrorCodes.COMPILER_UNRESOLVED_DEF_REFERENCE]: 'error' },
  });
  assert.strictEqual(elevated.logged.length, 0, 'an elevated warning is not logged as a warning');
  assert.ok(elevated.error, 'an elevated warning must throw');
  assert.ok(
    elevated.error.message.includes('AVX_W58'),
    `the thrown error keeps its code, got: ${elevated.error.message}`,
  );
  console.log('  ✅ "off" still silences and "error" still fails the build');
}

// --- the stylesheet itself is left as written ------------------------------
{
  const { css } = apply(STYLESHEET);
  assert.ok(css.includes('color: #0af;'), 'declared variables are still substituted');
  assert.ok(css.includes('background: @bg;'), 'an unresolved reference is left as written');
  console.log('  ✅ declared variables are substituted and unresolved ones are preserved');
}

console.log('  ✅ Unresolved @def warning tests passed successfully!');
