import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIGURES, compareFigures, readStatedFigures, withinTolerance } from '../../scripts/check-readme-figures.js';

// Every figure the check knows must still be found in the real README: a
// reworded sentence would otherwise drop out of the check without notice.
const readme = fs.readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
const { figures, missing } = readStatedFigures(readme);
assert.deepEqual(missing, [], 'README figures the check cannot locate');
assert.equal(figures.length, FIGURES.length);

// Counts are exact.
assert.ok(withinTolerance('exact', 305, 305));
assert.ok(!withinTolerance('exact', 305, 306));

// Sizes: a 2 % band, never narrower than 0.01 KB.
assert.ok(withinTolerance('size', 380.56, 380.57), 'a few bytes must not fail');
assert.ok(withinTolerance('size', 380.56, 380.56 * 1.02));
assert.ok(!withinTolerance('size', 371.62, 380.56), 'the stale figure from #1990 must fail');
assert.ok(withinTolerance('size', 0.31, 0.3149), 'two-decimal rounding of a small figure must not fail');
assert.ok(!withinTolerance('size', 0.31, 0.33));

// Approximate figures ("~210"): a 10 % band.
assert.ok(withinTolerance('approx', 210, 213));
assert.ok(!withinTolerance('approx', 250, 213));

// A stale figure is named with both values.
const sample = readStatedFigures('| Unit | 249 files | `npm run test:unit` |').figures;
assert.deepEqual(compareFigures(sample, { unitFiles: 305 }), ['  Unit test files: README says 249, measured 305']);
assert.deepEqual(compareFigures(sample, { unitFiles: 249 }), []);

console.log('README figure parsing and tolerances behave as documented.');
