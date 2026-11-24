import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareDiagnosticDocs, checkDiagnosticDocs } from '../../scripts/check-diagnostic-docs.js';

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-diagnostic-docs-'));

try {
  const docs = path.join(root, 'docs');
  const troubleshooting = path.join(docs, 'troubleshooting');
  const guides = path.join(docs, 'guides');
  fs.mkdirSync(troubleshooting, { recursive: true });
  fs.mkdirSync(guides, { recursive: true });

  const referenceFile = path.join(troubleshooting, 'errors.md');
  fs.writeFileSync(referenceFile, '# Diagnostics\n\nAVX_A01\n');
  fs.writeFileSync(path.join(guides, 'guide.mdx'), 'This guide mentions AVX_OLD01.\n');
  fs.writeFileSync(path.join(guides, 'not-markdown.txt'), 'AVX_OLD02\n');

  const result = compareDiagnosticDocs({
    catalogueCodes: ['AVX_A01', 'AVX_B02'],
    referenceFile,
    docsDirectory: docs,
  });

  assert.deepStrictEqual(result.undocumented, ['AVX_B02']);
  assert.deepStrictEqual(result.stale, [{ code: 'AVX_OLD01', files: ['guides/guide.mdx'] }]);

  const messages = [];
  const clean = checkDiagnosticDocs({
    catalogueCodes: ['AVX_A01'],
    referenceFile,
    docsDirectory: docs,
    report: (message) => messages.push(message),
  });
  assert.deepStrictEqual(clean, { undocumented: [], stale: [{ code: 'AVX_OLD01', files: ['guides/guide.mdx'] }] });
  assert.ok(messages.some((message) => message.includes('AVX_OLD01')));
  assert.ok(messages.some((message) => message.includes('remove each stale mention')));

  const withException = compareDiagnosticDocs({
    catalogueCodes: ['AVX_A01', 'AVX_B02'],
    referenceFile,
    docsDirectory: docs,
    exceptions: { AVX_B02: 'Intentionally internal and not part of the public troubleshooting reference.' },
  });
  assert.deepStrictEqual(withException.undocumented, []);
  console.log('Diagnostic documentation consistency tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
