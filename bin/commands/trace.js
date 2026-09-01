import fs from 'fs';
import path from 'path';
import { bold, cyan, gray, green, yellow, red } from '../colors.js';
import { listTraces, loadTrace, pruneTraces, DEFAULT_KEEP } from '../../lib/core/trace/store.js';
import { formatTrace, summarizeTrace } from '../../lib/core/trace/format.js';
import { generateTest, suggestName } from '../../lib/core/trace/exportTest.js';
import { findContractViolations, formatViolation } from '../../lib/core/trace/contracts.js';
import { Determinism, TraceNodeType } from '../../lib/core/trace/schema.js';
import { annotateTrace, sidecarFileName } from '../../lib/compiler/sourceMapTrace.js';
import { bridgeDependencies } from '../../lib/core/tooling/loadComponent.js';

/**
 * Loads the build's source-location sidecar, when one has been produced.
 *
 * Annotation happens on read rather than on record: a trace stays a record of
 * what happened, and the mapping from an action name to a file and a line is a
 * property of the build it came from, not of the session.
 * @param {object} cli - The CLI instance.
 * @returns {object|null} The sidecar, or null when the project has not been built.
 */
function loadSidecar(cli) {
  const distDir = path.join(cli.baseDir, cli.config.distDir || 'dist');
  const sidecarPath = path.join(distDir, sidecarFileName(cli.config.outputName || 'bundle'));
  if (!fs.existsSync(sidecarPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch {
    // A stale or half-written sidecar costs a source location, not a command.
    return null;
  }
}

/**
 * Renders an age as a short relative string.
 * @param {number} mtime - Epoch milliseconds.
 * @returns {string} e.g. `2m`, `8h`, `3d`.
 */
function age(mtime) {
  const seconds = Math.max(0, Math.round((Date.now() - mtime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Pads a cell to a column width.
 * @param {string} value - The cell text.
 * @param {number} width - Target width.
 * @returns {string} The padded cell.
 */
function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * Prints the message shown when a project has no traces yet.
 */
function printNoTraces() {
  console.log('No traces recorded yet.\n');
  console.log(`Record one with ${cyan('npx avenx serve --trace')}, reproduce the behaviour in the`);
  console.log('browser, then come back and run `avenx trace list`.');
}

/**
 * `avenx trace list` — shows stored traces, newest first.
 * @param {object} cli - The CLI instance.
 * @param {string[]} args - Command arguments.
 */
export function traceList(cli, args = []) {
  const entries = listTraces(cli.baseDir);

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        entries.map((entry) => ({
          id: entry.id,
          broken: entry.broken,
          ...(entry.trace ? summarizeTrace(entry.trace) : {}),
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (entries.length === 0) {
    printNoTraces();
    return;
  }

  console.log('');
  console.log(
    bold(`${pad('TRACE ID', 16)}${pad('AGE', 8)}${pad('EVENTS', 9)}${pad('COMPONENTS', 13)}STATUS`),
  );

  for (const entry of entries) {
    if (entry.broken || !entry.trace) {
      console.log(`${pad(entry.id, 16)}${pad(age(entry.mtime), 8)}${pad('-', 9)}${pad('-', 13)}${red('unreadable')}`);
      continue;
    }
    const summary = summarizeTrace(entry.trace);
    const status =
      summary.status === Determinism.DETERMINISTIC ? green('deterministic') : yellow('best-effort');
    console.log(
      `${pad(summary.id, 16)}${pad(age(entry.mtime), 8)}${pad(summary.events, 9)}${pad(summary.components, 13)}${status}`,
    );
  }

  console.log('');
  console.log(gray(`${entries.length} trace${entries.length === 1 ? '' : 's'} in .avenx/traces/`));
  console.log(gray('View one with `avenx trace view <id>`, or export it with `avenx trace export <id>`.'));
}

/**
 * `avenx trace view` — prints one trace as a causal tree.
 * @param {object} cli - The CLI instance.
 * @param {string} id - The trace id, or `latest`.
 * @param {string[]} args - Command arguments.
 */
export function traceView(cli, id, args = []) {
  const target = id || 'latest';
  let found;
  try {
    found = loadTrace(cli.baseDir, target);
  } catch (error) {
    console.error(red(`❌ ${error.message}`));
    process.exitCode = 1;
    return;
  }

  if (!found) {
    if (listTraces(cli.baseDir).length === 0) {
      printNoTraces();
    } else {
      console.error(red(`❌ No trace called "${target}". Run \`avenx trace list\` to see what is stored.`));
    }
    process.exitCode = 1;
    return;
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(found.trace, null, 2));
    return;
  }

  const maxRootsArg = args.find((arg) => arg.startsWith('--roots='));
  const maxRoots = maxRootsArg ? Number(maxRootsArg.split('=')[1]) : undefined;

  annotateTrace(found.trace, loadSidecar(cli));

  console.log('');
  console.log(formatTrace(found.trace, maxRoots ? { maxRoots } : {}));
  console.log('');
}

/**
 * Finds the source file for a component name, so an exported test can mount it.
 * @param {string} srcDir - The project source directory.
 * @param {string} componentName - The PascalCase class name.
 * @returns {string|null} An absolute path, or null when not found.
 */
function findComponentSource(srcDir, componentName) {
  if (!componentName || !fs.existsSync(srcDir)) {
    return null;
  }

  const wanted = componentName.toLowerCase();
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(component|page)\.js$/i.test(entry.name)) {
        const stem = entry.name.replace(/\.(component|page)\.js$/i, '').replace(/[-_]/g, '');
        if (stem.toLowerCase() === wanted) {
          return full;
        }
      }
    }
  }
  return null;
}

/**
 * `avenx trace export` — writes a runnable regression test for a trace.
 * @param {object} cli - The CLI instance.
 * @param {string} id - The trace id, or `latest`.
 * @param {string[]} args - Command arguments.
 */
export function traceExport(cli, id, args = []) {
  const target = id || 'latest';
  let found;
  try {
    found = loadTrace(cli.baseDir, target);
  } catch (error) {
    console.error(red(`❌ ${error.message}`));
    process.exitCode = 1;
    return;
  }

  if (!found) {
    if (listTraces(cli.baseDir).length === 0) {
      printNoTraces();
    } else {
      console.error(red(`❌ No trace called "${target}". Run \`avenx trace list\` to see what is stored.`));
    }
    process.exitCode = 1;
    return;
  }

  const trace = annotateTrace(found.trace, loadSidecar(cli));
  const deterministic = (trace.determinism && trace.determinism.status) === Determinism.DETERMINISTIC;

  const outIndex = args.findIndex((arg) => arg === '--out' || arg === '-o');
  let outPath = outIndex !== -1 && args[outIndex + 1] ? args[outIndex + 1] : null;
  if (!outPath) {
    const inline = args.find((arg) => arg.startsWith('--out='));
    outPath = inline ? inline.slice('--out='.length) : null;
  }
  if (!outPath) {
    outPath = path.join('test', `${suggestName(trace)}.test.js`);
  }

  const absoluteOut = path.resolve(cli.baseDir, outPath);
  const outDir = path.dirname(absoluteOut);

  if (fs.existsSync(absoluteOut) && !args.includes('--force') && !args.includes('-f')) {
    console.error(red(`❌ ${outPath} already exists. Pass --force to overwrite it.`));
    process.exitCode = 1;
    return;
  }

  // The trace travels beside the test: a regression test that depends on a file
  // in .avenx/ would break the moment someone ran `avenx trace prune`.
  const traceFileName = `${path.basename(absoluteOut).replace(/\.test\.[cm]?js$/, '')}.trace.json`;
  const traceOutPath = path.join(outDir, traceFileName);

  const srcDir = path.join(cli.baseDir, cli.config.srcDir || 'src');
  const componentName = (trace.nodes || []).find((node) => node.component)?.component || null;

  // The sidecar knows exactly which file a component came from, so it beats
  // guessing from the name. Scanning srcDir is the fallback for a project that
  // has not been built since the trace was recorded.
  const sidecar = loadSidecar(cli);
  const fromSidecar =
    sidecar && sidecar.components && componentName && sidecar.components[componentName]
      ? path.join(cli.baseDir, sidecar.components[componentName].file)
      : null;
  const componentSource =
    fromSidecar && fs.existsSync(fromSidecar) ? fromSidecar : findComponentSource(srcDir, componentName);
  const componentPath = componentSource
    ? `./${path.relative(outDir, componentSource).split(path.sep).join('/')}`
    : null;

  // A component that imports a bridge needs the real bridge instance handed to
  // it, so the generated test imports the bridge module directly. The sidecar
  // knows where each bridge lives.
  const bridges = [];
  if (componentSource) {
    for (const bridgeName of bridgeDependencies(componentSource)) {
      const entry = sidecar && sidecar.bridges && sidecar.bridges[bridgeName];
      const bridgeFile = entry ? path.join(cli.baseDir, entry.file) : null;
      if (bridgeFile && fs.existsSync(bridgeFile)) {
        bridges.push({
          name: bridgeName,
          path: `./${path.relative(outDir, bridgeFile).split(path.sep).join('/')}`,
        });
      }
    }
  }

  const source = generateTest(trace, {
    tracePath: `./${traceFileName}`,
    componentPath,
    componentName,
    bridges,
    title: `${componentName ? `${componentName}: ` : ''}${suggestName(trace)}`,
  });

  if (args.includes('--dry-run') || args.includes('-d')) {
    console.log(gray(`Would write ${outPath} and ${path.relative(cli.baseDir, traceOutPath)}:\n`));
    console.log(source);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(traceOutPath, JSON.stringify(trace, null, 2));
  fs.writeFileSync(absoluteOut, source);

  console.log('');
  console.log(green(`✔ ${outPath}`));
  console.log(green(`✔ ${path.relative(cli.baseDir, traceOutPath)}`));
  console.log('');

  const inputs = (trace.nodes || []).filter(
    (node) => (node.type === TraceNodeType.EVENT || node.type === TraceNodeType.NAVIGATION) && !node.parent,
  ).length;
  console.log(`${inputs} recorded input${inputs === 1 ? '' : 's'} · ${(trace.nodes || []).length} nodes`);

  if (!componentPath) {
    console.log(
      yellow(
        '\n⚠ The trace did not name a component this project has a source file for.\n' +
          '  Fill in the mount() body in the generated test before running it.',
      ),
    );
  }

  if (!deterministic) {
    console.log(
      yellow('\n⚠ This trace was recorded as best-effort, so replay may not reproduce it.'),
    );
    for (const reason of (trace.determinism && trace.determinism.reasons) || []) {
      console.log(yellow(`    - ${reason.reason}${reason.detail ? `: ${reason.detail}` : ''}`));
    }
    console.log(gray('  The generated test opts in with allowBestEffort and will never report verified.'));
    console.log(gray('  Run `avenx trace view` for the full explanation.'));
  }

  if (trace.redacted) {
    console.log(
      yellow(`\n⚠ Values at ${(trace.redactions || []).join(', ')} were withheld when recording.`),
    );
    console.log(gray('  No assertion in the generated test can check them.'));
  }

  const violations = findContractViolations(trace);
  for (const violation of violations) {
    console.log(yellow(`\n⚠ ${formatViolation(violation)}`));
  }

  console.log(gray(`\nRun it with your test runner, e.g. \`node --test ${outPath}\`.`));
}

/**
 * `avenx trace prune` — removes stored traces.
 * @param {object} cli - The CLI instance.
 * @param {string[]} args - Command arguments.
 */
export function tracePrune(cli, args = []) {
  const all = args.includes('--all');
  const keepArg = args.find((arg) => arg.startsWith('--keep='));
  const keep = keepArg ? Number(keepArg.split('=')[1]) : DEFAULT_KEEP;
  const explicitId = args.find((arg) => !arg.startsWith('-'));

  if (keepArg && (!Number.isInteger(keep) || keep < 0)) {
    console.error(red(`❌ --keep must be a whole number, got "${keepArg.split('=')[1]}".`));
    process.exitCode = 1;
    return;
  }

  const before = listTraces(cli.baseDir);
  if (before.length === 0) {
    printNoTraces();
    return;
  }

  if (args.includes('--dry-run') || args.includes('-d')) {
    const doomed = explicitId
      ? before.filter((entry) => entry.id === explicitId)
      : all
        ? before
        : before.slice(keep);
    if (doomed.length === 0) {
      console.log(`Nothing to prune. ${before.length} trace${before.length === 1 ? '' : 's'} stored.`);
      return;
    }
    console.log(`Would remove ${doomed.length} trace${doomed.length === 1 ? '' : 's'}:`);
    for (const entry of doomed) {
      console.log(`  ${entry.id}  ${gray(`(${age(entry.mtime)} old)`)}`);
    }
    return;
  }

  const removed = pruneTraces(cli.baseDir, { all, keep, id: explicitId });

  if (removed.length === 0) {
    console.log(`Nothing to prune. ${before.length} trace${before.length === 1 ? '' : 's'} stored.`);
    return;
  }

  console.log(green(`✔ Removed ${removed.length} trace${removed.length === 1 ? '' : 's'}.`));
  const remaining = listTraces(cli.baseDir).length;
  console.log(gray(`${remaining} remaining in .avenx/traces/`));
}

/**
 * Dispatches an `avenx trace <sub>` invocation.
 * @param {object} cli - The CLI instance.
 * @param {string[]} args - Everything after `trace`.
 */
export function runTrace(cli, args = []) {
  const [sub, ...rest] = args;
  const positional = rest.filter((arg) => !arg.startsWith('-'));

  switch (sub) {
    case 'list':
    case 'ls':
      traceList(cli, rest);
      break;
    case 'view':
    case 'show':
      traceView(cli, positional[0], rest);
      break;
    case 'export':
      traceExport(cli, positional[0], rest);
      break;
    case 'prune':
    case 'clean':
      tracePrune(cli, rest);
      break;
    case undefined:
      traceList(cli, rest);
      break;
    default:
      console.error(red(`❌ Unknown trace command "${sub}".`));
      console.log('');
      console.log('Usage:');
      console.log(`  ${cyan('avenx trace list')}                    Show recorded traces`);
      console.log(`  ${cyan('avenx trace view <id|latest>')}        Print a trace as a causal tree`);
      console.log(`  ${cyan('avenx trace export <id|latest>')}      Write a regression test for a trace`);
      console.log(`  ${cyan('avenx trace prune [--all|--keep=N]')}  Remove stored traces`);
      process.exitCode = 1;
      break;
  }
}
