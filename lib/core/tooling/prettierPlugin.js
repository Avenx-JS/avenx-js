import * as prettier from 'prettier';
import * as prettierHtml from 'prettier/plugins/html';

const AVENX_TAG_PREFIX = 'avenx-';
const AVENX_TAGS = ['css', 'global', 'if', 'elseif', 'else', 'for', 'defer', 'suspense', 'errorBoundary', 'deadlock', 'fallback', 'empty'];
const AVENX_CSS_BLOCK_PATTERN = /<@(global|css)\s*>([\s\S]*?)<\/\s*@\1\s*>/g;

/**
 * Encodes Avenx-specific template syntax into HTML-compatible syntax.
 * @param {string} text - The Avenx template source.
 * @returns {string} HTML-compatible source.
 */
function encodeAvenxSyntax(text) {
  let encoded = text;

  for (const tag of AVENX_TAGS) {
    encoded = encoded
      .replaceAll(`<@${tag}`, `<${AVENX_TAG_PREFIX}${tag}`)
      .replace(new RegExp(`</@${tag}\\s*>`, 'g'), `</${AVENX_TAG_PREFIX}${tag}>`);
  }

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
      if (attribute?.name === 'data-avenx-css') {
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
