/**
 * @file check-readme-figures.js
 * @description Recomputes the counted figures README.md states and fails when
 * one is out of date.
 *
 * Every figure is measured the way the README says it is: the test-file counts
 * by the globs it names, the bundle figures by scaffolding a fresh application
 * with `avenx init -y`, `avenx generate component hello` and `avenx build`,
 * then reading `avenx stats --json`.
 *
 * Tolerances:
 * - Counts (test files, fixtures, modules, plugin suites) must match exactly.
 * - Sizes (KB) may differ from the measurement by SIZE_TOLERANCE (2 %), and
 *   never by less than SIZE_FLOOR_KB (0.01 KB), so the two-decimal rounding
 *   of a small figure such as 0.31 KB cannot fail on its own. A runtime change
 *   of a few bytes stays green; a figure that is genuinely stale does not. Gzip
 *   output also varies slightly between zlib versions, which the band absorbs.
 * - Figures the README marks as approximate ("~250") may differ by
 *   APPROX_TOLERANCE (10 %).
 *
 * Usage: node scripts/check-readme-figures.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SIZE_TOLERANCE = 0.02;
export const SIZE_FLOOR_KB = 0.01;
export const APPROX_TOLERANCE = 0.1;

/**
 * The figures README.md states. `pattern` locates the figure, `group` picks
 * the capture, `measure` names the measured value it is compared with, and
 * `kind` selects the tolerance.
 */
export const FIGURES = [
  { label: 'Unit test files', measure: 'unitFiles', kind: 'exact', pattern: /^\| Unit \| (\d+) files \|/m },
  {
    label: 'Integration test files',
    measure: 'integrationFiles',
    kind: 'exact',
    pattern: /^\| Integration \| (\d+) files \|/m,
  },
  {
    label: 'System / CLI test files',
    measure: 'systemFiles',
    kind: 'exact',
    pattern: /^\| System \/ CLI \| (\d+) files \|/m,
  },
  {
    label: 'E2E test declarations',
    measure: 'e2eDeclarations',
    kind: 'approx',
    pattern: /^\| Browser \(E2E, Chromium\) \| ~(\d+) test declarations \|/m,
  },
  { label: 'Plugin suites', measure: 'pluginSuites', kind: 'exact', pattern: /^\| Plugins \| (\d+) suites \|/m },
  {
    label: 'E2E fixture directories',
    measure: 'e2eFixtures',
    kind: 'exact',
    pattern: /The (\d+) fixture directories can be counted/,
  },
  {
    label: 'E2E fixture applications',
    measure: 'e2eFixtures',
    kind: 'exact',
    pattern: /compiles (\d+) real fixture applications/,
  },
  {
    label: 'bundle.js raw (KB)',
    measure: 'jsKb',
    kind: 'size',
    pattern: /^\| `bundle\.js` \| ([\d.]+) KB \| ([\d.]+) KB \|/m,
  },
  {
    label: 'bundle.js gzipped (KB)',
    measure: 'jsGzipKb',
    kind: 'size',
    group: 2,
    pattern: /^\| `bundle\.js` \| ([\d.]+) KB \| ([\d.]+) KB \|/m,
  },
  {
    label: 'bundle.css raw (KB)',
    measure: 'cssKb',
    kind: 'size',
    pattern: /^\| `bundle\.css` \| ([\d.]+) KB \| ([\d.]+) KB \|/m,
  },
  {
    label: 'bundle.css gzipped (KB)',
    measure: 'cssGzipKb',
    kind: 'size',
    group: 2,
    pattern: /^\| `bundle\.css` \| ([\d.]+) KB \| ([\d.]+) KB \|/m,
  },
  { label: 'Bundled modules', measure: 'modulesEmitted', kind: 'exact', pattern: /`(\d+) modules · (\d+) shaken out`/ },
  {
    label: 'Modules shaken out',
    measure: 'modulesShaken',
    kind: 'exact',
    group: 2,
    pattern: /`(\d+) modules · (\d+) shaken out`/,
  },
];

/**
 * Reads every figure README.md states. A figure whose sentence was reworded
 * is reported as missing rather than silently skipped.
 * @param {string} readme - README.md contents.
 * @returns {{ figures: object[], missing: string[] }} Stated figures and labels not found.
 */
export function readStatedFigures(readme) {
  const figures = [];
  const missing = [];
  for (const figure of FIGURES) {
    const match = readme.match(figure.pattern);
    if (match) figures.push({ ...figure, stated: Number(match[figure.group || 1]) });
    else missing.push(figure.label);
  }
  return { figures, missing };
}

