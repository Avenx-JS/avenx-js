/**
 * @file compilerSnapshots.js
 * @description Snapshot the template IR and generated render-program output.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProgramTables } from '../lib/compiler/codegen/table.js';
import { buildTemplateIR } from '../lib/compiler/ir/build.js';
import { lowerToProgram } from '../lib/compiler/ir/lower.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(__dirname, '../test/fixtures/compiler-snapshots/templates');
const snapshotPath = path.join(__dirname, '../test/unit/snapshots/compiler-output.json');
const updateSnapshots = process.env.AVENX_UPDATE_SNAPSHOTS === '1';

const fixtureFiles = fs
  .readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith('.html'))
  .sort();

const output = Object.fromEntries(
  fixtureFiles.map((file) => {
    const template = fs.readFileSync(path.join(fixtureDirectory, file), 'utf8').replace(/\r\n?/g, '\n');
    const built = buildTemplateIR(template);
    assert.equal(built.refusal, null, `${file}: IR refused: ${JSON.stringify(built.refusal)}`);

    const lowered = lowerToProgram(built.ir);
    assert.equal(lowered.refusal, null, `${file}: lowering refused: ${JSON.stringify(lowered.refusal)}`);

    const generated = buildProgramTables('Snapshot', lowered.expressions, lowered.statements);
    assert.equal(generated.failure, null, `${file}: code generation failed: ${JSON.stringify(generated.failure)}`);

    return [
      file,
      {
        ir: built.ir,
        program: lowered.program,
        expressions: lowered.expressions,
        statements: lowered.statements,
        generatedSource: generated.source,
      },
    ];
  }),
);

if (updateSnapshots) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`✅ Updated compiler snapshots: ${path.relative(path.join(__dirname, '..'), snapshotPath)}`);
} else {
  assert.ok(
    fs.existsSync(snapshotPath),
    `Compiler snapshot file is missing. Run "npm run test:snapshots:update" to create it.`,
  );
  const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  assert.deepStrictEqual(
    output,
    expected,
    'Compiler output changed. Review the output diff, then run "npm run test:snapshots:update" to accept it.',
  );
  console.log(`✅ Compiler snapshots match (${fixtureFiles.length} templates).`);
}
