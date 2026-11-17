/**
 * @file diagnosticChannel.test.js
 * @description Unit tests for the compiler structured diagnostic channel (Issue #1260).
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DiagnosticChannel,
  createDiagnosticRecord,
} from '../../lib/compiler/diagnostics/DiagnosticChannel.js';
import { reportWarning } from '../../lib/compiler/utils/warningReporter.js';
import { TemplateValidationError } from '../../lib/compiler/errors/index.js';
import AvenxCompiler from '../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  try {
    console.log('🧪 Testing DiagnosticChannel and structured diagnostic records...');

    // 1. DiagnosticChannel pub/sub and collection
    console.log('  Testing DiagnosticChannel pub/sub...');
    const channel = new DiagnosticChannel();
    assert.strictEqual(channel.length, 0);

    const received = [];
    const unsubscribe = channel.subscribe((rec) => received.push(rec));

    channel.emit({ file: 'a.js', code: 'AVX_W01', severity: 'warning', message: 'test warning' });
    assert.strictEqual(channel.length, 1);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].code, 'AVX_W01');

    unsubscribe();
    channel.push({ file: 'b.js', code: 'AVX_C01', severity: 'error', message: 'test error' });
    assert.strictEqual(channel.length, 2);
    assert.strictEqual(received.length, 1, 'unsubscribed listener receives no further records');

    // Array-like methods
    const warnings = channel.filter((d) => d.severity === 'warning');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].file, 'a.js');

    // 2. createDiagnosticRecord from CompilerError with location
    console.log('  Testing createDiagnosticRecord from CompilerError...');
    const source = '<template>\n  <div>{{ badVar }}</div>\n</template>';
    const err = new TemplateValidationError('AVX_W03', 'badVar', 'MyComp.component.js');
    err.setLocation({
      source,
      line: 2,
      column: 11,
      filename: 'src/components/MyComp.component.js',
      length: 6,
    });

    const rec = createDiagnosticRecord('warning', err);
    assert.strictEqual(rec.code, 'AVX_W03');
    assert.strictEqual(rec.severity, 'warning');
    assert.strictEqual(rec.file, 'src/components/MyComp.component.js');
    assert.strictEqual(rec.line, 2);
    assert.strictEqual(rec.column, 11);
    assert.ok(rec.frame, 'code frame should be extracted');
    assert.ok(!rec.message.includes('^'), 'code frame should be split from clean message');
    assert.ok(rec.message.includes('badVar'));

    // 3. createDiagnosticRecord with code, error, and explicit location
    console.log('  Testing createDiagnosticRecord with explicit location object...');
    const rec2 = createDiagnosticRecord(
      'error',
      'AVX_C10',
      new Error('Custom error message without code bracket'),
      {},
      { filename: 'src/pages/index.page.js', line: 15, column: 3 },
    );
    assert.strictEqual(rec2.code, 'AVX_C10');
    assert.strictEqual(rec2.severity, 'error');
    assert.strictEqual(rec2.file, 'src/pages/index.page.js');
    assert.strictEqual(rec2.line, 15);
    assert.strictEqual(rec2.column, 3);
    assert.strictEqual(rec2.message, 'Custom error message without code bracket');

    // 4. reportWarning writes structured record to config.diagnostics sink
    console.log('  Testing reportWarning routing to config.diagnostics...');
    const sink = [];
    reportWarning('AVX_W03', err, { diagnostics: sink, json: true });
    assert.strictEqual(sink.length, 1);
    assert.strictEqual(sink[0].code, 'AVX_W03');
    assert.strictEqual(sink[0].file, 'src/components/MyComp.component.js');
    assert.strictEqual(sink[0].line, 2);
    assert.strictEqual(sink[0].column, 11);
    assert.strictEqual(sink[0].severity, 'warning');

    // 5. AvenxCompiler instance diagnostics and onDiagnostic
    console.log('  Testing AvenxCompiler onDiagnostic emitter...');
    const compilerSink = [];
    const compiler = new AvenxCompiler({
      rootDir: process.cwd(),
      srcDir: 'src',
      distDir: 'dist',
      diagnostics: compilerSink,
    });

    const emitted = [];
    compiler.onDiagnostic((d) => emitted.push(d));

    compiler.emitDiagnostic({
      file: 'test.js',
      code: 'AVX_W99',
      severity: 'warning',
      message: 'emitter test',
    });

    assert.strictEqual(compilerSink.length, 1);
    assert.strictEqual(emitted.length, 1);
    assert.strictEqual(emitted[0].code, 'AVX_W99');

    // 6. JSON schema validation
    console.log('  Testing JSON schema structure against produced records...');
    const schemaPath = path.resolve(__dirname, '../../lib/compiler/diagnostics/diagnostic.schema.json');
    assert.ok(fs.existsSync(schemaPath), 'schema file must exist');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

    for (const testRecord of [rec, rec2, sink[0]]) {
      for (const requiredProp of schema.required) {
        assert.ok(requiredProp in testRecord, `Record must contain required property "${requiredProp}"`);
      }
      assert.match(testRecord.code, new RegExp(schema.properties.code.pattern));
      assert.ok(['warning', 'error'].includes(testRecord.severity));
      if (testRecord.line !== undefined) {
        assert.strictEqual(typeof testRecord.line, 'number');
        assert.ok(testRecord.line >= 1);
      }
      if (testRecord.column !== undefined) {
        assert.strictEqual(typeof testRecord.column, 'number');
        assert.ok(testRecord.column >= 1);
      }
    }

    console.log('✅ All DiagnosticChannel unit tests passed successfully!');
  } catch (error) {
    console.error('❌ DiagnosticChannel unit tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
