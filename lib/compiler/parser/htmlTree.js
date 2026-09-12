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
  const directive = html[start + 1] === '@';
  let quote = null;
  let depth = 0;

  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];

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

    if (directive) {
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (depth > 0) depth--;
        continue;
      }
      // `=>` is an arrow, not a comparison that could be a tag end.
      if (ch === '=' && html[i + 1] === '>') {
        i++;
        continue;
      }
      if (ch === '>' && depth > 0) {
        continue;
      }
    }

    if (ch === '>') {
      return i;
    }
  }

  return -1;
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
  let i = 0;

  const voidTags = buildVoidTagsSet(customVoidTags);

  while (i < html.length) {
    // 1. Check for comment
    if (html.startsWith('<!--', i)) {
      const pos = getLineAndColumn(html, i);
      const endIdx = html.indexOf('-->', i + 4);
      if (endIdx === -1) {
        const node = new HTMLNode('comment');
        node.content = html.substring(i + 4);
        node.line = pos.line;
        node.column = pos.column;
        stack[stack.length - 1].children.push(node);
        break;
      } else {
        const node = new HTMLNode('comment');
        node.content = html.substring(i + 4, endIdx);
        node.line = pos.line;
        node.column = pos.column;
        stack[stack.length - 1].children.push(node);
        i = endIdx + 3;
        continue;
      }
    }

    // 2. Check for closing tag
    if (html.startsWith('</', i)) {
      const pos = getLineAndColumn(html, i);
      const endIdx = html.indexOf('>', i + 2);
      if (endIdx === -1) {
        const textNode = new HTMLNode('text');
        textNode.content = html.substring(i);
        textNode.line = pos.line;
        textNode.column = pos.column;
        stack[stack.length - 1].children.push(textNode);
        break;
      } else {
        const rawTagName = html.substring(i + 2, endIdx).trim();
        const tagName = rawTagName.replace(/\s+/g, '');
        const wanted = tagName.toLowerCase();
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
        // If foundIdx === -1, silently skip unmatched closing tag
        // to maintain backward compatibility with permissive template transforms
        i = endIdx + 1;
        continue;
      }
    }

    // 3. Check for opening/self-closing tag
    if (html[i] === '<') {
      const pos = getLineAndColumn(html, i);
      const tagEndIdx = scanTagEnd(html, i);

      if (tagEndIdx !== -1) {
        const tagContent = html.substring(i + 1, tagEndIdx).trim();
        const isSelfClosing = tagContent.endsWith('/');
        const cleanContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;

        const spaceIdx = cleanContent.search(/\s/);
        const tagName = spaceIdx === -1 ? cleanContent : cleanContent.substring(0, spaceIdx);
        const attrsStr = spaceIdx === -1 ? '' : cleanContent.substring(spaceIdx).trim();

        if (/^[a-zA-Z0-9@:._-]+$/.test(tagName)) {
          const attrs = parseAttributes(attrsStr);
          const isVoid = voidTags.has(tagName.toLowerCase());
          const node = new HTMLNode('element', tagName, attrs, isSelfClosing || isVoid);
          // The text between the tag name and the tag's end, verbatim.
          //
          // A directive header is not attribute syntax: `<@for item in
          // items.filter(i => i.n > 2)>` has one header expression, not four
          // valueless attributes. `attrs` is still produced for every tag so
          // ordinary elements are unaffected, but a directive parser needs the
          // source it was written in, and reconstructing it from `attrs` is
          // lossy. Keeping it here means exactly one scan decides where a tag
          // ends, and everything downstream agrees with that decision.
          node.rawAttrs = attrsStr;
          node.line = pos.line;
          node.column = pos.column;

          // Implied end tag. `<@elseif>` and `<@else>` continue the chain
          // rather than nesting inside the arm before them, exactly as `<li>`
          // ends the previous `<li>`. Without this the arms parse as a ladder
          // three levels deep and every consumer has to un-nest it again.
          if (IF_CONTINUATION_TAGS.has(tagName.toLowerCase())) {
            while (
              stack.length > 1 &&
              IF_CHAIN_TAGS.has(stack[stack.length - 1].tagName.toLowerCase())
            ) {
              stack.pop();
            }
          }

          stack[stack.length - 1].children.push(node);

          if (!isSelfClosing && !isVoid) {
            stack.push(node);
          }
          i = tagEndIdx + 1;
          continue;
        }
      }
    }

    // 4. Text node
    const textPos = getLineAndColumn(html, i);
    let nextTagIdx = html.indexOf('<', i + 1);
    if (nextTagIdx === -1) {
      nextTagIdx = html.length;
    }
    const text = html.substring(i, nextTagIdx);
    if (text) {
      const parentNode = stack[stack.length - 1];
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
          textNode.line = textPos.line;
          textNode.column = textPos.column;
          parentNode.children.push(textNode);
        }
      }
    }
    i = nextTagIdx;
  }

  return root.children;
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
  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.content;
    } else if (node.type === 'comment') {
      result += `<!--${node.content}-->`;
    } else if (node.type === 'element') {
      let attrsStr = '';
      for (const [name, val] of Object.entries(node.attrs)) {
        if (val === null || val === undefined) {
          attrsStr += ` ${name}`;
        } else {
          const escapedVal = String(val).replace(/"/g, '&quot;');
          attrsStr += ` ${name}="${escapedVal}"`;
        }
      }
      if (voidTags.has(node.tagName.toLowerCase()) || node.isSelfClosing) {
        result += `<${node.tagName}${attrsStr} />`;
      } else {
        result += `<${node.tagName}${attrsStr}>${serializeHTML(node.children, customVoidTags)}</${node.tagName}>`;
      }
    }
  }
  return result;
}