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
  const chars = code.split('');

  // Comments become spaces rather than disappearing, so every offset after
  // them is still the offset the mask describes. Newlines inside a block
  // comment are kept, which is what preserves the line count.
  for (const region of mask.regions) {
    if (region.kind !== 'line-comment' && region.kind !== 'block-comment') continue;
    for (let i = region.start; i < Math.min(region.end, chars.length); i += 1) {
      chars[i] = chars[i] === '\n' ? '\n' : ' ';
    }
  }

  const out = [];
  let lineStart = 0;

  /**
   * Emits one line, trimmed where trimming is safe.
   * @param {number} end - Exclusive end offset of the line.
   */
  const flush = (end) => {
    let from = lineStart;
    let to = end;

    // Only trim margins that are outside a string or template literal. A
    // template literal carries its own indentation as data; a comment that has
    // just been blanked does not, so `isLiteral` rather than `isCode` is the
    // question -- the blanked comment must be trimmable or the biggest part of
    // the saving never happens.
    while (from < to && /[ \t]/.test(chars[from]) && !mask.isLiteral(from)) from += 1;
    while (to > from && /[ \t\r]/.test(chars[to - 1]) && !mask.isLiteral(to - 1)) to -= 1;

    out.push(chars.slice(from, to).join(''));
  };

  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === '\n') {
      flush(i);
      lineStart = i + 1;
    }
  }
  flush(chars.length);

  return out.join('\n');
}
