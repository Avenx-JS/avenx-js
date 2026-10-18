/**
 * @file htmlTree.js
 * @description The template tree parser and serializer.
 *
 * `parser/tokenizer.js` answers "where does this tag begin and end in the
 * source". This module answers the next question: what tree do those tags
 * describe. It was previously private to `ComponentParser`, which was fine
 * while the compiler had exactly one consumer for it. The render compiler
 * (`lib/compiler/render/`) is a second, and a second copy of an HTML parser is
 * how two halves of one compiler come to disagree about what a template says.
 *
 * It is deliberately not a spec-compliant HTML parser. Avenx templates are
 * authored rather than scraped, and by the time a template reaches here the
 * declaration tags are gone and the directives have been rewritten into
 * ordinary elements. What it guarantees is that `serializeHTML(parseHTML(x))`
 * round-trips a template the compiler itself produced.
 * @module lib/compiler/parser/htmlTree
 */

import { tokenizeMarkup, findTagEnd } from '../../core/utils/markupLexer.js';

/**
 * The set of HTML tags that are void (self-closing / no children) by default.
 * @type {string[]}
 */
export const DEFAULT_VOID_TAGS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

/**
 * Builds the effective set of void tags for a parse or serialize pass.
 * @param {string[]} [customVoidTags] - Additional void tag names (lowercase).
 * @returns {Set<string>} The effective set.
 */
export function buildVoidTagsSet(customVoidTags = []) {
  return new Set([...DEFAULT_VOID_TAGS, ...customVoidTags]);
}

/**
 * A lightweight node representation for parsing HTML templates.
 */
export class HTMLNode {
  /**
   * Creates an instance of HTMLNode.
   * @param {string} type - The node type.
   * @param {string} [tagName] - The tag name.
   * @param {Object} [attrs] - The attribute map.
   * @param {boolean} [isSelfClosing] - Whether the tag is self-closing.
   */
  constructor(type, tagName = '', attrs = {}, isSelfClosing = false) {
    this.type = type;
    this.tagName = tagName;
    this.attrs = attrs;
    this.isSelfClosing = isSelfClosing;
    /**
     * The tag's attribute text exactly as written, for consumers that need the
     * source rather than the parsed map. Set by {@link parseHTML}; nodes built
     * by hand leave it empty.
     * @type {string}
     */
    this.rawAttrs = '';
    /**
     * The quote character each parsed attribute was written with (`"`, `'`,
     * or null). The serializer writes a value back with the same quote, so a
     * value such as `msg = "hi"` written in single quotes survives a
     * parse/serialize round trip verbatim instead of becoming `&quot;hi&quot;`,
     * which the expression compiler would then read literally.
     * @type {Object<string, string|null>}
     */
    this.attrQuotes = {};
    this.line = null;
    this.column = null;
    /** @type {HTMLNode[]} */
    this.children = [];
    this.content = '';
    /** @type {Set<string>} */
    this.contracts = new Set();
    this.initContracts();
  }

  /**
   * Initializes contracts attached to this node via tag names or attributes.
   */
  initContracts() {
    const valid = ['static', 'pure', 'deterministic', 'isolated'];
    if (this.tagName && this.tagName.startsWith('@')) {
      const contractTag = this.tagName.slice(1).toLowerCase();
      if (valid.includes(contractTag)) {
        this.contracts.add(contractTag);
      }
    }
    if (this.attrs && typeof this.attrs === 'object') {
      for (const c of valid) {
        if (this.attrs[c] !== undefined && this.attrs[c] !== 'false') {
          this.contracts.add(c);
        }
      }
      if (this.attrs['data-ax-contract']) {
        const list = this.attrs['data-ax-contract'].split(/\s+/).filter(Boolean);
        for (const item of list) {
          const lower = item.toLowerCase();
          if (valid.includes(lower)) {
            this.contracts.add(lower);
          }
        }
      }
    }
  }
}

/**
 * Parses an attribute string into a key-value object.
 *
 * Handles three attribute forms:
 *  - Quoted values: `name="value"` or `name='value'`. A backslash-escaped
 *    quote (`\"` or `\'`) inside the value is preserved verbatim rather than
 *    ending the value early, so expressions containing an apostrophe or a
 *    quote character (e.g. `@click='say(\'hi\')'`) parse correctly instead
 *    of being split into several bogus attributes.
 *  - Unquoted values: `name=value`, read up to the next whitespace or `>`.
 *  - Valueless boolean attributes: `disabled`, mapped to the string `'true'`
 *    (matching the `attr="true"` / `attr="false"` convention the runtime's
 *    boolean-attribute handling already expects, rather than `null`).
 * @param {string} attrStr
 * @returns {Object<string, string>}
 */
