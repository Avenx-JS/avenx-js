/**
 * @file bench-compare.js
 * @description Measures the benchmarks on two checkouts and compares them.
 *
 * What `size-check.js` does for bytes, for timings:
 *
 *     node scripts/bench-compare.js measure --base base --pr . --rounds 5 --out bench-samples.json
 *     node scripts/bench-compare.js compare --samples bench-samples.json --markdown bench-report.md [--override]
 *
 * `measure` runs each checkout's own `benches/run.js --json` -- the same output
 * the weekly publish uses -- `rounds` times per side, interleaved so the two
 * sides share the runner's conditions. `compare` takes the median of each
 * benchmark's samples, reports every benchmark, and exits 1 when one listed in
 * `benches/regression-gate.js` regresses beyond its threshold.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

/**
 * The marker the workflow looks for to update its comment in place.
 */
export const COMMENT_MARKER = '### ⏱️ Benchmark Comparison';

/**
 * Parses `--key value` and `--flag` arguments after the action.
 * @param {string[]} argv - Arguments after the action.
 * @returns {Record<string, string|boolean>} Parsed arguments.
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value !== undefined && !value.startsWith('--')) {
      args[arg.slice(2)] = value;
      i++;
    } else {
      args[arg.slice(2)] = true;
    }
  }
  return args;
}

/**
 * Median of a list of numbers.
 * @param {number[]} values - Samples.
 * @returns {number} The median, or NaN for an empty list.
 */
export function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Relative spread of the samples, (max - min) / median, in percent.
 * @param {number[]} values - Samples.
 * @returns {number} The spread, or NaN when it cannot be computed.
 */
export function spread(values) {
  const mid = median(values);
  if (!(mid > 0)) return NaN;
  return ((Math.max(...values) - Math.min(...values)) / mid) * 100;
}

/**
 * Runs one checkout's benchmark suite once.
 *
 * The runner exits 1 when any benchmark fails, but still prints the JSON for
 * the rest, so a crash in one benchmark on the base branch does not discard
 * the baseline for every other one. The failed files are recovered from its
 * stderr summary.
 * @param {string} repo - Checkout root.
 * @returns {{results: Array<{file: string, avgTime: number}>, failed: string[]}} One run.
 */
function runSuite(repo) {
  const result = spawnSync(process.execPath, [path.join(repo, 'benches', 'run.js'), '--json'], {
    cwd: repo,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  let results;
  try {
    results = JSON.parse(result.stdout || '[]');
  } catch {
    throw new Error(`benches/run.js in ${repo} printed no JSON (exit ${result.status}):\n${result.stderr}`);
  }
  const failed = [...(result.stderr || '').matchAll(/^ {2}(\S+\.bench\.js) \(exit -?\d+\)/gm)].map((m) => m[1]);
  return { results, failed };
}

/**
 * Measures both checkouts, interleaved.
 *
 * The order alternates in pairs -- base, PR, PR, base, base, PR -- so neither
 * side always runs first, and a drift across the job (a warming CPU, a
 * neighbour on the host finishing) lands on both sides equally.
 * @param {object} options - Measurement options.
 * @param {string} options.base - Base checkout root.
 * @param {string} options.pr - PR checkout root.
 * @param {number} options.rounds - Runs per side.
 * @returns {object} Samples per side and the conditions they were taken under.
 */
export function measure({ base, pr, rounds }) {
  const sides = { base: { repo: base, samples: {}, failed: {} }, pr: { repo: pr, samples: {}, failed: {} } };
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? ['base', 'pr'] : ['pr', 'base'];
    for (const side of order) {
      const started = Date.now();
      const { results, failed } = runSuite(path.resolve(sides[side].repo));
      for (const entry of results) {
        if (failed.includes(entry.file)) continue;
        (sides[side].samples[entry.file] ??= []).push(entry.avgTime);
      }
      for (const file of failed) {
        sides[side].failed[file] = (sides[side].failed[file] || 0) + 1;
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`round ${round + 1}/${rounds} ${side.padEnd(4)} ${seconds}s${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`);
    }
  }
  return {
    rounds,
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model?.trim() || 'unknown',
      cpus: os.cpus().length,
    },
    base: { samples: sides.base.samples, failed: sides.base.failed },
    pr: { samples: sides.pr.samples, failed: sides.pr.failed },
  };
}

/**
 * Compares measured samples against the gate.
 * @param {object} measured - Output of `measure`.
 * @param {object} gate - The gate configuration.
 * @param {Record<string, number>} gate.gating - File to threshold in percent.
 * @returns {{rows: object[], failures: object[]}} One row per benchmark, and the gating failures.
 */
export function compare(measured, { gating }) {
  const files = [...new Set([
    ...Object.keys(measured.base.samples),
    ...Object.keys(measured.pr.samples),
    ...Object.keys(measured.base.failed),
    ...Object.keys(measured.pr.failed),
  ])].sort();

  const rows = files.map((file) => {
    const baseSamples = measured.base.samples[file] || [];
    const prSamples = measured.pr.samples[file] || [];
    const threshold = gating[file];
    const row = {
      file,
      threshold,
      base: median(baseSamples),
      pr: median(prSamples),
      baseSpread: spread(baseSamples),
      prSpread: spread(prSamples),
      baseFailed: measured.base.failed[file] || 0,
      prFailed: measured.pr.failed[file] || 0,
      status: 'ok',
    };

    if (row.prFailed > 0 && row.baseFailed === 0) {
      row.status = 'crashed';
    } else if (row.prFailed > 0 || prSamples.length === 0) {
      row.status = 'no-pr';
    } else if (row.baseFailed > 0 || baseSamples.length === 0) {
      row.status = 'no-base';
    } else if (!(row.base > 0) || !(row.pr > 0)) {
      // Some benchmarks print a table and no summary figure; run.js records 0.
      row.status = 'no-figure';
    } else {
      row.diff = row.pr - row.base;
      row.change = (row.diff / row.base) * 100;
      if (threshold !== undefined && row.change > threshold) row.status = 'regressed';
    }
    return row;
  });

  const failures = rows.filter((row) => row.threshold !== undefined && (row.status === 'regressed' || row.status === 'crashed'));
  return { rows, failures };
}

