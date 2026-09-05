/**
 * @file tokenizer.js
 * @description A quote-aware character scanner for Avenx component sources.
 *
 * ## Why this exists
 *
 * Declaration extraction used to be a set of regular expressions:
 *
 * ```js
 * content.match(/<state\s+([\s\S]*?)\s*\/>/)
 * template.replace(/<state.*? \/>/g, '')
 * ```
 *
 * The two patterns above disagree with each other. The first matches a
 * `<state>` tag written across several lines; the second does not, because `.`
 * excludes newlines. A multi-line declaration was therefore *read* correctly
 * and *stripped* incorrectly, so it survived into the template and was rendered
 * as a literal element wrapping the whole component. The documented
 * JSDoc-annotated form
 *
 * ```html
 * <state
 *   /** @type {number} *\/
 *   count="0"
 * />
 * ```
 *
 * hit exactly that path, with no diagnostic.
 *
 * The failure is not in those two patterns. It is that a regular expression
 * cannot describe a tag: it cannot know that a `>` inside a quoted attribute
 * value is not the end of the tag, and it cannot know that the `<` in
 * `a < b` inside an `<action>` body is not the start of one. Tightening the
 * patterns moves the failure rather than removing it.
 *
 * This module scans instead. It walks the source one character at a time,
 * tracks quoting, and yields tags with exact source offsets — which is what
 * lets the compiler remove a declaration by slicing the range it actually
 * occupied rather than by matching a shape it hopes the declaration has.
 *
 * ## What it is not
 *
 * It is not a spec-compliant HTML parser and does not need to be. Avenx
 * templates are authored, not scraped: there is no error recovery for
 * mis-nested tags here, because {@link module:lib/compiler/parser/htmlParser}
 * handles tree building. This layer answers one question — *where does this tag
 * begin and end in the source* — and answers it exactly.
 * @module lib/compiler/parser/tokenizer
 */

/**
 * Tags whose content is opaque to the tag scanner.
 *
 * The body of an `<action>` is JavaScript. It routinely contains `<`, `>` and
 * `<=`, none of which start a tag, and it may contain a string literal holding
 * markup. Scanning inside one produces phantom tags, so the scanner jumps from
 * the open tag straight to the matching close tag and hands back the span
 * between them verbatim.
 * @type {Set<string>}
 */
export const RAW_TEXT_TAGS = new Set(['action', 'resource', 'script', 'style']);

/**
 * Characters that may begin a tag name.
 *
 * `@` is included because Avenx directives are spelled `<@for>`, `<@css />`,
 * `<@suspense>`; uppercase is meaningful because a capitalised tag is a
 * component reference rather than an element.
 * @param {string} ch - A single character.
 * @returns {boolean} True when the character can start a tag name.
 */
function isTagNameStart(ch) {
  return !!ch && /[A-Za-z@]/.test(ch);
}

/**
 * Characters that may continue a tag name.
 * @param {string} ch - A single character.
 * @returns {boolean} True when the character can continue a tag name.
 */
function isTagNameChar(ch) {
  return !!ch && /[A-Za-z0-9@:._-]/.test(ch);
}

/**
 * Whether a character is HTML whitespace.
 * @param {string} ch - A single character.
 * @returns {boolean} True for space, tab, carriage return or newline.
 */
function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Builds a line/column index over a source string.
 *
 * The naive `getLineAndColumn` recomputes the line by counting newlines from
 * offset zero on every call, which is quadratic across a file's worth of
 * declarations. This precomputes the newline offsets once so each lookup is a
 * binary search.
 * @param {string} source - The source text.
 * @returns {{at: function(number): {line: number, column: number}}} A locator.
 */
export function createLineIndex(source) {
  /** @type {number[]} */
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  return {
    /**
     * Resolves a source offset to a 1-based line and column.
     * @param {number} offset - Absolute character offset.
     * @returns {{line: number, column: number}} The position.
     */
    at(offset) {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= offset) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }
      return { line: low + 1, column: offset - lineStarts[low] + 1 };
    },
  };
}

/**
 * Finds the offset of the `>` that closes the tag beginning at `start`.
 *
 * Quoting is tracked so that a `>` inside an attribute value — `<a title="a > b">`
 * — does not terminate the scan. This is the single behaviour a regular
 * expression cannot express, and the reason this function exists.
 * @param {string} source - The source text.
 * @param {number} start - Offset of the `<`.
 * @returns {number} Offset of the closing `>`, or -1 if the tag is unterminated.
 */
