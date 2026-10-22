import * as prettier from 'prettier';
import * as prettierHtml from 'prettier/plugins/html';
import { tokenizeMarkup } from '../utils/markupLexer.js';

const AVENX_TAG_PREFIX = 'avenx-';
const AVENX_TAGS = [
  'css',
  'global',
  'if',
  'elseif',
  'elif',
  'else',
  'for',
  'defer',
  'suspense',
  'errorBoundary',
  'deadlock',
  'fallback',
  'empty',
];
const AVENX_TAG_SET = new Set(AVENX_TAGS);
const IF_CONTINUATION_TAGS = new Set(['elseif', 'elif', 'else']);
// The `@empty` arm of a `@for` loop has no closing form either, so a loop
// that contains one is preserved verbatim like an `<@if>` chain with
// continuation arms.
const FOR_CONTINUATION_TAGS = new Set(['empty']);
const DIRECTIVE_HDR_TAGS = new Set(['if', 'elseif', 'elif', 'for']);
const AVENX_HDR_ATTR = 'data-avenx-hdr';
const AVENX_PASSTHROUGH_PREFIX = 'avenx-passthrough:';
const AVENX_CSS_BLOCK_PATTERN = /<@(global|css)\s*>([\s\S]*?)<\/\s*@\1\s*>/g;

/**
 * Escapes a directive header for a double-quoted HTML attribute value.
 * @param {string} header - The raw directive header.
 * @returns {string} Attribute-safe text.
 */
function escapeHdrAttr(header) {
  return header.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Finds `<@if>` chains and `<@for>` loops that contain continuation arms.
 *
 * Continuation tags (`<@elseif>`, `<@elif>`, `<@else>`, and `<@empty>`
 * inside a `@for`) have no closing form, so Prettier's HTML parser cannot
 * accept a faithful encoding of the construct. Those spans are preserved
 * verbatim via passthrough comments instead.
 * @param {string} text - The Avenx template source.
 * @param {import('../utils/markupLexer.js').MarkupToken[]} tokens - Lexer tokens.
 * @returns {Array<{start: number, end: number}>} Inclusive source ranges to preserve.
 */
function findIfChainsWithContinuations(text, tokens) {
  const ranges = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isIf = token.type === 'open' && token.directive && token.name === '@if';
    const isFor = token.type === 'open' && token.directive && token.name === '@for';
    if (!isIf && !isFor) {
      continue;
    }
    const continuations = isIf ? IF_CONTINUATION_TAGS : FOR_CONTINUATION_TAGS;

    let depth = 1;
    let hasContinuation = false;
    let end = -1;

    for (let j = i + 1; j < tokens.length; j++) {
      const next = tokens[j];
      if (next.type === 'open' && next.directive && next.name === '@if') {
        depth += 1;
        continue;
      }

      if (next.type === 'open' && next.directive && next.name === '@for') {
        depth += 1;
        continue;
      }

      if (next.type === 'open' && next.directive && continuations.has(next.name.slice(1))) {
        if (depth === 1) {
          hasContinuation = true;
        }
        continue;
      }

      if (next.type === 'close' && (next.name === '@if' || next.name === '@for')) {
        depth -= 1;
        if (depth === 0 && next.name === (isIf ? '@if' : '@for')) {
          end = next.end;
          break;
        }
        if (depth === 0) {
          // Mismatched nesting cannot occur in well-formed source; bail on it
          // rather than silently preserving a wrong span.
          break;
        }
      }
    }

    if (hasContinuation && end !== -1) {
      ranges.push({ start: token.start, end });
      // Skip tokens inside this construct; nested ones are preserved with the outer span.
      while (i + 1 < tokens.length && tokens[i + 1].start < end) {
        i += 1;
      }
    }
  }

  return ranges;
}

/**
 * Encodes Avenx-specific template syntax into HTML-compatible syntax.
 *
 * `<@elseif>` / `<@elif>` / `<@else>` continue an `<@if>` chain and have no
 * closing form. Chains that use those arms are wrapped in a passthrough
 * comment so Prettier does not need a well-formed HTML tree for them.
 * Headers that contain `>` (for example `<@if (n > 0)>`) are moved into
 * `data-avenx-hdr` so the comparison is not read as the end of the tag.
 * @param {string} text - The Avenx template source.
 * @returns {string} HTML-compatible source.
 */
