import fs from 'node:fs';
import path from 'node:path';
import { bundleHash } from '../../lib/compiler/bundle/composition.js';

/**
 * Reads the last build's composition only when it describes the requested
 * mode and the exact artifact on disk. It does not rebuild or emit diagnostics
 * from a second compiler pass, so the source report still works mid-edit.
 * @param {object} cli - Resolved CLI configuration.
 * @returns {object} Available composition, or an explicit build instruction.
 */
export function readCompositionStats(cli) {
  const config = cli.config || {};
  const root = cli.baseDir || process.cwd();
  const dist = path.resolve(root, config.distDir || 'dist');
  const name = config.outputName || 'bundle';
  const mode = config.mode || (config.dev === true || process.env.NODE_ENV === 'development' ? 'development' : 'production');
  const file = path.relative(root, path.join(dist, `${name}.js`)).split(path.sep).join('/');
  const command = `avenx build --${mode === 'development' ? 'dev' : 'prod'}`;
  const unavailable = (reason) => ({ available: false, file, mode, reason, message: `${reason}. Run ${command} first.` });
  try {
    const report = JSON.parse(fs.readFileSync(path.join(dist, `${name}.stats.json`), 'utf8'));
    const size = (value) => Number.isSafeInteger(value) && value >= 0;
    const row = (item) => item && size(item.bytes) && Number.isFinite(item.share) && item.share >= 0;
    if (report.version !== 1 || report.file !== `${name}.js` || !size(report.bytes) || !size(report.gzipBytes) ||
        !Array.isArray(report.modules) || !report.modules.every((item) => row(item) && typeof item.file === 'string') ||
        !Array.isArray(report.directories) || !report.directories.every((item) => row(item) && typeof item.directory === 'string') ||
        !Array.isArray(report.capabilities) || !report.capabilities.every((item) => typeof item === 'string') ||
        !row(report.overhead) || !size(report.modulesInGraph) || !size(report.modulesShaken) ||
        report.modulesEmitted !== report.modules.length || report.modulesInGraph !== report.modulesEmitted + report.modulesShaken ||
        report.modules.reduce((sum, item) => sum + item.bytes, report.overhead.bytes) !== report.bytes ||
        report.directories.reduce((sum, item) => sum + item.bytes, report.overhead.bytes) !== report.bytes) {
      return unavailable('Bundle composition metadata is invalid or unsupported');
    }
    if (report.mode !== mode) return unavailable(`The last build is ${report.mode}, but ${mode} was requested`);
    const code = fs.readFileSync(path.join(dist, `${name}.js`));
    if (code.length !== report.bytes || bundleHash(code) !== report.sha256) {
      return unavailable('The bundle has changed since its composition was recorded');
    }
    return { ...report, available: true, file };
  } catch {
    return unavailable('No readable bundle composition is available');
  }
}

/**
 * Prints exact module and directory totals in the same units as source stats.
 * @param {object} report - The composition or build instruction.
 * @param {Function} formatBytes - Shared byte formatter.
 */
export function printCompositionStats(report, formatBytes) {
  console.log(`\nRuntime Bundle Composition (${report.file}, ${report.mode}, last build)`);
  if (!report.available) {
    console.log(report.message);
    return;
  }
  const printRow = (name, row) => console.log(`${name.padEnd(56)}  ${formatBytes(row.bytes).padStart(12)}  ${row.share.toFixed(1).padStart(6)}%`);
  console.log(`${'Module'.padEnd(56)}  ${'Raw'.padStart(12)}   Share`);
  for (const row of report.modules) printRow(row.file, row);
  printRow('Bundle overhead', report.overhead);
  console.log('\nBy directory');
  for (const row of report.directories) printRow(row.directory, row);
  printRow('Bundle overhead', report.overhead);
  printRow('Total', { bytes: report.bytes, share: 100 });
  console.log(`Whole-bundle gzip: ${formatBytes(report.gzipBytes)}`);
  console.log(`Linked capabilities: ${report.capabilities.join(', ') || '(none)'}`);
  console.log(`Shaken out: ${report.modulesShaken} modules`);
}