export function parseAttributes(attrStr) {
  const attrs = {};
  if (!attrStr) return attrs;

  const len = attrStr.length;
  const isWhitespace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  const isNameChar = (ch) => /[@\w:.\-[\]]/.test(ch);

  let i = 0;
  while (i < len) {
    // Skip whitespace between attributes.
    while (i < len && isWhitespace(attrStr[i])) i++;
    if (i >= len) break;

    // Read the attribute name.
    const nameStart = i;
    while (i < len && isNameChar(attrStr[i])) i++;
    if (i === nameStart) {
      // Stray character that isn't part of a valid attribute name; skip it
      // so a malformed fragment can't stall the scan in an infinite loop.
      i++;
      continue;
    }
    const name = attrStr.slice(nameStart, i);

    // Look ahead (past whitespace) for an '=' sign.
    let lookahead = i;
    while (lookahead < len && isWhitespace(attrStr[lookahead])) lookahead++;

    if (attrStr[lookahead] === '=') {
      i = lookahead + 1;
      while (i < len && isWhitespace(attrStr[i])) i++;

      const quote = attrStr[i];
      if (quote === '"' || quote === "'") {
        i++;
        let value = '';
        while (i < len) {
          const ch = attrStr[i];
          if (ch === '\\' && i + 1 < len) {
            value += ch + attrStr[i + 1];
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
        attrs[name] = value;
      } else {
        // Unquoted value: read until whitespace or the tag's closing '>'.
        const valueStart = i;
        while (i < len && !isWhitespace(attrStr[i]) && attrStr[i] !== '>') i++;
        attrs[name] = attrStr.slice(valueStart, i);
      }
    } else {
      // Valueless boolean attribute, e.g. `disabled`.
      attrs[name] = 'true';
    }
  }

  return attrs;
}

/**
 * Calculates 1-based line and column numbers for a character offset in a source string.
 * @param {string} source - The original source code string.
 * @param {number} offset - The zero-based character index.
 * @returns {{ line: number, column: number }}
 */
export function getLineAndColumn(source, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  const column = offset - lastNewline;
  return { line, column };
}

/**
 * The arms of a conditional chain.
 *
 * They are parsed as siblings rather than as a nest, which is what lets
 * `</@if>` terminate the chain and what lets a consumer read the arms as an
 * ordered list instead of unwinding a ladder.
 * @type {Set<string>}
 */
const IF_CHAIN_TAGS = new Set(['@if', '@elseif', '@elif', '@else']);

/**
 * The arms that continue a chain, and therefore end the arm before them.
 * @type {Set<string>}
 */
const IF_CONTINUATION_TAGS = new Set(['@elseif', '@elif', '@else']);

/**
 * Finds the offset of the `>` that ends the tag opening at `start`.
 *
 * Quoting is honoured for every tag, because a `>` inside `title="a > b"` has
 * never been the end of a tag. Bracket depth is honoured only for `@`-prefixed
 * directive tags, and that exception is the point of this function.
 *
 * A directive header carries an expression rather than attributes:
 *
 * ```html
 * <@for row in rows.filter(r => r.score > 90)>
 * ```
 *
 * Scanning for the first unquoted `>` ends that tag at `r.score `, which is why
 * the previous implementation truncated the list expression to
 * `rows.filter(r =` and reported it as a malformed template expression. The
 * expression is not malformed; the scan was. Inside `(`, `[` or `{` a `>` is a
 * comparison or an arrow, never a tag end, so the scan tracks depth and only
 * accepts a `>` at depth zero.
 *
 * The exception is deliberately not extended to ordinary elements. `<div
 * data-x=a(b>c)>` is not markup anyone writes, and widening the rule would
 * change how existing templates parse for no gain.
 * @param {string} html - The full template source.
 * @param {number} start - Offset of the `<` that opens the tag.
 * @returns {number} Offset of the closing `>`, or -1 when the tag is unterminated.
 */
export function scanTagEnd(html, start) {
  return findTagEnd(html, start);
}

/**
 * Parses an HTML string into a tree of HTMLNode elements with positional metadata.
 * @param {string} html
 * @param {string[]} [customVoidTags]
 * @returns {HTMLNode[]}
 */
export function parseHTML(html, customVoidTags = []) {
  const root = new HTMLNode('element', 'root');
  const stack = [root];
  const voidTags = buildVoidTagsSet(customVoidTags);
  const source = typeof html === 'string' ? html : '';
  const tokens = tokenizeMarkup(source);
  const position = createPositionReader(source);

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];

    if (token.type === 'comment') {
      const node = new HTMLNode('comment');
      node.content = source.slice(token.start + 4, token.unterminated ? token.end : token.end - 3);
      Object.assign(node, position(token.start));
      stack[stack.length - 1].children.push(node);
      index++;
      continue;
    }

    if (token.type === 'close') {
      if (token.unterminated) {
        // Historical reading: an unterminated close tag and everything after it
        // is text. The compiler reports it as a malformed template first.
        appendText(stack[stack.length - 1], source.slice(token.start), position(token.start));
        break;
      }
      const wanted = source
        .slice(token.start + 2, token.end - 1)
        .replace(/\s+/g, '')
        .toLowerCase();
      let foundIdx = -1;
      for (let j = stack.length - 1; j > 0; j--) {
        const open = stack[j].tagName.toLowerCase();
        // `</@if>` ends the chain it opened, whichever arm is currently open.
        // The arms are siblings (see the implied-end-tag rule below), so the
        // one on the stack when the close arrives is `<@else>` far more often
        // than `<@if>`.
        if (open === wanted || (wanted === '@if' && IF_CHAIN_TAGS.has(open))) {
          foundIdx = j;
          break;
        }
      }
      if (foundIdx !== -1) {
        while (stack.length > foundIdx) {
          stack.pop();
        }
      }
      // An unmatched closing tag is skipped, to stay compatible with the
      // permissive template transforms that produce some of this markup.
      index++;
      continue;
    }

    if (token.type === 'open' && !token.unterminated) {
      const tagName = token.name;
      const attrs = {};
      const attrQuotes = {};
      for (const attr of token.attrs) {
        attrs[attr.name] = attr.value === null ? 'true' : attr.value;
        attrQuotes[attr.name] = attr.quote;
      }
      const isVoid = voidTags.has(tagName.toLowerCase());
      const node = new HTMLNode('element', tagName, attrs, token.selfClosing || isVoid);
      node.attrQuotes = attrQuotes;
      // The text between the tag name and the tag's end, verbatim.
      //
      // A directive header is not attribute syntax: `<@for item in
      // items.filter(i => i.n > 2)>` has one header expression, not four
      // valueless attributes. `attrs` is still produced for every tag so
      // ordinary elements are unaffected, but a directive parser needs the
      // source it was written in, and reconstructing it from `attrs` is
      // lossy. Keeping it here means exactly one scan decides where a tag
      // ends, and everything downstream agrees with that decision.
      node.rawAttrs = source.slice(token.nameEnd, token.attrEnd).trim();
      Object.assign(node, position(token.start));

      // Implied end tag. `<@elseif>` and `<@else>` continue the chain
      // rather than nesting inside the arm before them, exactly as `<li>`
      // ends the previous `<li>`. Without this the arms parse as a ladder
      // three levels deep and every consumer has to un-nest it again.
      if (IF_CONTINUATION_TAGS.has(tagName.toLowerCase())) {
        if (stack.length > 1 && IF_CHAIN_TAGS.has(stack[stack.length - 1].tagName.toLowerCase())) {
          stack.pop();
        }
      }

      stack[stack.length - 1].children.push(node);
      if (!token.selfClosing && !isVoid) {
        stack.push(node);
      }
      index++;
      continue;
    }

    // Text: a run of text and interpolation tokens, plus an unterminated tag,
    // which has always been read as text.
    const runStart = token.start;
    let runEnd = token.end;
    index++;
    while (index < tokens.length && (tokens[index].type === 'text' || tokens[index].type === 'interpolation')) {
      runEnd = tokens[index].end;
      index++;
    }
    appendText(stack[stack.length - 1], source.slice(runStart, runEnd), position(runStart));
  }

  return root.children;
}