export function findTagEnd(source, start) {
  let quote = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Parses an attribute list into names, values and source offsets.
 *
 * Valueless attributes are reported separately from attributes whose value is
 * the string `"true"`. `<action name="x" atomic>` and
 * `<action name="x" atomic="true">` mean the same thing, but
 * `<contract static="false" />` does not mean `<contract static />`, so the
 * distinction has to survive parsing rather than be reconstructed later.
 * @param {string} source - The full source text.
 * @param {number} start - Offset where the attribute region begins.
 * @param {number} end - Offset where the attribute region ends (exclusive).
 * @returns {{values: Object<string,string>, valueless: Set<string>, order: string[],
 *   offsets: Object<string,{start: number, end: number, valueStart: number}>}}
 *   The parsed attributes.
 */
export function parseAttributeRegion(source, start, end) {
  /** @type {Object<string,string>} */
  const values = {};
  /** @type {Set<string>} */
  const valueless = new Set();
  /** @type {string[]} */
  const order = [];
  /** @type {Object<string,{start: number, end: number, valueStart: number}>} */
  const offsets = {};

  const isNameChar = (ch) => !!ch && /[@\w:.\-[\]$]/.test(ch);

  let i = start;
  while (i < end) {
    while (i < end && isSpace(source[i])) i++;
    if (i >= end) break;

    // JSDoc annotations are written between attributes in the documented
    // multi-line form:
    //
    //   <state
    //     /** @type {number} *\/
    //     count="0"
    //   />
    //
    // Their contents are documentation, not attributes. Reading them as
    // attributes turned `@type {number}` into three phantom state keys.
    if (source[i] === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 || close >= end ? end : close + 2;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      let nl = i;
      while (nl < end && source[nl] !== '\n') nl++;
      i = nl;
      continue;
    }

    const nameStart = i;
    while (i < end && isNameChar(source[i])) i++;
    if (i === nameStart) {
      // Not a legal attribute-name character. Skip it rather than stalling;
      // a malformed fragment must not turn into an infinite loop.
      i++;
      continue;
    }
    const name = source.slice(nameStart, i);

    let lookahead = i;
    while (lookahead < end && isSpace(source[lookahead])) lookahead++;

    if (source[lookahead] === '=') {
      i = lookahead + 1;
      while (i < end && isSpace(source[i])) i++;
      const quote = source[i];
      const valueStart = i;
      if (quote === '"' || quote === "'") {
        i++;
        let value = '';
        while (i < end) {
          const ch = source[i];
          if (ch === '\\' && i + 1 < end) {
            value += ch + source[i + 1];
            i += 2;
            continue;
          }
          if (ch === quote) {
            i++;
            break;
          }
          value += ch;
          i++;
        }
        values[name] = value;
        offsets[name] = { start: nameStart, end: i, valueStart: valueStart + 1 };
      } else {
        const rawStart = i;
        while (i < end && !isSpace(source[i]) && source[i] !== '>') i++;
        values[name] = source.slice(rawStart, i);
        offsets[name] = { start: nameStart, end: i, valueStart: rawStart };
      }
    } else {
      values[name] = 'true';
      valueless.add(name);
      offsets[name] = { start: nameStart, end: i, valueStart: i };
    }

    if (!order.includes(name)) {
      order.push(name);
    }
  }

  return { values, valueless, order, offsets };
}

/**
 * @typedef {object} ScannedTag
 * @property {string} name - The tag name exactly as written.
 * @property {string} lowerName - The tag name lowercased, for matching.
 * @property {Object<string,string>} attrs - Attribute values by name.
 * @property {Set<string>} valueless - Names of attributes written without a value.
 * @property {Object<string,{start: number, end: number, valueStart: number}>} attrOffsets
 *   Source offsets per attribute.
 * @property {boolean} selfClosing - Whether the tag was written `<x />`.
 * @property {number} start - Offset of the opening `<`.
 * @property {number} end - Offset just past the tag, or past `</name>` for a
 *   raw-text tag with a body.
 * @property {number} openEnd - Offset just past the opening tag's `>`.
 * @property {string|null} body - Verbatim body text for a raw-text tag, else null.
 * @property {number} bodyStart - Offset where the body begins, or -1.
 */

/**
 * Scans a source string for top-level tags whose name is in `wanted`.
 *
 * Only tags at the top level of the source are reported. A declaration nested
 * inside markup is not a declaration, and reporting one would let a literal
 * `<state>` written inside a `<pre>` block silently become component state.
 *
 * Raw-text tags (see {@link RAW_TEXT_TAGS}) have their body captured verbatim:
 * the scanner skips from the opening tag to the matching close tag without
 * interpreting anything in between, so an action body containing `a < b`,
 * `=>` or a string holding markup survives untouched.
 * @param {string} source - The component source.
 * @param {Set<string>} wanted - Lowercased tag names to report.
 * @returns {ScannedTag[]} The tags found, in source order.
 */
export function scanTags(source, wanted) {
  /** @type {ScannedTag[]} */
  const found = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    // Comments are skipped whole: a declaration written inside one is a
    // comment, not a declaration.
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      i = close === -1 ? source.length : close + 3;
      continue;
    }

    if (!isTagNameStart(source[lt + 1])) {
      i = lt + 1;
      continue;
    }

    let nameEnd = lt + 1;
    while (nameEnd < source.length && isTagNameChar(source[nameEnd])) nameEnd++;
    const name = source.slice(lt + 1, nameEnd);
    const lowerName = name.toLowerCase();

    const tagEnd = findTagEnd(source, lt);
    if (tagEnd === -1) {
      // Unterminated tag: nothing further can be scanned reliably.
      break;
    }

    const selfClosing = source[tagEnd - 1] === '/';
    const attrEnd = selfClosing ? tagEnd - 1 : tagEnd;

    if (!wanted.has(lowerName)) {
      // Even when the tag is not wanted, a raw-text body must be skipped so
      // that JavaScript inside it is never scanned for tags.
      if (RAW_TEXT_TAGS.has(lowerName) && !selfClosing) {
        const close = findRawTextClose(source, tagEnd + 1, lowerName);
        i = close === -1 ? source.length : close.end;
        continue;
      }
      i = tagEnd + 1;
      continue;
    }

    const { values, valueless, offsets } = parseAttributeRegion(source, nameEnd, attrEnd);

    /** @type {ScannedTag} */
    const tag = {
      name,
      lowerName,
      attrs: values,
      valueless,
      attrOffsets: offsets,
      selfClosing,
      start: lt,
      end: tagEnd + 1,
      openEnd: tagEnd + 1,
      body: null,
      bodyStart: -1,
    };

    if (!selfClosing && RAW_TEXT_TAGS.has(lowerName)) {
      const close = findRawTextClose(source, tagEnd + 1, lowerName);
      if (close) {
        tag.body = source.slice(tagEnd + 1, close.start);
        tag.bodyStart = tagEnd + 1;
        tag.end = close.end;
      }
    }

    found.push(tag);
    i = tag.end;
  }

  return found;
}

