import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves the Prettier entry point to run with the current Node binary.
 *
 * `npx prettier` is not spawnable portably: Node refuses to spawn `.cmd`
 * files without a shell (the CVE-2024-27980 hardening), so
 * `execFileSync('npx.cmd', ..., { shell: false })` fails with EINVAL on
 * Windows, and `shell: true` would concatenate the glob arguments unescaped.
 * Running Prettier's entry point with the same Node binary that is running
 * the CLI sidesteps both and works on every platform.
 *
 * The project's own Prettier wins when it has one, so a project can pin a
 * different version than the framework; otherwise the framework's own
 * dependency is used, which is the version the plugin is developed against.
 * @param {string} baseDir - The project directory Prettier runs against.
 * @param {string} frameworkDir - The framework installation directory.
 * @returns {string} Absolute path to Prettier's entry point.
 */
function resolvePrettierBin(baseDir, frameworkDir) {
  const localBin = path.join(baseDir, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  const frameworkBin = path.join(frameworkDir, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  return fs.existsSync(localBin) ? localBin : frameworkBin;
}

/**
 * Formats the project's source files with Prettier.
 *
 * The glob list names every file kind an Avenx project may contain, and a
 * project is free to contain only some of them -- a blank scaffold has no
 * components, no pages, no CSS and no Markdown. Prettier treats a glob that
 * matches nothing as an error and exits non-zero, so without the flag below
 * `avenx format` fails in CI and pre-commit hooks on any project that happens
 * to lack one of these file kinds, while reporting "Formatting failed" over a
 * run that formatted everything it found. `--no-error-on-unmatched-pattern`
 * makes Prettier skip the empty globs instead; a glob that matches files is
 * still formatted, and a genuine failure -- a syntax error, a plugin crash --
 * still exits non-zero through the status propagation below.
 * With `--dry-run` Prettier lists the files that would change and writes
 * nothing. Prettier exits 1 in that case; a dry run treats that status as
 * "files would change" and still exits 0, so existing scripts that run
 * `avenx format --dry-run` are not broken. Only a genuine failure exits non-zero.
 * With `--check` Prettier lists the files that are not formatted, writes
 * nothing, and exits 1 when any is found, so CI and pre-commit hooks fail.
 * Any flag other than the ones above is rejected rather than ignored, so a
 * typo such as `--wirte` cannot silently format in place.
 * @param {object} cli - AvenxCLI instance containing baseDir and frameworkDir.
 * @param {string[]} [args] - Command arguments: `--dry-run` / `-d` or `--check`.
 * @returns {void}
 */
export function runFormat(cli, args = []) {
  const allowedFlags = ['--dry-run', '-d', '--check'];
  const unknownFlags = args.filter((arg) => arg.startsWith('-') && !allowedFlags.includes(arg));
  if (unknownFlags.length > 0) {
    console.error(`Unknown option(s) for avenx format: ${unknownFlags.join(', ')}`);
    console.error('Usage: avenx format [--dry-run | --check]');
    process.exitCode = 1;
    return;
  }

  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const check = args.includes('--check');
  if (dryRun && check) {
    console.error('avenx format: use either --dry-run or --check, not both.');
    process.exitCode = 1;
    return;
  }

  if (check) {
    console.log('Checking project formatting (no files will be written)...');
  } else {
    console.log(dryRun ? 'Checking project files (dry run)...' : 'Formatting project files...');
  }

  try {
    const pluginPath = path.join(cli.frameworkDir, 'lib', 'core', 'tooling', 'prettierPlugin.js');

    execFileSync(
      process.execPath,
      [
        resolvePrettierBin(cli.baseDir, cli.frameworkDir),
        '--plugin',
        pluginPath,
        '--no-error-on-unmatched-pattern',
        check ? '--check' : dryRun ? '--list-different' : '--write',
        'src/**/*.component.js',
        'src/**/*.page.js',
        'src/**/*.css',
        '**/*.js',
        '**/*.md',
        '**/*.json',
      ],
      {
        cwd: cli.baseDir,
        stdio: 'inherit',
        shell: false,
      },
    );

    if (check) {
      console.log('All matched files are formatted; no files were written.');
    } else {
      console.log(dryRun ? 'Dry run completed; no files were written.' : 'Formatting completed successfully.');
    }
  } catch (error) {
    if (dryRun && error?.status === 1) {
      console.log('Files listed above would change; no files were written.');
      return;
    }

    if (check && error?.status === 1) {
      console.error('Files listed above are not formatted; run "avenx format" to fix them.');
      process.exitCode = 1;
      return;
    }

    console.error('Formatting failed.');

    if (error?.status !== undefined) {
      process.exitCode = error.status || 1;
    } else {
      process.exitCode = 1;
    }
  }
}