/**
 * Formats milliseconds with enough precision for sub-microsecond figures.
 * @param {number} value - Milliseconds.
 * @returns {string} The formatted value.
 */
function formatMs(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 3 : 4;
  return `${value.toFixed(digits)} ms`;
}

/**
 * Formats a spread as "±n%".
 * @param {number} value - Spread in percent.
 * @returns {string} The formatted spread.
 */
function formatSpread(value) {
  return Number.isFinite(value) ? `±${(value / 2).toFixed(1)}%` : '—';
}

/**
 * Renders the comparison as a pull-request comment.
 * @param {object} measured - Output of `measure`.
 * @param {{rows: object[], failures: object[]}} comparison - Output of `compare`.
 * @param {object} options - Rendering options.
 * @param {boolean} options.override - Whether the override label is present.
 * @param {string} options.overrideLabel - The override label's name.
 * @returns {string} Markdown.
 */
export function renderMarkdown(measured, { rows, failures }, { override, overrideLabel }) {
  const statusText = {
    ok: '',
    regressed: '❌ regressed',
    crashed: '❌ crashed on PR',
    'no-pr': '⚠️ failed on PR',
    'no-base': 'new / no baseline',
    'no-figure': 'no summary figure',
  };

  const lines = [COMMENT_MARKER, ''];
  if (failures.length === 0) {
    lines.push('✅ No gating benchmark regressed beyond its threshold.');
  } else if (override) {
    lines.push(`⚠️ ${failures.length} gating benchmark(s) regressed beyond the threshold. Accepted by a maintainer with the \`${overrideLabel}\` label.`);
  } else {
    lines.push(`❌ ${failures.length} gating benchmark(s) regressed beyond the threshold. A maintainer can accept a deliberate regression with the \`${overrideLabel}\` label.`);
  }
  lines.push('');
  lines.push('| Benchmark | Base | PR | Change | Noise (base / PR) | Gate | |');
  lines.push('| :-- | --: | --: | --: | --: | --: | :-- |');

  // Gating benchmarks first, so the rows that decide the result are on top.
  const ordered = [...rows].sort((a, b) => (a.threshold === undefined) - (b.threshold === undefined) || a.file.localeCompare(b.file));
  for (const row of ordered) {
    const name = row.file.replace(/\.bench\.js$/, '');
    const change = row.change === undefined
      ? '—'
      : `${row.diff > 0 ? '+' : ''}${formatMs(row.diff)} (${row.change > 0 ? '+' : ''}${row.change.toFixed(1)}%)`;
    const gate = row.threshold === undefined ? 'report only' : `+${row.threshold}%`;
    const label = row.threshold === undefined ? name : `**${name}**`;
    lines.push(`| ${label} | ${formatMs(row.base)} | ${formatMs(row.pr)} | ${change} | ${formatSpread(row.baseSpread)} / ${formatSpread(row.prSpread)} | ${gate} | ${statusText[row.status]} |`);
  }

  const env = measured.environment;
  lines.push('');
  lines.push(`<sub>Median of **${measured.rounds}** runs per branch, both branches interleaved on the same runner (${env.cpus}× ${env.cpu}, Node ${env.node}). `
    + 'Figures are the per-operation summary each benchmark reports; lower is better. '
    + 'Noise is half the sample range relative to the median. Only **bold** benchmarks can fail the check; '
    + 'thresholds and the reasoning for them are in `benches/regression-gate.js`.</sub>');
  return `${lines.join('\n')}\n`;
}

/**
 * Entry point.
 */
async function main() {
  const [action, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (action === 'measure') {
    if (!args.base || !args.pr || !args.out) {
      console.error('measure requires --base, --pr and --out.');
      process.exit(2);
    }
    const rounds = Number(args.rounds || 5);
    const measured = measure({ base: args.base, pr: args.pr, rounds });
    fs.writeFileSync(args.out, JSON.stringify(measured, null, 2));
    return;
  }

  if (action === 'compare') {
    if (!args.samples || !args.markdown) {
      console.error('compare requires --samples and --markdown.');
      process.exit(2);
    }
    const gatePath = path.resolve(args.gate || 'benches/regression-gate.js');
    const gate = await import(pathToFileURL(gatePath).href);
    const measured = JSON.parse(fs.readFileSync(args.samples, 'utf-8'));
    const comparison = compare(measured, gate);
    const override = args.override === true || args.override === 'true';
    const markdown = renderMarkdown(measured, comparison, { override, overrideLabel: gate.overrideLabel });
    fs.writeFileSync(args.markdown, markdown);
    console.log(markdown);
    if (comparison.failures.length > 0 && !override) process.exit(1);
    return;
  }

  console.error('Usage: bench-compare.js measure|compare [options]');
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
