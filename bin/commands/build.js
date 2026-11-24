import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import AvenxCompiler from '../../lib/compiler.js';
import { reportAtlasDiagnostics } from '../../lib/compiler/atlas/diagnostics.js';
import { reportRewindDiagnostics } from '../../lib/compiler/rewind/diagnostics.js';
import { cyan, gray, green, red } from '../colors.js';
import { BuildError } from '../../lib/compiler/errors/index.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { AvenxLogger } from '../../lib/core/runtime/AvenxLogger.js';
import { A11Y_WARNING_CODES } from '../../lib/compiler/rules/accessibility.js';
import { watchDirectories } from '../utils.js';
import { toSarif } from '../../lib/compiler/diagnostics/sarif.js';
import {
  DiagnosticChannel,
  createDiagnosticRecord,
  splitCodeFrame,
  stripAnsi,
} from '../../lib/compiler/diagnostics/DiagnosticChannel.js';

export { splitCodeFrame, stripAnsi, createDiagnosticRecord, DiagnosticChannel };

/**
 * Runs a configured lifecycle hook.
 *
 * A hook is part of the build, so a non-zero exit from one fails the build.
 * execSync throws a generic "Command failed" error; it is re-thrown as a coded
 * BuildError so the reason is legible and the CLI can render it like any other
 * build failure.
 * @param {string} phase - 'prebuild' or 'postbuild'.
 * @param {string} command - The shell command to run.
 * @param {string} baseDir - Working directory for the hook.
 * @param {object} [logging] - Invocation logging settings.
 * @throws {BuildError} When the hook exits non-zero.
 */
function runHook(phase, command, baseDir, logging = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    return;
  }

  const reporter = new AvenxLogger({ formatter: (_level, args) => args, ...logging });
  reporter.info(gray(`🏃 Running ${phase} hook: ${command}...`));

  try {
    execSync(command, { stdio: 'inherit', cwd: baseDir });
  } catch (err) {
    const reason = typeof err.status === 'number' ? `exited with code ${err.status}` : err.message;
    throw new BuildError(AvenxErrorCodes.COMPILER_HOOK_FAILED, phase, reason, command);
  }
}

/**
 * Runs the compiler build along with optional prebuild and postbuild lifecycle hooks.
 *
 * Throws on any failure. The caller turns that into an exit code; nothing here
 * may report success for a build that did not complete.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 * @param {object} [options] - Build options.
 * @param {boolean} [options.watch] - True when this build is one cycle of a
 *   long-lived watch session, which is what allows the compilation cache.
 * @returns {object} The compiler's build result.
 * @throws {BuildError} When a hook or the compilation fails.
 */
export function buildProject(cli, options = {}) {
  const hooks = (cli && cli.config && cli.config.hooks) || {};
  const baseDir = (cli && cli.baseDir) || process.cwd();

  runHook('prebuild', hooks.prebuild, baseDir, cli?.config?.logging);

  // `watch` is what lets the compiler reuse cached compilation products, and it
  // is passed only by the commands that keep a process alive across rebuilds.
  // `avenx build` calls this without it and so always builds cold.
  const result = new AvenxCompiler({
    rootDir: cli.config.rootDir || baseDir,
    watch: options.watch === true,
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
    ...(options.codeSplitting !== undefined ? { codeSplitting: options.codeSplitting } : {}),
  }, cli.config).build();

  runHook('postbuild', hooks.postbuild, baseDir, cli?.config?.logging);

  return result;
}

/**
 * Runs one build and returns its diagnostics alongside the outcome.
 *
 * {@link buildProject} prints diagnostics and throws on failure, which is all
 * `avenx build` needs. A long-lived caller -- the dev server -- needs the same
 * pass as data, so it can put the diagnostics somewhere other than the
 * terminal. The console is wrapped rather than silenced: everything still
 * prints exactly as before, and the structured copies are collected on the
 * side.
 *
 * Never throws: a failed build is reported as `ok: false` with the failure in
 * both `error` and the last diagnostic, because the caller is a watch loop
 * that must survive it.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 * @param {object} [options] - Build options, forwarded to {@link buildProject}.
 * @returns {{ok: boolean, result: object|null, error: Error|null, diagnostics: object[]}}
 */
