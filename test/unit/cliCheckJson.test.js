import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkProject, parseDiagnostic } from '../../bin/commands/build.js';

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
      `export default {
  name: 'HeaderComponent',
  template: '<div>Hello {{ undeclaredUser }}</div>'
};`
    );

    const warningReport = checkProject(mockCli, ['-j']);
    assert.strictEqual(warningReport.valid, false);
    assert.strictEqual(warningReport.errorCount, 0);
    assert.strictEqual(warningReport.warningCount, 1);
    assert.strictEqual(warningReport.diagnostics.length, 1);
    assert.strictEqual(warningReport.diagnostics[0].code, 'AVX_W03');
    assert.strictEqual(warningReport.diagnostics[0].severity, 'warning');
    assert.ok(warningReport.diagnostics[0].message.includes('undeclaredUser'));
    assert.strictEqual(process.exitCode, 1);

    // 5. Project with an unresolved component reference (AVX_W46) check --json
    console.log('Testing checkProject with --json on an unresolved component reference...');
    fs.rmSync(invalidCompPath, { force: true });
    // A real, registered component derives its name from the filename:
    // user-card.component.js -> UserCard.
    fs.writeFileSync(
      path.join(FIXTURE_DIR, 'src', 'components', 'user-card.component.js'),
      `export default {
        name: 'UserCard',
        template: '<div>card</div>'
      };`
    );
    // A component that references it with a typo.
    fs.writeFileSync(
      path.join(FIXTURE_DIR, 'src', 'components', 'home.component.js'),
      `export default {
        name: 'Home',
        template: '<div><UserCrad /></div>'
      };`
    );

    const unresolvedReport = checkProject(mockCli, ['--json']);
    assert.strictEqual(unresolvedReport.valid, false, 'the report is not valid');
    const w46 = unresolvedReport.diagnostics.filter((d) => d.code === 'AVX_W46');
    assert.strictEqual(w46.length, 1, 'exactly one AVX_W46 diagnostic is emitted');
    assert.strictEqual(w46[0].severity, 'warning');
    assert.ok(w46[0].message.includes('UserCrad'), 'the diagnostic names the offending tag');
    assert.ok(w46[0].message.includes('UserCard'), 'the diagnostic suggests the closest name');
    assert.ok(w46[0].file && w46[0].file.includes('home.component.js'), 'the diagnostic carries the file');
    assert.strictEqual(process.exitCode, 1);

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
