import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkProject, parseDiagnostic } from '../../bin/commands/build.js';
import AvenxCompiler, { DiagnosticChannel, createDiagnosticRecord } from '../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, 'fixtures-check-json');

(async () => {
  try {
    console.log('🧪 Testing avenx check --json functionality...');

    // 1. Test parseDiagnostic helper function
    console.log('  Testing parseDiagnostic helper...');
    const diag1 = parseDiagnostic('warning', ['\u001b[33m[AVX_W03] Undeclared variable "userName" referenced in template of src/components/header.component.js.\u001b[0m']);
    assert.strictEqual(diag1.code, 'AVX_W03');
    assert.strictEqual(diag1.severity, 'warning');
    assert.strictEqual(diag1.file, 'src/components/header.component.js');
    assert.strictEqual(diag1.message, 'Undeclared variable "userName" referenced in template of src/components/header.component.js.');

    const err = new Error('Template syntax error');
    err.code = 'AVX_W02';
    err.filePath = 'src/components/card.component.js';
    const diag2 = parseDiagnostic('error', [err]);
    assert.strictEqual(diag2.code, 'AVX_W02');
    assert.strictEqual(diag2.severity, 'error');
    assert.strictEqual(diag2.file, 'src/components/card.component.js');
    assert.strictEqual(diag2.message, 'Template syntax error');

    // 2. Setup temporary fixture project for CLI check testing
    if (fs.existsSync(FIXTURE_DIR)) {
      fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(FIXTURE_DIR, 'src', 'components'), { recursive: true });

    const mockCli = {
      baseDir: FIXTURE_DIR,
      rootDir: FIXTURE_DIR,
      config: {
        rootDir: FIXTURE_DIR,
        srcDir: 'src',
        distDir: 'dist',
        style: {},
      },
      _noExit: true,
    };

    // 3. Valid project check --json
    console.log('  Testing checkProject with --json on clean project...');
    const cleanReport = checkProject(mockCli, ['--json']);
    assert.strictEqual(cleanReport.valid, true);
    assert.strictEqual(cleanReport.errorCount, 0);
    assert.strictEqual(cleanReport.warningCount, 0);
    assert.deepStrictEqual(cleanReport.diagnostics, []);
    assert.strictEqual(process.exitCode, 0);

    // 4. Project with template validation warnings check -j
    console.log('  Testing checkProject with -j on project with template warnings...');
    const invalidCompPath = path.join(FIXTURE_DIR, 'src', 'components', 'header.component.js');
    fs.writeFileSync(
      invalidCompPath,
      '<div>Hello {{ undeclaredUser }}</div>'
    );

    const warningReport = checkProject(mockCli, ['-j']);
    assert.strictEqual(warningReport.valid, false);
    assert.strictEqual(warningReport.errorCount, 0);
    assert.strictEqual(warningReport.warningCount, 1);
    assert.strictEqual(warningReport.diagnostics.length, 1);
    assert.strictEqual(warningReport.diagnostics[0].code, 'AVX_W03');
    assert.strictEqual(warningReport.diagnostics[0].severity, 'warning');
    assert.ok(warningReport.diagnostics[0].message.includes('undeclaredUser'));
    assert.strictEqual(warningReport.diagnostics[0].line, 1, 'diagnostic carries line number');
    assert.strictEqual(warningReport.diagnostics[0].column, 12, 'diagnostic carries column number');
    assert.ok(warningReport.diagnostics[0].frame, 'diagnostic carries code frame');
    assert.strictEqual(process.exitCode, 1);

    // 5. Project with an unresolved component reference (AVX_W46) check --json
    console.log('Testing checkProject with --json on an unresolved component reference...');
    fs.rmSync(invalidCompPath, { force: true });
    // A real, registered component derives its name from the filename:
    // user-card.component.js -> UserCard.
    fs.writeFileSync(
      path.join(FIXTURE_DIR, 'src', 'components', 'user-card.component.js'),
      '<div>card</div>'
    );
    // A component that references it with a typo.
    fs.writeFileSync(
      path.join(FIXTURE_DIR, 'src', 'components', 'home.component.js'),
      '<div><UserCrad /></div>'
    );

    const unresolvedReport = checkProject(mockCli, ['--json']);
    assert.strictEqual(unresolvedReport.valid, false, 'the report is not valid');
    const w46 = unresolvedReport.diagnostics.filter((d) => d.code === 'AVX_W46');
    assert.strictEqual(w46.length, 1, 'exactly one AVX_W46 diagnostic is emitted');
    assert.strictEqual(w46[0].severity, 'warning');
    assert.ok(w46[0].message.includes('UserCrad'), 'the diagnostic names the offending tag');
    assert.ok(w46[0].message.includes('UserCard'), 'the diagnostic suggests the closest name');
    assert.ok(w46[0].file && w46[0].file.includes('home.component.js'), 'the diagnostic carries the file');
    assert.strictEqual(w46[0].line, 1, 'AVX_W46 carries line number');
    assert.strictEqual(w46[0].column, 6, 'AVX_W46 carries column number');
    assert.ok(w46[0].frame, 'AVX_W46 carries frame');
    assert.strictEqual(process.exitCode, 1);

    // 6. Global console methods are never monkey-patched
    console.log('  Testing global console methods remain untouched...');
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalLog = console.log;
    checkProject(mockCli, ['--json']);
    assert.strictEqual(console.warn, originalWarn, 'console.warn was not monkey-patched');
    assert.strictEqual(console.error, originalError, 'console.error was not monkey-patched');
    assert.strictEqual(console.log, originalLog, 'console.log was not monkey-patched');

    // 7. Structured diagnostic record for custom/rephrased messages
    console.log('  Testing diagnostic with custom message that does not match legacy regexes...');
    const customRecord = createDiagnosticRecord(
      'warning',
      'AVX_W99',
      new Error('Arbitrary custom prose with no matching keywords or file mentions'),
      {},
      {
        filename: 'src/custom/special.component.js',
        line: 42,
        column: 15,
      },
    );
    assert.strictEqual(customRecord.code, 'AVX_W99');
    assert.strictEqual(customRecord.severity, 'warning');
    assert.strictEqual(customRecord.file, 'src/custom/special.component.js');
    assert.strictEqual(customRecord.line, 42);
    assert.strictEqual(customRecord.column, 15);
    assert.strictEqual(customRecord.message, 'Arbitrary custom prose with no matching keywords or file mentions');

    // 8. Rephrasing does not change JSON fields
    console.log('  Testing rephrasing message preserves structured fields...');
    const rec1 = createDiagnosticRecord('warning', 'AVX_W03', new Error('Original phrasing'), {}, { filename: 'header.component.js', line: 10, column: 5 });
    const rec2 = createDiagnosticRecord('warning', 'AVX_W03', new Error('Completely altered text'), {}, { filename: 'header.component.js', line: 10, column: 5 });
    assert.strictEqual(rec1.file, rec2.file);
    assert.strictEqual(rec1.code, rec2.code);
    assert.strictEqual(rec1.severity, rec2.severity);
    assert.strictEqual(rec1.line, rec2.line);
    assert.strictEqual(rec1.column, rec2.column);

    // 9. Diagnostic schema file exists and is valid JSON Schema
    console.log('  Testing diagnostic JSON schema...');
    const schemaPath = path.resolve(__dirname, '../../lib/compiler/diagnostics/diagnostic.schema.json');
    assert.ok(fs.existsSync(schemaPath), 'diagnostic.schema.json must exist');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    assert.strictEqual(schema.title, 'AvenxDiagnosticRecord');
    assert.deepStrictEqual(schema.required, ['file', 'code', 'severity', 'message']);

    // Cleanup fixture
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });

    console.log('✅ All avenx check --json unit tests passed successfully!');
    process.exit(0);
  } catch (error) {
    if (fs.existsSync(FIXTURE_DIR)) {
      fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
    console.error('❌ avenx check --json unit tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
