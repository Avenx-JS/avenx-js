/**
 * @file source.js
 * @description Reading an Avenx component file without losing where things are.
 *
 * ## Why this exists
 *
 * By the time the compiler validates a template it has already rewritten it:
 * imports are stripped, comments removed, `<state>`/`<computed>`/`<action>`/
 * `<resource>`/`<contract>` blocks deleted, style scoping applied, `data-ax-bind`
 * expanded. Offsets into that string do not point at anything a developer can
 * open in an editor.
 *
 * Atlas reports file and line for every relationship it records, so it cannot
 * use those offsets. Instead it **masks** the original source: declaration
 * blocks and comments are replaced character-for-character with spaces, and
 * newlines are kept. The result is the same length as the file, so an offset
 * into the mask is an offset into the file, and `lineOf` turns it into the
 * line the developer wrote.
 *
 * Masking rather than slicing is what keeps this honest. A slice would need an
 * offset table that has to be maintained in step with every future template
 * transformation; a mask cannot drift, because it never moves anything.
 * @module lib/compiler/atlas/source
 */

/**
 * Regions of a component file that are declarations rather than template.
 *
 * The patterns mirror the ones `extractTemplate` uses to strip the same
 * regions, so the mask and the compiled template agree on what the template
 * is. Order matters only in that block forms must precede self-closing forms.
 * @type {RegExp[]}
 */
const DECLARATION_PATTERNS = [
  /<!--[\s\S]*?-->/g,
  /^[ \t]*import\s+(?:[\s\w$,{}*]*?\s+from\s+)?['"][^'"]*['"];?[ \t]*$/gm,
  /<action\b[\s\S]*?<\/action>/gi,
  /<resource\b[\s\S]*?<\/resource>/gi,
  /<resource\s[^>]*?\/>/gi,
  /<state\s[^>]*?\/>/gi,
  /<computed\s[^>]*?\/>/gi,
  /<(?:contract|@contract)\s[^>]*?\/>/gi,
];

/**
 * Replaces a region with spaces, keeping newlines so line numbers survive.
 * @param {string} text - The region's text.
 * @returns {string} A same-length blank of it.
 */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Blanks out everything in a component file that is not template markup.
 *
 * The returned string has the same length as the input, so any offset into it
 * is an offset into the original file.
 * @param {string} content - The component source.
 * @returns {string} The masked source.
 */
export function maskDeclarations(content) {
  let masked = content;
  for (const pattern of DECLARATION_PATTERNS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, blank);
  }
  return masked;
}

/**
 * Builds an index of line start offsets for fast offset-to-line lookup.
 *
 * Component files are small, but every binding, handler and directive asks for
 * a line, so scanning the string per lookup would be quadratic in the number
 * of bindings.
 * @param {string} content - The source.
 * @returns {number[]} Offsets at which each line begins.
 */
export function lineIndex(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * Converts an offset into a 1-based line and column.
 * @param {number[]} starts - The index from {@link lineIndex}.
 * @param {number} offset - An offset into the same source.
 * @returns {{line: number, column: number}} The position.
 */
export function positionAt(starts, offset) {
  if (!(offset >= 0)) return { line: 1, column: 1 };
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

/**
 * Finds the 1-based line a declaration sits on.
 *
 * Used for the declarations Atlas records by name rather than by offset — a
 * `<state>` key, a `<computed>`, an `<action>` — where the name is what the
 * developer would search for.
 * @param {string} content - The file contents.
 * @param {RegExp} pattern - What to look for.
 * @returns {number|null} The line, or null when the pattern does not match.
 */
export function lineOf(content, pattern) {
  pattern.lastIndex = 0;
  const match = pattern.exec(content);
  if (!match) return null;
  let line = 1;
  for (let i = 0; i < match.index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Escapes a declared name for use inside a regular expression.
 * @param {string} name - The name.
 * @returns {string} The escaped name.
 */
export function escapeName(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locates the line of a `<state>` key.
 *
 * State keys share one tag, so the attribute is what is searched for rather
 * than the tag. When the key cannot be found — an unusual formatting — the
 * `<state>` tag's own line is a truthful fallback.
 * @param {string} content - The component source.
 * @param {string} key - The state key.
 * @returns {number|null} The line, or null.
 */
export function stateKeyLine(content, key) {
  const attr = lineOf(content, new RegExp(`\\b${escapeName(key)}\\s*=\\s*["']`));
  if (attr !== null) return attr;
  return lineOf(content, /<state\b/);
}

export default { maskDeclarations, lineIndex, positionAt, lineOf, stateKeyLine, escapeName };