/**
 * Appends a run of template text to a parent, as static and dynamic parts.
 *
 * Static text merges into a preceding static text node; each interpolation is
 * its own node, which is the shape every consumer of the tree expects.
 * @param {HTMLNode} parentNode - The node receiving the text.
 * @param {string} text - The text, possibly containing interpolations.
 * @param {{line: number, column: number}} pos - Where the text starts.
 */
function appendText(parentNode, text, pos) {
  if (!text) return;
  const parts = text.split(/(\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g);
  for (const part of parts) {
    if (!part) continue;
    const isDynamic = part.includes('{{') || part.includes('{%');
    const lastChild = parentNode.children[parentNode.children.length - 1];
    if (
      lastChild &&
      lastChild.type === 'text' &&
      !isDynamic &&
      !(lastChild.content.includes('{{') || lastChild.content.includes('{%'))
    ) {
      lastChild.content += part;
    } else {
      const textNode = new HTMLNode('text');
      textNode.content = part;
      textNode.line = pos.line;
      textNode.column = pos.column;
      parentNode.children.push(textNode);
    }
  }
}

/**
 * Returns a function mapping offsets to 1-based lines and columns.
 *
 * Offsets are requested in increasing order during a parse, so the reader
 * advances a cursor instead of rescanning the source for every node.
 * @param {string} source - The template source.
 * @returns {function(number): {line: number, column: number}} The reader.
 */
function createPositionReader(source) {
  let offset = 0;
  let line = 1;
  let lastNewline = -1;
  return (target) => {
    if (target < offset) {
      offset = 0;
      line = 1;
      lastNewline = -1;
    }
    for (; offset < target && offset < source.length; offset++) {
      if (source[offset] === '\n') {
        line++;
        lastNewline = offset;
      }
    }
    return { line, column: target - lastNewline };
  };
}

/**
 * Serializes an HTMLNode tree back to an HTML string.
 * @param {HTMLNode[]} nodes
 * @param {string[]} [customVoidTags] - Additional project-specific void tag
 *   names (lowercase), loaded from `avenx.config.json`. Should match what
 *   was passed to {@link parseHTML} for the same template so a custom void
 *   tag round-trips consistently.
 * @returns {string}
 */
export function serializeHTML(nodes, customVoidTags = []) {
  let result = '';
  const voidTags = buildVoidTagsSet(customVoidTags);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'text') {
      result += node.content;
    } else if (node.type === 'comment') {
      result += `<!--${node.content}-->`;
    } else if (node.type === 'element') {
      let attrsStr = '';
      // A directive header is an expression, and the attribute map is a lossy
      // reading of it: `item in items` parses as three valueless attributes and
      // serialises back as `item="true" in="true" items="true"`, which is not
      // the same template. Writing the header source back verbatim is what
      // makes `serializeHTML(parseHTML(x))` round-trip a directive, which the
      // static-subtree pass relies on before the IR is built.
      if (node.tagName.startsWith('@') && node.rawAttrs) {
        attrsStr = ` ${node.rawAttrs}`;
      } else {
        const quotes = node.attrQuotes || {};
        for (const [name, val] of Object.entries(node.attrs)) {
          if (val === null || val === undefined) {
            attrsStr += ` ${name}`;
            continue;
          }
          const value = String(val);
          // A parsed attribute is written back with the quote it was written
          // with, whenever the value does not contain that quote. Everything
          // else -- attributes a compiler pass created, or values that contain
          // their own quote -- keeps the historical double-quoted, escaped form.
          if (quotes[name] === "'" && !value.includes("'")) {
            attrsStr += ` ${name}='${value}'`;
          } else {
            attrsStr += ` ${name}="${value.replace(/"/g, '&quot;')}"`;
          }
        }
      }
      const lowerTag = node.tagName.toLowerCase();
      if (IF_CHAIN_TAGS.has(lowerTag)) {
        const nextNode = nodes[i + 1];
        const nextTag = nextNode && nextNode.type === 'element' ? nextNode.tagName.toLowerCase() : '';
        if (IF_CONTINUATION_TAGS.has(nextTag)) {
          result += `<${node.tagName}${attrsStr}>${serializeHTML(node.children, customVoidTags)}`;
        } else {
          result += `<${node.tagName}${attrsStr}>${serializeHTML(node.children, customVoidTags)}</@if>`;
        }
      } else if (voidTags.has(lowerTag) || node.isSelfClosing) {
        result += `<${node.tagName}${attrsStr} />`;
      } else {
        result += `<${node.tagName}${attrsStr}>${serializeHTML(node.children, customVoidTags)}</${node.tagName}>`;
      }
    }
  }
  return result;
}
