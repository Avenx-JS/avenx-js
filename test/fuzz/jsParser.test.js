/** Generated and damaged JavaScript differential corpora: nightly/on-demand fuzz tier. */
// @avenx-no-dev-runtime
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { differential, listJsFiles } from '../helpers/parserOracle.js';
import { generateProgram, mutate, Rng } from '../helpers/jsSyntaxFuzzer.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * How many generated programs and mutations to try.
 *
 * Local runs use 2,000 cases per corpus; nightly runs use 20,000 unless
 * FAST_CHECK_NUM_RUNS explicitly selects a count.
 * @type {number}
 */
const iterations = process.env.FAST_CHECK_NUM_RUNS
  ? parseInt(process.env.FAST_CHECK_NUM_RUNS, 10)
  : process.env.CI_FUZZ
    ? 20000
    : 2000;

// ---------------------------------------------------------------------------
// 3. Generated programs.
// ---------------------------------------------------------------------------

for (let seed = 1; seed <= iterations; seed += 1) {
  const source = generateProgram(seed);
  for (const sourceType of ['script', 'module']) {
    const difference = differential(source, { sourceType, locations: true });
    assert.strictEqual(
      difference,
      null,
      `generated seed ${seed} as ${sourceType}: ${difference}\n--- source ---\n${source}\n`,
    );
  }
}
console.log(`  ✅ ${iterations} generated programs parse identically as scripts and as modules.`);

// ---------------------------------------------------------------------------
// 4. Damaged sources: agreement on refusal.
// ---------------------------------------------------------------------------

const mutationCorpus = listJsFiles(path.join(rootDir, 'lib')).slice(0, 80);
const rng = new Rng(20261106);
for (let i = 0; i < iterations; i += 1) {
  const file = mutationCorpus[rng.int(mutationCorpus.length)];
  const source = fs.readFileSync(file, 'utf8');
  const from = rng.int(Math.max(1, source.length - 500));
  const slice = source.slice(from, from + 200 + rng.int(400));
  const damaged = mutate(slice, i + 1);
  for (const sourceType of ['script', 'module']) {
    const difference = differential(damaged, { sourceType });
    assert.strictEqual(
      difference,
      null,
      `mutation ${i} of ${path.relative(rootDir, file)} as ${sourceType}: ${difference}\n--- source ---\n${damaged}\n`,
    );
  }
}
console.log(`  ✅ ${iterations} damaged sources are accepted or refused identically.`);

console.log('\n✅ JavaScript parser differential tests passed');