export function runBuildPass(cli, options = {}) {
  const diagnostics = options.diagnostics || [];

  try {
    const result = buildProject(cli, { ...options, diagnostics });
    return { ok: true, result, error: null, diagnostics };
  } catch (error) {
    if (!error.__avenxRecorded) {
      diagnostics.push(createDiagnosticRecord('error', error));
      error.__avenxRecorded = true;
    }
    return { ok: false, result: null, error, diagnostics };
  }
}

/**
 * Cleans the project by deleting the build output directory.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 */
export function cleanProject(cli) {
  const distDir = path.join(cli.baseDir, cli.config.distDir);
  if (fs.existsSync(distDir)) {
    console.log(cyan(`🧹 Cleaning build output directory: ${cli.config.distDir}...`));
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log(green('✅ Clean complete.'));
  } else {
    console.log(cyan(`🧹 Build output directory ${cli.config.distDir} does not exist. Nothing to clean.`));
  }
}

/**
 * Strips ANSI color escape codes from a message string.
 * @param {string} str
 * @returns {string}
 */
export function parseDiagnostic(severity, args) {
  const firstArg = args && args[0];
  if (firstArg instanceof Error) {
    return createDiagnosticRecord(severity, firstArg);
  }
  if (Array.isArray(args)) {
    return createDiagnosticRecord(severity, null, ...args);
  }
  return createDiagnosticRecord(severity, null, args);
}

/**
 * Helper to get formatted local time string for timestamps (HH:MM:SS format).
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Runs a single template check pass and returns structured results.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 * @param {string[]} [args] - Command line arguments.
 * @param {object} [options] - Pass options.
 * @param {boolean} [options.watch] - True when this pass is one cycle of
 *   `check --watch`, which is what allows the compilation cache.
 * @returns {{ valid: boolean, errorCount: number, warningCount: number, diagnostics: any[] }}
 */
export function runCheckPass(cli, args = [], options = {}) {
  const isJson = args.includes('--json') || args.includes('-j') || args.includes('--sarif');
  const diagnostics = options.diagnostics || [];

  try {
    const checkConfig = {
      ...cli.config,
      ...(cli.baseDir ? { rootDir: cli.baseDir } : {}),
      watch: options.watch === true,
      diagnostics,
      json: isJson,
      logging: isJson ? { silent: true } : (cli.config && cli.config.logging),
    };

    const compiler = new AvenxCompiler(checkConfig);
    const model = compiler.analyze();

    for (const failure of model.errors) {
      const message = `[${failure.code}] ${failure.message}`;
      if (!isJson) {
        console.error(red(`❌ ${message}`));
      }
    }

    reportAtlasDiagnostics(model, checkConfig);
    reportRewindDiagnostics(model, checkConfig);
  } catch (err) {
    if (!err.__avenxRecorded) {
      diagnostics.push(createDiagnosticRecord('error', err));
      err.__avenxRecorded = true;
    }
    if (!isJson) {
      console.error(red(`❌ ${err.message || err}`));
    }
  }

  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const blockingWarningCount = diagnostics.filter(
    (d) => d.severity === 'warning' && !A11Y_WARNING_CODES.has(d.code),
  ).length;

  const isStrict = args.includes('--strict') || args.includes('--strict-a11y');
  const effectiveBlocking = errorCount + (isStrict ? warningCount : blockingWarningCount);

  return {
    valid: effectiveBlocking === 0,
    errorCount,
    warningCount,
    blockingWarningCount,
    diagnostics,
  };
}

/**
 * Validates template files without building.
 * Supports --watch / -w for continuous watching and template linting.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 * @param {string[]} [args] - Additional command line arguments.
 * @returns {object|fs.FSWatcher|undefined} Diagnostic report or watcher instance.
 */
