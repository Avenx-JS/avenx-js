/**
 * Measures complete emitted modules, including their wrappers and newlines.
 * The emitter supplies disjoint, zero-based, half-open line ranges; the
 * minifier preserves those lines. No module boundaries are guessed from text.
 * @param {string} code - The final, optionally minified bundle.
 * @param {Array<{id: string, startLine: number, endLine: number}>} ranges - Emitted ranges.
 * @returns {Array<{id: string, bytes: number}>} Exact UTF-8 contributions.
 */
export function measureModules(code, ranges) {
  const offsets = [0];
  let start = 0;
  for (let index = 0; index < code.length; index++) {
    if (code[index] !== '\n') continue;
    offsets.push(offsets[offsets.length - 1] + Buffer.byteLength(code.slice(start, index + 1), 'utf8'));
    start = index + 1;
  }
  offsets.push(offsets[offsets.length - 1] + Buffer.byteLength(code.slice(start), 'utf8'));
  return ranges.map(({ id, startLine, endLine }) => ({ id, bytes: offsets[endLine] - offsets[startLine] }));
}
