/**
 * @file validate.js
 * @description Proves that emitted JavaScript parses before the build is
 * allowed to call itself successful.
 *
 * ## Why this is a separate, unconditional step
 *
 * The compiler could previously emit a bundle containing
 *
 * ```js
 * const { AvenxGuard } = Avenx;
 * const { AvenxGuard } = Avenx;
 * ```
 *
 * and report `Build successful`. The generated file was not JavaScript; the
 * application did not start; nothing in the pipeline noticed, because nothing
 * in the pipeline ever asked whether the output it had just written could be
 * parsed. That specific collision cannot happen any more -- every module is its
 * own scope now, so two files declaring the same name simply coexist -- but a
 * code generator that is only correct because its known failure modes have been
 * fixed one at a time is a generator whose next failure ships silently.
 *
 * So this check is not about guards. It establishes the invariant:
 *
 * ```text
 * avenx build reports success  =>  the emitted JavaScript parses
 * ```
 *
 * ## How
 *
 * `node:vm` compiles the source without running it. That is a real parse by the
 * same engine that will parse the file in production, it needs no dependency,
 * and it costs a few milliseconds on a bundle of this size.
 *
 * Validation happens against the staging directory, before promotion, so a
 * bundle that fails never reaches `dist/` at all — the previous build's output
 * is left intact rather than being replaced by something broken.
 * @module lib/compiler/bundle/validate
 */

import vm from 'vm';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { BuildError } from '../errors/index.js';

/**
 * Extracts the offending line from a source, for the error message.
 *
 * A syntax error in a 190 KB single-line minified bundle is unreadable without
 * an excerpt, and the line number alone points at a file the developer did not
 * write. Showing the text is what makes the diagnostic actionable.
 * @param {string} source - The emitted source.
 * @param {number} lineNumber - 1-based line number.
 * @returns {string} A trimmed excerpt, or an empty string.
 */
function excerpt(source, lineNumber) {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return '';
  const line = source.split(/\r?\n/)[lineNumber - 1];
  if (typeof line !== 'string') return '';
  const trimmed = line.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/**
 * Reads the line number out of a V8 syntax error's stack.
 *
 * V8 reports the position as `<filename>:<line>` on the stack's first line. It
 * is not exposed as a structured property, so it has to be read back out.
 * @param {Error} error - The thrown SyntaxError.
 * @param {string} filename - The filename passed to the compiler.
 * @returns {number} The 1-based line, or 0 when it cannot be determined.
 */
function lineFromStack(error, filename) {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stack.match(new RegExp(`${escaped}:(\\d+)`));
  return match ? Number(match[1]) : 0;
}

/**
 * Asserts that a string of emitted JavaScript parses as a classic script.
 *
 * The bundle is a classic script, not a module: it is loaded with a plain
 * `<script src>` tag and its imports have already been rewritten away. Parsing
 * it as a script is therefore the same parse the browser will perform.
 * @param {string} code - The emitted JavaScript.
 * @param {string} artifact - The artifact name, used in the diagnostic.
 * @throws {BuildError} AVX_C15 when the source does not parse.
 */
export function assertValidJavaScript(code, artifact) {
  try {
    // Compiling is enough: the script is never run, so no application code
    // executes during a build.
    new vm.Script(code, { filename: artifact });
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    const line = lineFromStack(error, artifact);
    throw new BuildError(
      AvenxErrorCodes.COMPILER_INVALID_OUTPUT,
      artifact,
      error.message,
      line > 0 ? String(line) : 'unknown',
      excerpt(code, line) || '(source line unavailable)',
    );
  }
}

/**
 * Validates every JavaScript artifact in a build's output set.
 * @param {Map<string, string>} outputs - Artifact name to contents.
 * @throws {BuildError} When any `.js` artifact does not parse.
 */
export function assertValidOutputs(outputs) {
  for (const [name, contents] of outputs) {
    if (name.endsWith('.js') && typeof contents === 'string') {
      assertValidJavaScript(contents, name);
    }
  }
}