function encodeAvenxSyntax(text) {
  const tokens = tokenizeMarkup(text);
  const passthroughRanges = findIfChainsWithContinuations(text, tokens);
  const parts = [];
  let copyFrom = 0;
  let rangeIndex = 0;

  const emitThrough = (until) => {
    if (until > copyFrom) {
      parts.push(text.slice(copyFrom, until));
    }
    copyFrom = until;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    while (rangeIndex < passthroughRanges.length && passthroughRanges[rangeIndex].end <= copyFrom) {
      rangeIndex += 1;
    }

    const range = passthroughRanges[rangeIndex];
    if (range && token.start >= range.start && token.start < range.end) {
      emitThrough(range.start);
      const original = text.slice(range.start, range.end);
      parts.push(`<!--${AVENX_PASSTHROUGH_PREFIX}${Buffer.from(original, 'utf8').toString('base64')}-->`);
      copyFrom = range.end;
      while (i + 1 < tokens.length && tokens[i + 1].start < range.end) {
        i += 1;
      }
      rangeIndex += 1;
      continue;
    }

    if (token.type === 'open' && token.directive) {
      const tag = token.name.slice(1);
      if (!AVENX_TAG_SET.has(tag)) {
        continue;
      }

      const header = text.slice(token.nameEnd, token.attrEnd).trim();

      if (DIRECTIVE_HDR_TAGS.has(tag) && header.includes('>')) {
        emitThrough(token.start);
        const selfClose = token.selfClosing ? ' /' : '';
        parts.push(`<${AVENX_TAG_PREFIX}${tag} ${AVENX_HDR_ATTR}="${escapeHdrAttr(header)}"${selfClose}>`);
        copyFrom = token.end;
        continue;
      }

      emitThrough(token.start);
      parts.push(`<${AVENX_TAG_PREFIX}${tag}${text.slice(token.nameEnd, token.end)}`);
      copyFrom = token.end;
      continue;
    }

    // Close tokens do not set `directive`; the leading `@` on the name is the signal.
    if (token.type === 'close' && token.name?.[0] === '@') {
      const tag = token.name.slice(1);
      if (!AVENX_TAG_SET.has(tag)) {
        continue;
      }

      emitThrough(token.start);
      parts.push(`</${AVENX_TAG_PREFIX}${tag}>`);
      copyFrom = token.end;
    }
  }

  emitThrough(text.length);

  let encoded = parts.join('');
  encoded = encoded.replaceAll('@css', 'data-avenx-css');
  encoded = encoded.replaceAll('@click', 'data-avenx-click');
  return encoded;
}

/**
 * Restores Avenx-specific syntax in a parsed HTML AST.
 * @param {object} node - The AST node to restore.
 * @returns {void}
 */
function restoreAvenxNode(node) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (typeof node.name === 'string' && node.name.startsWith(AVENX_TAG_PREFIX)) {
    node.name = `@${node.name.slice(AVENX_TAG_PREFIX.length)}`;
  }

  if (Array.isArray(node.attrs)) {
    for (const attribute of node.attrs) {
      if (attribute?.name === AVENX_HDR_ATTR) {
        // Print the header as a raw directive suffix: `<@if (n > 0)>`.
        attribute.name = attribute.value;
        attribute.value = null;
      } else if (attribute?.name === 'data-avenx-css') {
        attribute.name = '@css';
      } else if (attribute?.name === 'data-avenx-click') {
        attribute.name = '@click';
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach(restoreAvenxNode);
      } else {
        restoreAvenxNode(value);
      }
    }
  }
}

/**
 * Prints a preserved if-chain comment back to its original Avenx source.
 * @param {object} node - A Prettier HTML comment node.
 * @returns {string|undefined} The original chain source, or undefined when unrelated.
 */
