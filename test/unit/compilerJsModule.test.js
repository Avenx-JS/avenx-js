/**
 * @file compilerJsModule.test.js
 * @description Verifies that a JavaScript module saved under a .component.js name
 * is reported with AVX_W63 at build time rather than rendered as literal template text (#1517).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxErrorCodes, AvenxErrorMessages } from '../../lib/core/runtime/AvenxError.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-js-module-'));

/**
 * Captures console.warn output during function execution.
 * @param {Function} fn - Function to execute.
 * @returns {string[]} Array of captured warning strings.
 */
function captureWarnings(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => {
    warnings.push(String(msg));
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

try {
  console.log('🧪 Testing JS Module as .component.js Detection (#1517)...');
  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  // 1. Diagnostic registration checks
  console.log('  Checking AVX_W63 code and catalogue registration...');
  assert.strictEqual(AvenxErrorCodes.COMPILER_JS_MODULE_AS_TEMPLATE, 'AVX_W63');
  assert.ok(AvenxErrorMessages[AvenxErrorCodes.COMPILER_JS_MODULE_AS_TEMPLATE]);
  assert.ok(AvenxErrorMessages[AvenxErrorCodes.COMPILER_JS_MODULE_AS_TEMPLATE].includes('single-file component template was expected'));

  const diagnostic = getDiagnostic('AVX_W63');
  assert.ok(diagnostic, 'AVX_W63 must be present in the diagnostic catalogue');
  assert.strictEqual(diagnostic.code, 'AVX_W63');
  assert.strictEqual(diagnostic.name, 'CompilerJsModuleAsTemplate');
  assert.strictEqual(diagnostic.severity, 'warning');
  assert.strictEqual(diagnostic.category, 'compiler');

  // 2. Positive Case 1: Plain JavaScript module
  console.log('  Testing positive case: plain JS module in .component.js...');
  const plainJsFile = path.join(workDir, 'helpers.component.js');
  fs.writeFileSync(plainJsFile, 'export const x = 1;export function hello() { return \'hi\'; }');

  const run1Warnings = captureWarnings(() => {
    cp.parse(plainJsFile);
  });

  assert.ok(run1Warnings.some((w) => w.includes('AVX_W63')), 'Expected AVX_W63 for plain JS module');
  assert.ok(run1Warnings.some((w) => w.includes('helpers.component.js')), 'Warning must name the file');
  assert.ok(
    run1Warnings.some((w) => w.includes('single-file component template was expected')),
    'Warning must state that a single-file component template was expected',
  );

  // 3. Positive Case 2: Class-based component extending AvenxComponent
  console.log('  Testing positive case: class-based component in .component.js...');
  const classCompFile = path.join(workDir, 'classComp.component.js');
  fs.writeFileSync(
    classCompFile,
    'import { AvenxComponent } from \'avenx\';\nexport default class T extends AvenxComponent { constructor() { super(); } }',
  );

  const run2Warnings = captureWarnings(() => {
    cp.parse(classCompFile);
  });

  assert.ok(run2Warnings.some((w) => w.includes('AVX_W63')), 'Expected AVX_W63 for class-based component');
  assert.ok(run2Warnings.some((w) => w.includes('classComp.component.js')), 'Warning must name the file');
  assert.ok(
    run2Warnings.some((w) => w.includes('single-file component template was expected')),
    'Warning must state that a single-file component template was expected',
  );

  // 4. Positive Case 3: Plain class without export
  console.log('  Testing positive case: unexported class in .component.js...');
  const bareClassFile = path.join(workDir, 'bareClass.component.js');
  fs.writeFileSync(
    bareClassFile,
    'class MyComponent extends AvenxComponent {\n  render() { return \'<div>hello</div>\'; }\n}',
  );

  const run3Warnings = captureWarnings(() => {
    cp.parse(bareClassFile);
  });

  assert.ok(run3Warnings.some((w) => w.includes('AVX_W63')), 'Expected AVX_W63 for bare class component');

  // 5. Negative Case 1: Template legitimately beginning with declaration tags or plain markup
  console.log('  Testing negative case: template starting with <state>, <computed>, <action>, etc. or plain markup...');
  const validSfcFile = path.join(workDir, 'validSfc.component.js');
  fs.writeFileSync(
    validSfcFile,
    '<state count="0" />\n<computed doubled="count * 2" />\n<action name="inc">count++</action>\n<div><button @click="inc()">{{ count }}</button></div>',
  );

  const sfcWarnings = captureWarnings(() => {
    cp.parse(validSfcFile);
  });

  assert.ok(!sfcWarnings.some((w) => w.includes('AVX_W63')), 'Valid SFC must NOT trigger AVX_W63');

  // Control: plain markup <div><button>OK</button></div>
  const plainMarkupFile = path.join(workDir, 'plainMarkup.component.js');
  fs.writeFileSync(plainMarkupFile, '<div><button>OK</button></div>');

  const markupWarnings = captureWarnings(() => {
    cp.parse(plainMarkupFile);
  });

  assert.ok(!markupWarnings.some((w) => w.includes('AVX_W63')), 'Plain markup must NOT trigger AVX_W63');

  // 6. Negative Case 2: Template containing words "import" or "export" in text or expressions
  console.log('  Testing negative case: template containing "import" or "export" in text or expressions...');
  const textWordsFile = path.join(workDir, 'textWords.component.js');
  fs.writeFileSync(
    textWordsFile,
    '<state isExport="true" />\n<div>\n  <p>Please import your data or export the report</p>\n  <span>{{ isExport ? \'export\' : \'import\' }}</span>\n  <button @click="exportData()">Export</button>\n</div>',
  );

  const wordsWarnings = captureWarnings(() => {
    cp.parse(textWordsFile);
  });

  assert.ok(
    !wordsWarnings.some((w) => w.includes('AVX_W63')),
    'Template with "import" or "export" in text/expressions must NOT trigger AVX_W63',
  );

  console.log('  ✅ JS Module as .component.js Detection tests passed!');
} finally {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // cleanup
  }
}