/**
 * Finds the close tag that terminates a raw-text element.
 *
 * Nesting is counted so that a nested `<resource>` inside a `<resource>` body
 * does not close the outer one early. Matching is case-insensitive because HTML
 * tag names are.
 * @param {string} source - The source text.
 * @param {number} from - Offset just past the opening tag's `>`.
 * @param {string} lowerName - The lowercased tag name to close.
 * @returns {{start: number, end: number}|null} Offsets of the close tag, or null.
 */
export function findRawTextClose(source, from, lowerName) {
  let depth = 1;
  let i = from;
  const openNeedle = `<${lowerName}`;
  const closeNeedle = `</${lowerName}`;

  while (i < source.length) {
    const nextClose = source.toLowerCase().indexOf(closeNeedle, i);
    if (nextClose === -1) return null;

    const nextOpen = source.toLowerCase().indexOf(openNeedle, i);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const boundary = source[nextOpen + openNeedle.length];
      if (boundary === undefined || isSpace(boundary) || boundary === '>' || boundary === '/') {
        depth++;
      }
      i = nextOpen + openNeedle.length;
      continue;
    }

    depth--;
    const gt = source.indexOf('>', nextClose);
    if (depth === 0) {
      return { start: nextClose, end: gt === -1 ? source.length : gt + 1 };
    }
    i = gt === -1 ? source.length : gt + 1;
  }

  return null;
}

/**
 * Removes a set of source ranges, returning the remaining text.
 *
 * Ranges are removed by offset rather than by pattern, which is the whole point
 * of scanning: whatever the scanner decided a declaration occupied is exactly
 * what leaves the template, with no second, differently-shaped pattern that can
 * disagree with the first.
 * @param {string} source - The source text.
 * @param {Array<{start: number, end: number}>} ranges - Ranges to remove.
 * @returns {string} The source with those ranges elided.
 */
export function stripRanges(source, ranges) {
  if (ranges.length === 0) return source;

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const range of sorted) {
    if (range.start < cursor) continue;
    result += source.slice(cursor, range.start);
    cursor = range.end;
  }
  result += source.slice(cursor);

  return result;
}