export function checkProject(cli, args = []) {
  const reporter = new AvenxLogger({ formatter: (_level, args) => args, ...cli?.config?.logging });
  const isJson = args.includes('--json') || args.includes('-j');
  const isWatch = args.includes('--watch') || args.includes('-w');
  const isSarif = args.includes('--sarif');
  const outputIndex = args.findIndex((arg) => arg === '--out' || arg === '-o' || arg.startsWith('--out='));
  let output;
  if (isSarif && (isJson || isWatch)) {
    throw new Error('--sarif cannot be combined with --json or --watch');
  }
  if (outputIndex !== -1) {
    if (!isSarif) throw new Error('check --out requires --sarif');
    output = args[outputIndex].startsWith('--out=') ? args[outputIndex].slice(6) : args[outputIndex + 1];
    if (!output || output.startsWith('-')) throw new Error('--out requires a file path');
  }

  if (isWatch) {
    const srcDir = (cli && cli.config && cli.config.srcDir) || 'src';
    const srcPath = path.join((cli && cli.baseDir) || process.cwd(), srcDir);

    reporter.info(cyan(`[${getTimestamp()}] 👀 Watching for template changes in ${srcDir}/...`));

    const executeCheck = () => {
      const timestamp = getTimestamp();
      const report = runCheckPass(cli, args, { watch: true });

      if (isJson) {
        const jsonReport = {
          timestamp,
          ...report,
        };
        console.log(JSON.stringify(jsonReport, null, 2));
      } else {
        const isStrict = args.includes('--strict') || args.includes('--strict-a11y');
        const blockingIssues = report.errorCount + (isStrict ? report.warningCount : (report.blockingWarningCount || 0));
        if (blockingIssues > 0) {
          const totalIssues = report.warningCount + report.errorCount;
          if (reporter.shouldLog('info')) console.error(red(`[${timestamp}] ❌ Found ${totalIssues} validation issue(s).`));
        } else if (report.warningCount > 0) {
          reporter.info(cyan(`[${timestamp}] ✓ Template validation passed with ${report.warningCount} accessibility warning(s).`));
        } else {
          reporter.info(green(`[${timestamp}] ✓ No template validation issues found.`));
        }
      }
      return report;
    };

    // Initial check
    const initialReport = executeCheck();

    if (!fs.existsSync(srcPath)) {
      console.error(red(`❌ Source directory does not exist: ${srcPath}`));
      return initialReport;
    }

    let timeout;
    const templateDirs = [(cli && cli.config && cli.config.templatesDir) || '.avenxtemplates', 'templates'];
    const watcher = watchDirectories(
      [srcPath, ...templateDirs.map((dir) => path.join((cli && cli.baseDir) || process.cwd(), dir))],
      (_eventType, filename) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          const fileMsg = filename ? ` in ${filename}` : '';
          reporter.info(`\n${cyan(`[${getTimestamp()}] 📄 Change detected${fileMsg}. Re-checking templates...`)}`);
          executeCheck();
        }, 100);
      },
    );

    const cleanup = () => {
      reporter.info(`\n${gray('Stopping template check watcher...')}`);
      clearTimeout(timeout);
      if (watcher) watcher.close();
      if (!cli || !cli._noExit) {
        process.exit(0);
      }
    };

    process.on('SIGINT', cleanup);

    if (cli) {
      cli._watcher = watcher;
    }

    return watcher;
  }

  // Single-pass mode
  const report = runCheckPass(cli, args);

  if (isJson || isSarif) {
    const serialized = JSON.stringify(isSarif ? toSarif(report, cli?.baseDir) : report, null, 2);
    if (output) {
      fs.writeFileSync(path.resolve(cli?.baseDir || process.cwd(), output), serialized + '\n');
    } else {
      // A synchronous write keeps large piped reports complete before process.exit.
      fs.writeFileSync(1, serialized + '\n');
    }

    process.exitCode = report.valid ? 0 : 1;
    if (!cli || !cli._noExit) {
      process.exit(process.exitCode);
    }
    return report;
  }

  const isStrict = args.includes('--strict') || args.includes('--strict-a11y');
  const blockingIssues = report.errorCount + (isStrict ? report.warningCount : (report.blockingWarningCount || 0));

  if (blockingIssues > 0) {
    const totalIssues = report.warningCount + report.errorCount;
    if (reporter.shouldLog('info')) console.error(`\n${red(`Found ${totalIssues} validation issue(s).`)}`);
    process.exitCode = 1;
    if (!cli || !cli._noExit) {
      process.exit(1);
    }
    return report;
  }

  if (report.warningCount > 0) {
    reporter.info(cyan(`\n✓ Template validation passed with ${report.warningCount} accessibility warning(s).`));
  } else {
    reporter.info(green('✓ No template validation issues found.'));
  }
  process.exitCode = 0;
  if (!cli || !cli._noExit) {
    process.exit(0);
  }
  return report;
}


