import { red, gray, bold, yellow } from './colors.js';

/**
 * Marks the process as failed.
 *
 * `process.exitCode` is set rather than calling `process.exit()`, because
 * `process.exit()` tears the process down immediately and can truncate stdout
 * and stderr that have not flushed yet — which in CI means a build that failed
 * without printing the reason. Setting the code lets Node exit normally once
 * the output has drained.
 * @param {number} [code] - The exit code to fail with.
 */
export function failProcess(code = 1) {
  process.exitCode = code;
}

/**
 * A mistake in how a command was called, such as a flag value it does not
 * accept or a file it cannot read. It is reported as one line, plus an
 * optional next step, without the failure headline and stack trace that would
 * make a typo look like a defect in Avenx.
 */
export class UsageError extends Error {
  /**
   * @param {string} message - What was wrong, naming the flag and the accepted values.
   * @param {object} [options]
   * @param {string} [options.hint] - A next step, printed under the message.
   * @param {unknown} [options.cause] - The underlying error, if any.
   */
  constructor(message, { hint, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'UsageError';
    this.hint = hint;
  }
}

/**
 * Reports a fatal error and marks the process as failed.
 *
 * Errors carrying an Avenx code (AVX_C03, AVX_W03 and friends) are diagnosed
 * conditions: the message already names the file, explains the problem and
 * often carries a code frame, so it is printed on its own. A stack trace there
 * would only point at the line of the compiler that raised it.
 *
 * A {@link UsageError} is printed on one line with its hint and no headline.
 *
 * Anything else is a bug rather than a diagnosis, so the stack is printed —
 * that is the only useful information such an error carries.
 * @param {Error|any} error - The failure.
 * @param {string} [action] - What was being attempted, for the headline.
 */
export function reportFatal(error, action = 'Build') {
  if (error instanceof UsageError) {
    console.error(red(`❌ ${error.message}`));
    if (error.hint) console.error(`\n${error.hint}`);
    failProcess(1);
    return;
  }

  console.error('');
  console.error(bold(red(`✖ ${action} failed`)));
  console.error('');

  console.error(red(describe(error)));

  console.error('');
  console.error(gray('The command exits with a non-zero status.'));

  failProcess(1);
}

/**
 * Formats a failure for display, without the stack for diagnosed errors.
 * @param {Error|any} error - The failure.
 * @returns {string} The text to print.
 */
function describe(error) {
  const isDiagnosed = Boolean(error && typeof error.code === 'string' && error.code.startsWith('AVX_'));
  if (isDiagnosed) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

/**
 * Reports a failed rebuild inside a watch loop.
 *
 * A watch session is interactive and long-running: the next save usually fixes
 * the problem. So the error is shown and watching continues, and crucially the
 * process exit code is left alone — a typo at 11am must not make the eventual
 * Ctrl-C report failure.
 *
 * This is the one place a build error does not fail the process, and it is
 * safe precisely because `avenx serve` and `avenx watch` never gate a
 * deployment. `avenx build` is unaffected.
 * @param {Error|any} error - The failure.
 */
export function reportRebuildFailure(error) {
  console.error('');
  console.error(bold(yellow('✖ Rebuild failed — the previous output is still in place')));
  console.error('');
  console.error(red(describe(error)));
  console.error('');
  console.error(gray('Watching for changes...'));
}