function printPassthroughComment(node) {
  const value = String(node.value ?? '');
  if (!value.startsWith(AVENX_PASSTHROUGH_PREFIX)) {
    return undefined;
  }

  try {
    return Buffer.from(value.slice(AVENX_PASSTHROUGH_PREFIX.length), 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

/**
 * Parses an Avenx CSS stylesheet into formatter-friendly sections.
 * @param {string} text - The Avenx CSS source.
 * @returns {object} Parsed Avenx CSS AST.
 */
function parseAvenxCss(text) {
  const sections = [];
  let lastIndex = 0;

  for (const match of text.matchAll(AVENX_CSS_BLOCK_PATTERN)) {
    const start = match.index ?? 0;

    if (start > lastIndex) {
      sections.push({
        type: 'raw',
        value: text.slice(lastIndex, start),
      });
    }

    sections.push({
      type: 'block',
      name: match[1],
      content: match[2],
    });

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    sections.push({
      type: 'raw',
      value: text.slice(lastIndex),
    });
  }

  return {
    type: 'avenx-css-root',
    sections,
    source: text,
    range: [0, text.length],
  };
}

/**
 * Creates a Prettier document for an Avenx CSS stylesheet.
 * @param {object} path - Prettier AST path.
 * @param {object} options - Prettier options.
 * @returns {Function|undefined} Embedded document formatter.
 */
function embedAvenxCss(path, options) {
  if (path.node.type !== 'avenx-css-root') {
    return undefined;
  }

  return async (textToDoc) => {
    const { hardline, indent } = prettier.doc.builders;
    const docs = [];

    for (const section of path.node.sections) {
      if (section.type === 'raw') {
        if (section.value.trim()) {
          const rawDoc = await textToDoc(section.value.trim(), {
            ...options,
            parser: 'css',
          });

          docs.push(rawDoc, hardline);
        }

        continue;
      }

      const cssDoc = await textToDoc(section.content.trim(), {
        ...options,
        parser: 'css',
      });

      docs.push(
        `<@${section.name}>`,
        indent([hardline, cssDoc]),
        hardline,
        `</@${section.name}>`,
        hardline,
        hardline
      );
    }

    return docs;
  };
}

const htmlParser = prettierHtml.parsers.html;
const htmlPrinter = prettierHtml.printers.html;

export const languages = [
  {
    name: 'Avenx Template',
    parsers: ['avenx-template'],
    extensions: ['.component.js', '.page.js'],
    filenames: [],
  },
  {
    name: 'Avenx CSS',
    parsers: ['avenx-css'],
    extensions: ['.component.css', '.page.css'],
    filenames: [],
  },
];

export const parsers = {
  'avenx-template': {
    ...htmlParser,

    /**
     * Parses an Avenx template using Prettier's HTML parser.
     * @param {string} text - The Avenx template source.
     * @param {object} options - Prettier parser options.
     * @returns {object} Parsed HTML AST.
     */
    parse(text, options) {
      return htmlParser.parse(encodeAvenxSyntax(text), options);
    },

    astFormat: 'html',
  },

  'avenx-css': {
    parse: parseAvenxCss,
    astFormat: 'avenx-css',
    locStart: (node) => node.range[0],
    locEnd: (node) => node.range[1],
  },
};

export const printers = {
  html: {
    ...htmlPrinter,

    /**
     * Chains the HTML printer's own preprocess, then restores Avenx syntax.
     * Skipping the original leaves the printer reading normalisation flags
     * that were never set, which crashes on any node with a child.
     * @param {object} ast - The parsed template AST.
     * @param {object} options - Prettier options.
     * @returns {object} Normalised, restored Avenx AST.
     */
    preprocess(ast, options) {
      const processed =
        typeof htmlPrinter.preprocess === 'function' ? htmlPrinter.preprocess(ast, options) : ast;
      restoreAvenxNode(processed);
      return processed;
    },

    /**
     * Restores passthrough if-chain comments to their original Avenx source.
     * @param {object} path - Prettier AST path.
     * @param {object} options - Prettier options.
     * @param {Function} print - Child printer.
     * @returns {unknown} Printed document.
     */
    print(path, options, print) {
      const passthrough = printPassthroughComment(path.node);
      if (passthrough !== undefined) {
        return passthrough;
      }

      return htmlPrinter.print(path, options, print);
    },
  },

  'avenx-css': {
    /**
     * Embeds standard CSS formatting inside Avenx CSS blocks.
     * @param {object} path - Prettier AST path.
     * @param {object} options - Prettier options.
     * @returns {Function|undefined} Embedded document formatter.
     */
    embed(path, options) {
      return embedAvenxCss(path, options);
    },

    /**
     * Prevents Prettier from traversing the custom Avenx CSS AST.
     * @returns {string[]} No traversable child nodes.
     */
    getVisitorKeys() {
      return [];
    },

    /**
     * Handles the root Avenx CSS node when embedding is unavailable.
     * @param {object} path - Prettier AST path.
     * @returns {string} Original source.
     */
    print(path) {
      return path.node.source;
    },
  },
};

export default {
  languages,
  parsers,
  printers,
};
