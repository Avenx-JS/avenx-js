import fs from 'node:fs';
import path from 'node:path';
import { measureAsset } from '../../lib/compiler/sizeMetrics.js';
import { UsageError } from '../fatal.js';

const METRICS = ['raw', 'minified', 'gzipped'];
const EMPTY = { raw: 0, minified: 0, gzipped: 0 };
const DEFAULT_BASELINE = '.avenx/size-baseline.json';

function option(args, name) {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + '='));
  if (index < 0) return undefined;
  if (args[index].includes('=')) {
    const value = args[index].slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value after =`);
    return value;
  }
  return args[index + 1] && !args[index + 1].startsWith('-') ? args[index + 1] : true;
}

function total(assets) {
  const sum = { ...EMPTY };
  for (const metrics of Object.values(assets)) {
    for (const key of METRICS) sum[key] += metrics[key];
  }
  return sum;
}

async function measureDirectory(directory) {
  if (!fs.existsSync(directory)) throw new Error(`Build output does not exist: ${directory}. Run avenx build first.`);
  const assets = Object.create(null);
  async function visit(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && /\.(js|css)$/.test(name)) {
        assets[name] = await measureAsset(fs.readFileSync(path.join(directory, name), 'utf8'), path.extname(name).slice(1));
      }
    }
  }
  await visit('');
  if (Object.keys(assets).length === 0) throw new Error('No JavaScript or CSS assets found. Run avenx build first.');
  return { version: 1, assets, total: total(assets) };
}

function loadBaseline(filename) {
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (value?.version !== 1 || !value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) {
    throw new Error('Unsupported size baseline. Create it with avenx stats --save.');
  }
  for (const [name, metrics] of Object.entries(value.assets)) {
    if (!/\.(js|css)$/.test(name) || !metrics || METRICS.some((key) => !Number.isSafeInteger(metrics[key]) || metrics[key] < 0)) {
      throw new Error(`Invalid size baseline entry: ${name}`);
    }
  }
  return { ...value, total: total(value.assets) };
}

function difference(before, after) {
  return Object.fromEntries(METRICS.map((key) => [key, {
    baseline: before[key], current: after[key], bytes: after[key] - before[key],
    percent: before[key] === 0 ? (after[key] === 0 ? 0 : null) : (after[key] - before[key]) / before[key] * 100,
  }]));
}

/**
 * Save or compare the actual JS/CSS files in distDir. This command deliberately
 * does not build: callers choose the build mode before measuring its artifacts.
 * @param {object} cli - Resolved CLI configuration.
 * @param {string[]} args - Command-line options.
 * @returns {Promise<object>} The measurement or comparison also written to stdout.
 */
export async function runBundleStats(cli, args) {
  const save = option(args, '--save');
  const compare = option(args, '--compare');
  const threshold = option(args, '--max-increase');
  if (save !== undefined && compare !== undefined) throw new UsageError('Use --save or --compare, not both.');
  if (threshold !== undefined && compare === undefined) throw new UsageError('--max-increase requires --compare.');
  if (threshold !== undefined && (typeof threshold !== 'string' || !/^\d+(?:\.\d+)?%$/.test(threshold) || !Number.isFinite(parseFloat(threshold)))) {
    throw new UsageError(`--max-increase must be a non-negative percentage, for example 5%, not "${threshold}".`);
  }
  const root = cli.baseDir || process.cwd();
  const baselinePath = path.resolve(root, (compare ?? save) === true ? DEFAULT_BASELINE : (compare ?? save));
  const baseline = compare !== undefined ? loadBaseline(baselinePath) : null;
  const measurement = await measureDirectory(path.resolve(root, cli.config.distDir || 'dist'));
  let report = measurement;
  if (baseline) {
    const names = [...new Set([...Object.keys(baseline.assets), ...Object.keys(measurement.assets)])].sort();
    const totals = difference(baseline.total, measurement.total);
    const limit = threshold === undefined ? null : parseFloat(threshold);
    const exceeded = limit !== null && METRICS.some((key) =>
      measurement.total[key] > baseline.total[key] * (1 + limit / 100));
    report = {
      version: 1, baseline: baselinePath,
      assets: names.map((name) => ({
        name,
        status: !Object.hasOwn(baseline.assets, name) ? 'added' : !Object.hasOwn(measurement.assets, name) ? 'removed' : 'existing',
        metrics: difference(baseline.assets[name] || EMPTY, measurement.assets[name] || EMPTY),
      })),
      total: totals, maxIncreasePercent: limit, exceeded,
    };
    process.exitCode = exceeded ? 1 : 0;
  } else {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(measurement, null, 2) + '\n');
    process.exitCode = 0;
  }
  if (args.includes('--json') || args.includes('-j')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (baseline) {
    console.log('Asset / metric\tBaseline bytes\tCurrent bytes\tChange bytes\tChange %');
    for (const asset of [...report.assets, { name: 'Total', metrics: report.total }]) {
      for (const key of METRICS) {
        const row = asset.metrics[key];
        const percent = row.percent === null ? 'new' : `${row.percent.toFixed(2)}%`;
        console.log(`${asset.name} / ${key}\t${row.baseline}\t${row.current}\t${row.bytes > 0 ? '+' : ''}${row.bytes}\t${percent}`);
      }
    }
    if (report.exceeded) console.error(`Bundle growth exceeds ${threshold}.`);
  } else {
    console.log(`Saved ${Object.keys(measurement.assets).length} assets to ${baselinePath}`);
  }
  return report;
}
