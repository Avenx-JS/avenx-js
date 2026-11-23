import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { toSarif } from '../../lib/compiler/diagnostics/sarif.js';
import { DIAGNOSTIC_CATALOGUE } from '../../lib/core/diagnostics/catalogue.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('../fixtures/sarif/sarif-schema-2.1.0.json', import.meta.url))));
function valid(log) {
  assert.ok(validate(log), JSON.stringify(validate.errors));
  return log.runs[0];
}
valid(toSarif({ diagnostics: Object.values(DIAGNOSTIC_CATALOGUE).map((rule) => ({
  code: rule.code, severity: rule.severity, message: rule.summary,
})) }));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-sarif-'));
function run(...args) {
  return spawnSync(process.execPath, [path.join(root, 'bin/avenx.js'), 'check', ...args], {
    cwd: temporary, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}
try {
  fs.mkdirSync(path.join(temporary, 'src/components'), { recursive: true });
  fs.writeFileSync(path.join(temporary, 'avenx.config.json'), '{}');
  const clean = run('--sarif');
  assert.equal(clean.status, run('--json').status);
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(valid(JSON.parse(clean.stdout)).results, []);

  const component = path.join(temporary, 'src/components/header.component.js');
  fs.writeFileSync(component, '<div>Hello {{ undeclaredUser }}</div>');
  const json = run('--json');
  const sarif = run('--sarif');
  assert.equal(sarif.status, json.status);
  assert.equal(sarif.status, 1);
  const report = JSON.parse(json.stdout);
  const output = JSON.parse(sarif.stdout);
  const sarifRun = valid(output);
  assert.equal(sarifRun.results.length, report.diagnostics.length);
  const warning = sarifRun.results.find((r) => r.ruleId === 'AVX_W03');
  assert.equal(warning.level, 'warning');
  assert.deepEqual(warning.locations[0].physicalLocation, {
    artifactLocation: { uri: 'src/components/header.component.js' },
    region: { startLine: 1, startColumn: 12 },
  });
  const rule = sarifRun.tool.driver.rules[warning.ruleIndex];
  assert.equal(rule.id, warning.ruleId);
  assert.equal(rule.name, DIAGNOSTIC_CATALOGUE.AVX_W03.name);
  assert.equal(rule.helpUri, DIAGNOSTIC_CATALOGUE.AVX_W03.docsUrl);

  for (const option of [['--out', 'report.sarif'], ['--out=report.sarif'], ['-o', 'report.sarif']]) {
    const result = run('--sarif', ...option);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '', 'file output must leave stdout empty');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temporary, 'report.sarif'), 'utf8')), output);
  }
  for (const args of [['--sarif', '--out'], ['--sarif', '--out='], ['--sarif', '--json'],
    ['--sarif', '--watch'], ['--sarif', '--out', 'missing/report.sarif']]) {
    assert.equal(run(...args).status, 1, args.join(' '));
  }

  // Accessibility warnings retain the normal check/strict check exit contract.
  fs.writeFileSync(component, '<img src="photo.png">');
  for (const args of [[], ['--strict']]) {
    const result = run('--sarif', ...args);
    assert.equal(result.status, run('--json', ...args).status);
    valid(JSON.parse(result.stdout));
  }

  const special = path.join(temporary, 'src/a # ü.js');
  const synthetic = toSarif({ diagnostics: [
    { code: 'AVX_W03', severity: 'error', message: 'Escalated', file: special, line: 3, column: 7 },
    { code: 'AVX_W03', severity: 'warning', message: 'No position', file: pathToFileURL(special).href },
    { code: 'AVX_UNK', severity: 'error', message: 'No file', file: null, line: 0, column: 0 },
  ] }, temporary);
  const findings = valid(synthetic).results;
  assert.equal(findings[0].level, 'error');
  assert.equal(findings[0].locations[0].physicalLocation.artifactLocation.uri, 'src/a%20%23%20%C3%BC.js');
  assert.ok(!('region' in findings[1].locations[0].physicalLocation));
  assert.ok(!('locations' in findings[2]));
  const windows = valid(toSarif({ diagnostics: [
    { code: 'AVX_W03', severity: 'warning', message: 'Windows', file: 'C:\\project\\src\\a #.js' },
  ] }, 'C:\\project'));
  assert.equal(windows.results[0].locations[0].physicalLocation.artifactLocation.uri, 'src/a%20%23.js');
  console.log('SARIF passes the official schema, real CLI output/file modes, location and exit-code checks.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
