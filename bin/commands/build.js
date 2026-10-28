import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import AvenxCompiler from '../../lib/compiler.js';
import { reportAtlasDiagnostics } from '../../lib/compiler/atlas/diagnostics.js';
import { reportRewindDiagnostics } from '../../lib/compiler/rewind/diagnostics.js';
import { cyan, gray, green, red } from '../colors.js';
import { BuildError } from '../../lib/compiler/errors/index.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { A11Y_WARNING_CODES } from '../../lib/compiler/rules/accessibility.js';
import { watchDirectory } from '../utils.js';

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
 * @throws {BuildError} When the hook exits non-zero.
 */
function runHook(phase, command, baseDir) {
  if (typeof command !== 'string' || command.trim() === '') {
    return;
  }

  console.log(gray(`🏃 Running ${phase} hook: ${command}...`));

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

  runHook('prebuild', hooks.prebuild, baseDir);

  // `watch` is what lets the compiler reuse cached compilation products, and it
  // is passed only by the commands that keep a process alive across rebuilds.
  // `avenx build` calls this without it and so always builds cold.
  const result = new AvenxCompiler({ ...cli.config, watch: options.watch === true }).build();

  runHook('postbuild', hooks.postbuild, baseDir);

  return result;
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
function stripAnsi(str) {
  if (typeof str !== 'string') return String(str || '');
  const ansiPattern = '(?:\\u001b|\\u009b)[[(#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nseries]';
  const ansiRegex = new RegExp(ansiPattern, 'g');
  return str.replace(ansiRegex, '').trim();
}

/**
 * Parses raw diagnostic inputs into a structured object.
 * @param {string} severity - 'warning' or 'error'
 * @param {any[]} args - Log or error arguments
 * @returns {object} Diagnostic object
 */
export function parseDiagnostic(severity, args) {
  let file = null;
  let code = null;
  let rawMsg;
  let line = null;
  let column = null;

  const firstArg = args && args[0];
  if (firstArg instanceof Error) {
    rawMsg = firstArg.message || String(firstArg);
    if (firstArg.code) code = firstArg.code;
    if (firstArg.filePath || firstArg.fileName || firstArg.filename || firstArg.file) {
      file = firstArg.filePath || firstArg.fileName || firstArg.filename || firstArg.file;
    }
    if (typeof firstArg.line === 'number') line = firstArg.line;
    if (typeof firstArg.column === 'number') column = firstArg.column;
  } else if (Array.isArray(args)) {
    rawMsg = args.map((a) => (typeof a === 'object' && a !== null ? (a.message || JSON.stringify(a)) : String(a))).join(' ');
  } else {
    rawMsg = String(args || '');
  }

  rawMsg = stripAnsi(rawMsg);

  // Extract error code if not found on error object
  if (!code) {
    const codeMatch = rawMsg.match(/\[?(AVX_[A-Z0-9]+)\]?/);
    if (codeMatch) {
      code = codeMatch[1];
    }
  }

  // Extract file path/name if not found on error object
  if (!file) {
    const searchable = rawMsg.replace(/avenx\.config\.json/gi, '');

    const fileMatch =
      searchable.match(/in template of\s+["']?([^"'\s]+\.[a-zA-Z0-9]+)["']?/i) ||
      searchable.match(/in component\s+<([^>]+)>/i) ||
      searchable.match(/at\s+["']?([^"'\s]+\.[a-zA-Z0-9]+)["']?/i) ||
      searchable.match(/["']?([a-zA-Z0-9_\-/\\]+\.(?:component\.js|page\.js|js|mjs|cjs|html|css|json))(?![\w.])["']?/i);

    if (fileMatch) {
      file = fileMatch[1];
    }
  }

  if (line === null) {
    const locMatch = rawMsg.match(/:(\d+):(\d+)/) || rawMsg.match(/line\s+(\d+),\s+column\s+(\d+)/i);
    if (locMatch) {
      line = parseInt(locMatch[1], 10);
      column = parseInt(locMatch[2], 10);
    }
  }

  // Strip leading code bracket like "[AVX_W03] " from clean message
  let cleanMessage = rawMsg;
  if (code) {
    cleanMessage = cleanMessage.replace(new RegExp(`^\\[?${code}\\]?\\s*:?\\s*`), '');
  }

  const result = {
    file: file || null,
    code: code || 'AVX_UNK',
    severity: severity === 'error' ? 'error' : 'warning',
    message: cleanMessage.trim(),
  };
  if (line !== null) result.line = line;
  if (column !== null) result.column = column;
  return result;
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
  const isJson = args.includes('--json') || args.includes('-j');
  const diagnostics = [];

  const originalWarn = console.warn;
  const originalError = console.error;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  const originalTrace = console.trace;

  let warningCount = 0;
  let errorCount = 0;
  let blockingWarningCount = 0;

  const handleWarning = (...messages) => {
    warningCount++;
    const diag = parseDiagnostic('warning', messages);
    diagnostics.push(diag);
    if (!A11Y_WARNING_CODES.has(diag.code)) {
      blockingWarningCount++;
    }
  };

  const handleError = (...messages) => {
    errorCount++;
    diagnostics.push(parseDiagnostic('error', messages));
  };

  if (isJson) {
    console.warn = handleWarning;
    console.error = handleError;

    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
    console.trace = () => {};
  } else {
    console.warn = (...messages) => {
      handleWarning(...messages);
      originalWarn(...messages);
    };

    console.error = (...messages) => {
      handleError(...messages);
      originalError(...messages);
    };
  }

  try {
    // analyze() is the same pipeline the build runs, so check sees exactly
    // what a build would: bridges included, which the previous
    // processComponents/processPages pair skipped entirely. It is tolerant so
    // one broken bridge cannot hide every template diagnostic behind it; the
    // failure itself is reported below.
    const compiler = new AvenxCompiler({
      ...cli.config,
      ...(cli.baseDir ? { rootDir: cli.baseDir } : {}),
      watch: options.watch === true,
    });
    const model = compiler.analyze();

    for (const failure of model.errors) {
      errorCount++;
      const message = `[${failure.code}] ${failure.message}`;
      if (isJson) {
        diagnostics.push(parseDiagnostic('error', [message]));
      } else {
        originalError(red(`❌ ${message}`));
      }
    }

    reportAtlasDiagnostics(model, cli.config);
    reportRewindDiagnostics(model, cli.config);
  } catch (err) {
    errorCount++;
    if (isJson) {
      diagnostics.push(parseDiagnostic('error', [err]));
    } else {
      originalError(red(`❌ ${err.message || err}`));
    }
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
    console.trace = originalTrace;
  }

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
  const isJson = args.includes('--json') || args.includes('-j');
  const isWatch = args.includes('--watch') || args.includes('-w');

  if (isWatch) {
    const srcDir = (cli && cli.config && cli.config.srcDir) || 'src';
    const srcPath = path.join((cli && cli.baseDir) || process.cwd(), srcDir);

    console.log(cyan(`[${getTimestamp()}] 👀 Watching for template changes in ${srcDir}/...`));

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
          console.error(red(`[${timestamp}] ❌ Found ${totalIssues} validation issue(s).`));
        } else if (report.warningCount > 0) {
          console.log(cyan(`[${timestamp}] ✓ Template validation passed with ${report.warningCount} accessibility warning(s).`));
        } else {
          console.log(green(`[${timestamp}] ✓ No template validation issues found.`));
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
    const watcher = watchDirectory(srcPath, (eventType, filename) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const fileMsg = filename ? ` in ${filename}` : '';
        console.log(`\n${cyan(`[${getTimestamp()}] 📄 Change detected${fileMsg}. Re-checking templates...`)}`);
        executeCheck();
      }, 100);
    });


    const cleanup = () => {
      console.log(`\n${gray('Stopping template check watcher...')}`);
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

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));

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
    console.error(`\n${red(`Found ${totalIssues} validation issue(s).`)}`);
    process.exitCode = 1;
    if (!cli || !cli._noExit) {
      process.exit(1);
    }
    return report;
  }

  if (report.warningCount > 0) {
    console.log(cyan(`\n✓ Template validation passed with ${report.warningCount} accessibility warning(s).`));
  } else {
    console.log(green('✓ No template validation issues found.'));
  }
  process.exitCode = 0;
  if (!cli || !cli._noExit) {
    process.exit(0);
  }
  return report;
}