/**
 * Decides whether a stated figure is within its tolerance of the measurement.
 * @param {string} kind - 'exact', 'size' or 'approx'.
 * @param {number} stated - The figure in the README.
 * @param {number} actual - The measured value, unrounded.
 * @returns {boolean} True when the figure is current.
 */
export function withinTolerance(kind, stated, actual) {
  if (kind === 'size') return Math.abs(actual - stated) <= Math.max(stated * SIZE_TOLERANCE, SIZE_FLOOR_KB);
  if (kind === 'approx') return Math.abs(actual - stated) <= stated * APPROX_TOLERANCE;
  return actual === stated;
}

/**
 * Compares stated figures with measurements.
 * @param {object[]} figures - Output of readStatedFigures().figures.
 * @param {Record<string, number>} measured - Measured values by `measure` key.
 * @returns {string[]} One line per stale figure.
 */
export function compareFigures(figures, measured) {
  return figures
    .filter((figure) => !withinTolerance(figure.kind, figure.stated, measured[figure.measure]))
    .map((figure) => {
      const actual = figure.kind === 'size' ? measured[figure.measure].toFixed(2) : measured[figure.measure];
      return `  ${figure.label}: README says ${figure.stated}, measured ${actual}`;
    });
}

const countTestFiles = (directory) =>
  fs.readdirSync(path.join(root, directory)).filter((name) => name.endsWith('.test.js')).length;

/**
 * Counts `test(` the way `grep -RhoE 'test[[:space:]]*\(' test/e2e/specs` does:
 * every occurrence on every line of every file.
 * @param {string} directory - Directory to search.
 * @returns {number} Occurrence count.
 */
function countTestDeclarations(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countTestDeclarations(file);
    else count += (fs.readFileSync(file, 'utf8').match(/test[ \t\r\f\v]*\(/g) || []).length;
  }
  return count;
}

/**
 * Runs the avenx CLI in a directory and fails loudly when it does.
 * @param {string} cwd - Working directory.
 * @param {string[]} args - CLI arguments.
 * @returns {string} Standard output.
 */
function avenx(cwd, args) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin/avenx.js'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `avenx ${args.join(' ')} failed: ${result.error || `exit ${result.status}`}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

/**
 * Scaffolds the README's reference application and measures its build.
 * @returns {Record<string, number>} Bundle measurements.
 */
function measureBuild() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-readme-figures-'));
  try {
    avenx(scratch, ['init', '-y']);
    avenx(scratch, ['generate', 'component', 'hello']);
    avenx(scratch, ['build']);
    const { bundle } = JSON.parse(avenx(scratch, ['stats', '--json']));
    // `stats --json` reports the script bundle only; the stylesheet is
    // measured the way `avenx build` prints it.
    const css = fs.readFileSync(path.join(scratch, 'dist/bundle.css'));
    return {
      jsKb: bundle.bytes / 1024,
      jsGzipKb: bundle.gzipBytes / 1024,
      cssKb: css.length / 1024,
      cssGzipKb: zlib.gzipSync(css).length / 1024,
      modulesEmitted: bundle.modulesEmitted,
      modulesShaken: bundle.modulesShaken,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Measures every figure the README states.
 * @returns {Record<string, number>} Measured values by `measure` key.
 */
export function measureFigures() {
  const testPlugins = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:plugins'];
  return {
    unitFiles: countTestFiles('test/unit'),
    integrationFiles: countTestFiles('test/integration'),
    systemFiles: countTestFiles('test/system'),
    e2eDeclarations: countTestDeclarations(path.join(root, 'test/e2e/specs')),
    e2eFixtures: fs
      .readdirSync(path.join(root, 'test/e2e/apps'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length,
    pluginSuites: (testPlugins.match(/npm --prefix plugins\//g) || []).length,
    ...measureBuild(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { figures, missing } = readStatedFigures(fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
    const stale = compareFigures(figures, measureFigures());
    const problems = [...missing.map((label) => `  ${label}: not found in README.md (sentence reworded?)`), ...stale];
    if (problems.length) {
      console.error(
        `README.md figures are out of date:\n${problems.join('\n')}\n` +
          'Update the figures in README.md and their "verified" dates, then rerun npm run test:readme-figures.',
      );
      process.exitCode = 1;
    } else {
      console.log(`README.md figures: all ${figures.length} current.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
