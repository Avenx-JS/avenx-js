import { logger } from '../runtime/AvenxLogger.js';
/**
 * Logs a warning whenever elements have their content stripped.
 * @param {string} type - The type of warning ('tag' or 'attribute').
 * @param {string} value - The name of the tag or attribute.
 */
function warnSanitized(type, value) {
  if (type === 'tag') {
    console.warn(`[Avenx Security warning] Sanitized tag "<${value}>" when stripping content.`);
  } else if (type === 'attribute') {
    console.warn(`[Avenx Security warning] Sanitized attribute "${value}" when stripping content.`);
  }
}

/**
 * Safe allowed tags by default.
 */
const DEFAULT_ALLOWED_TAGS = new Set([
  'address',
  'article',
  'aside',
  'footer',
  'header',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hgroup',
  'main',
  'nav',
  'section',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'ul',
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'i',
  'kbd',
  'mark',
  'q',
  'rp',
  'rt',
  'rtc',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
  'del',
  'ins',
  'caption',
  'col',
  'colgroup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'img',
]);

/**
 * Safe allowed attributes by default.
 */
const DEFAULT_ALLOWED_ATTRIBUTES = {
  '*': ['class', 'id', 'title', 'lang', 'dir'],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  col: ['span', 'width'],
  colgroup: ['span', 'width'],
  td: ['colspan', 'rowspan', 'headers'],
  th: ['colspan', 'rowspan', 'headers', 'scope'],
};

/**
 * Void elements in HTML.
 */
const VOID_ELEMENTS = new Set([
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
  'source',
  'track',
  'wbr',
]);

/**
 * Elements whose content must be stripped completely if the element itself is not allowed.
 */
const STRIP_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'canvas',
  'video',
  'audio',
  'svg',
  'math',
]);

/**
 * Attributes that expect a URL value.
 */
const URL_ATTRIBUTES = new Set(['href', 'src', 'cite', 'poster', 'formaction']);

/**
 * Regex matching unsafe URL protocols.
 */
const INVALID_URL_PROTOCOL = /^(?:javascript|data|vbscript):/i;

/**
 * Logs a warning for a sanitized HTML tag.
 * @param {string} tagName - The sanitized tag name.
 * @returns {void}
 */
function warnSanitizedTag(tagName) {
  logger.warn(`[Avenx Security warning] Sanitized tag "<${tagName}>" when stripping content.`);
}

/**
 * Logs a warning for a sanitized HTML attribute.
 * @param {string} attributeName - The sanitized attribute name.
 * @returns {void}
 */
function warnSanitizedAttribute(attributeName) {
  logger.warn(`[Avenx Security warning] Sanitized attribute "${attributeName}" when stripping content.`);
}

/**
 * Validates whether a URL attribute contains safe content.
 * @param {string} url - The URL string.
 * @param {string} tagName - The name of the HTML tag containing the URL.
 * @returns {boolean} True if the URL is safe.
 */
function isSafeUrl(url, tagName) {
  if (!url) return true;
  // Remove control characters and whitespace
  // eslint-disable-next-line no-control-regex
  const sanitizedUrl = url.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, '');

  if (INVALID_URL_PROTOCOL.test(sanitizedUrl)) {
    // Allow data:image/... on img tags
    if (tagName === 'img' && /^data:image\//i.test(sanitizedUrl)) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Escapes special HTML characters in a text node value.
 * @param {string} str - The text to escape.
 * @returns {string} The escaped text.
 */
function escapeText(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes double quotes and special characters in an attribute value.
 * @param {string} str - The attribute value to escape.
 * @returns {string} The escaped attribute value.
 */
function escapeAttrValue(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Provides sanitization for values used in templates.
 */
export class Sanitizer {
  /**
   * Constructs the Sanitizer with configuration options.
   * @param {object} [config] - Sanitization configuration.
   * @param {string[]} [config.allowedTags] - Array of allowed tag names.
   * @param {Record<string, string[]>} [config.allowedAttributes] - Map of tag names to allowed attribute lists.
   */
  constructor(config = {}) {
    this.allowedTags = config.allowedTags
      ? new Set(config.allowedTags.map((t) => t.toLowerCase()))
      : DEFAULT_ALLOWED_TAGS;
    this.allowedAttributes = {};
    const attributesSource = config.allowedAttributes || DEFAULT_ALLOWED_ATTRIBUTES;
    for (const [tag, attrs] of Object.entries(attributesSource)) {
      this.allowedAttributes[tag.toLowerCase()] = attrs.map((a) => a.toLowerCase());
    }
  }

  /**
   * Sanitizes a value.
   * @param {any} value - The value to sanitize.
   * @returns {string} The sanitized string.
   */
  sanitize(value) {
    if (value == null) return '';
    const htmlString = String(value);

    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, 'text/html');
      return this._sanitizeNode(doc.body);
    } else if (
      typeof document !== 'undefined' &&
      document.implementation &&
      document.implementation.createHTMLDocument
    ) {
      const doc = document.implementation.createHTMLDocument('');
      doc.body.innerHTML = htmlString;
      return this._sanitizeNode(doc.body);
    } else {
      return htmlString.replace(/<\/?[^>]+(>|$)/g, (match) => {
        const tagMatch = match.match(/<\/?([a-zA-Z0-9:-]+)/);
        if (tagMatch) {
          warnSanitizedTag(tagMatch[1].toLowerCase());
        }
        return '';
      });
    }
  }

  /**
   * Recursively sanitizes a DOM node and returns the clean HTML string.
   * @param {any} node - The DOM node or mock DOM element to sanitize.
   * @returns {string} The sanitized inner HTML.
   * @private
   */
  _sanitizeNode(node) {
    let result = '';
    const childNodes = node.childNodes || [];

    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];

      if (child.nodeType === 3) {
        // Text node
        const text = child.textContent !== undefined ? child.textContent : child.nodeValue || child.data || '';
        result += escapeText(text);
      } else if (child.nodeType === 1) {
        // Element node
        const tagName = child.tagName.toLowerCase();

        if (this.allowedTags.has(tagName)) {
          const isVoid = VOID_ELEMENTS.has(tagName);
          result += `<${tagName}`;

          // Process attributes
          const attrs = child.attributes || [];
          for (let j = 0; j < attrs.length; j++) {
            const attr = attrs[j];
            const attrName = attr.name;
            const attrValue = attr.value;
            const lowerAttrName = attrName.toLowerCase();

            // Check if attribute is allowed
            const allowedAttrsForTag = this.allowedAttributes[tagName] || [];
            const globalAllowedAttrs = this.allowedAttributes['*'] || [];
            const isAllowed = allowedAttrsForTag.includes(lowerAttrName) || globalAllowedAttrs.includes(lowerAttrName);

            if (isAllowed) {
              if (URL_ATTRIBUTES.has(lowerAttrName)) {
                if (!isSafeUrl(attrValue, tagName)) {
                  continue; // Skip unsafe URL attributes
                }
              }
              result += ` ${lowerAttrName}="${escapeAttrValue(attrValue)}"`;
            } else {
              warnSanitizedAttribute(lowerAttrName);
            }
          }
          if (isVoid) {
            result += ' />';
          } else {
            result += '>';
            // Recursively sanitize children
            result += this._sanitizeNode(child);
            result += `</${tagName}>`;
          }
        } else {
          // Tag is not allowed.
          warnSanitized('tag', tagName);

          if (!STRIP_CONTENT_TAGS.has(tagName)) {
            result += this._sanitizeNode(child);
          }
        }
      }
    }

    return result;
  }
}
