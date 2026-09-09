/**
 * @file minify.js
 * @description Removes what a browser does not need, and nothing else.
 *
 * ## What this does, stated precisely
 *
 * Comments are deleted. Leading and trailing whitespace is trimmed from every
 * line whose margins are code rather than the inside of a string or a template
 * literal. That is the whole transformation.
 *
 * It does **not** rename identifiers, fold constants, remove dead branches or
 * join statements. Those need a real ECMAScript parser to do safely, and a
 * minifier that guesses produces a bundle that is smaller and wrong — which is
 * strictly worse than one that is larger and right. The size this leaves on the
 * table is reported honestly rather than closed by guessing.
 *
 * ## One property worth the constraint
 *
 * Line count is preserved exactly. A deleted block comment leaves its newlines
 * behind; trimming touches only the margins. So the source map emitted for a
 * development build is equally valid for the minified production build, and a
 * production stack trace still names a file and a line the developer wrote.
 * Most minifiers buy their last few per cent by giving that up.
 *
 * Comments and indentation are also what gzip compresses best, so the gap
 * between this and an identifier-mangling minifier is much narrower on the wire
 * than it is on disk. The build reports both numbers.
 * @module lib/bundler/minify
 */

import { CodeMask } from './scanner.js';

/**
 * Strips comments and indentation from emitted JavaScript.
 * @param {string} code - The bundle source.
 * @returns {string} The same program, with comments and margins removed.
 */
export function minify(code) {
  const mask = new CodeMask(code);

  // Comment spans, so a line that is entirely comment collapses to nothing and
  // one that ends in a comment loses the tail. Recorded as ranges rather than
  // by rewriting a character array: the bundle is hundreds of kilobytes and
  // this runs on every build, including every rebuild `avenx watch` performs.
  const comment = new Uint8Array(code.length);
  for (const region of mask.regions) {
    if (region.kind !== 'line-comment' && region.kind !== 'block-comment') continue;
    for (let i = region.start; i < Math.min(region.end, code.length); i += 1) {
      comment[i] = 1;
    }
  }

  /**
   * Whether an offset can be dropped from a line's margin.
   *
   * A blanked comment can; a string or template literal's own spacing cannot,
   * because it is a value. That distinction is the whole safety argument for
   * this minifier, and getting it backwards would corrupt every multi-line
   * template in the runtime.
   * @param {number} index - Offset to test.
   * @returns {boolean} True when the character is droppable margin.
   */
  const droppable = (index) => {
    if (comment[index] === 1) return true;
    const char = code[index];
    return (char === ' ' || char === '\t' || char === '\r') && !mask.isLiteral(index);
  };

  const out = [];
  let lineStart = 0;

  /**
   * Emits one line, trimmed where trimming is safe.
   * @param {number} end - Exclusive end offset of the line.
   */
  const flush = (end) => {
    let from = lineStart;
    let to = end;

    while (from < to && droppable(from)) from += 1;
    while (to > from && droppable(to - 1)) to -= 1;

    if (to <= from) {
      out.push('');
      return;
    }

    // A comment in the middle of a line -- `const x = 1; // why` is handled by
    // the trailing trim, but `foo(/* note */ bar)` is not -- so the interior is
    // copied with comment characters replaced by a single space each.
    let piece = '';
    let spanStart = from;
    for (let i = from; i < to; i += 1) {
      if (comment[i] !== 1) continue;
      piece += code.slice(spanStart, i);
      while (i < to && comment[i] === 1) i += 1;
      piece += ' ';
      spanStart = i;
    }
    out.push(spanStart === from ? code.slice(from, to) : piece + code.slice(spanStart, to));
  };

  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '\n') {
      flush(i);
      lineStart = i + 1;
    }
  }
  flush(code.length);

  return out.join('\n');
}
