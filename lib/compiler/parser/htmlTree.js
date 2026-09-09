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
        let foundIdx = -1;
        for (let j = stack.length - 1; j > 0; j--) {
          if (stack[j].tagName.toLowerCase() === tagName.toLowerCase()) {
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
      let tagEndIdx = -1;
      let inQuote = null;
      let tempIdx = i + 1;
      while (tempIdx < html.length) {
        const c = html[tempIdx];
        if (inQuote) {
          if (c === '\\') {
            tempIdx++;
          } else if (c === inQuote) {
            inQuote = null;
          }
        } else if (c === '"' || c === "'") {
          inQuote = c;
        } else if (c === '>') {
          tagEndIdx = tempIdx;
          break;
        }
        tempIdx++;
      }

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
          node.line = pos.line;
          node.column = pos.column;

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