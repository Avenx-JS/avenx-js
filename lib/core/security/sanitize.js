import { logger } from '../runtime/AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
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
  logger.warn(formatMessage(AvenxErrorCodes.SECURITY_SANITIZED_TAG, tagName));
}

/**
 * Logs a warning for a sanitized HTML attribute.
 * @param {string} attributeName - The sanitized attribute name.
 * @returns {void}
 */
function warnSanitizedAttribute(attributeName) {
  logger.warn(formatMessage(AvenxErrorCodes.SECURITY_SANITIZED_ATTRIBUTE, attributeName));
}

/**
 * Validates whether a URL attribute contains safe content.
 * @param {string} url - The URL string.
 * @param {string} tagName - The name of the HTML tag containing the URL.
 * @param {boolean} [allowDataUrls] - Whether data: URLs are allowed for img tags.
 * @returns {boolean} True if the URL is safe.
 */
function isSafeUrl(url, tagName, allowDataUrls = true) {
  if (!url) return true;
  // Remove control characters and whitespace
  // eslint-disable-next-line no-control-regex
  const sanitizedUrl = url.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, '');

  if (INVALID_URL_PROTOCOL.test(sanitizedUrl)) {
    // Allow data:image/... on img tags if allowDataUrls is enabled
    if (allowDataUrls && tagName === 'img' && /^data:image\//i.test(sanitizedUrl)) {
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
 * Provides sanitization for values used in templates with configurable security policies.
 */
export class Sanitizer {
  /**
   * Constructs the Sanitizer with configuration options.
   * @param {object} [config] - Sanitization configuration policy.
   * @param {string[]|Set<string>} [config.allowedTags] - Array or Set of allowed tag names.
   * @param {string[]|Set<string>} [config.disallowedTags] - Array or Set of explicitly forbidden tag names.
   * @param {Record<string, string[]>} [config.allowedAttributes] - Map of tag names to allowed attribute lists.
   * @param {Record<string, string[]>|string[]} [config.disallowedAttributes] - Map or array of forbidden attributes.
   * @param {boolean} [config.stripComments] - Whether to strip HTML comment nodes.
   * @param {string[]|Set<string>} [config.stripContentTags] - Tags whose child content is discarded when stripped.
   * @param {boolean} [config.allowDataUrls] - Whether data: URLs are permitted for img tags.
   * @param {string[]} [config.voidTags] - Additional custom void tag names.
   */
  constructor(config = {}) {
    const options = config || {};

    // 1. Allowed / Disallowed Tags
    this.allowedTags = options.allowedTags
      ? new Set(Array.from(options.allowedTags).map((t) => String(t).toLowerCase()))
      : DEFAULT_ALLOWED_TAGS;

    this.disallowedTags = options.disallowedTags
      ? new Set(Array.from(options.disallowedTags).map((t) => String(t).toLowerCase()))
      : new Set();

    // 2. Allowed Attributes
    this.allowedAttributes = {};
    const attributesSource = options.allowedAttributes || DEFAULT_ALLOWED_ATTRIBUTES;
    for (const [tag, attrs] of Object.entries(attributesSource)) {
      if (Array.isArray(attrs)) {
        this.allowedAttributes[tag.toLowerCase()] = attrs.map((a) => String(a).toLowerCase());
      }
    }

    // 3. Disallowed Attributes (map or global array)
    this.disallowedAttributes = {};
    if (options.disallowedAttributes) {
      if (Array.isArray(options.disallowedAttributes)) {
        this.disallowedAttributes['*'] = options.disallowedAttributes.map((a) => String(a).toLowerCase());
      } else if (typeof options.disallowedAttributes === 'object') {
        for (const [tag, attrs] of Object.entries(options.disallowedAttributes)) {
          if (Array.isArray(attrs)) {
            this.disallowedAttributes[tag.toLowerCase()] = attrs.map((a) => String(a).toLowerCase());
          }
        }
      }
    }

    // 4. Strip Comments
    this.stripComments = options.stripComments !== undefined ? Boolean(options.stripComments) : true;

    // 5. Strip Content Tags
    this.stripContentTags = options.stripContentTags
      ? new Set(Array.from(options.stripContentTags).map((t) => String(t).toLowerCase()))
      : STRIP_CONTENT_TAGS;

    // 6. Allow Data URLs
    this.allowDataUrls = options.allowDataUrls !== undefined ? Boolean(options.allowDataUrls) : true;

    // 7. Void Elements
    this.voidElements = new Set([
      ...VOID_ELEMENTS,
      ...(options.voidTags ?? []).map((t) => String(t).toLowerCase()),
    ]);
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
      let result = htmlString;
      if (this.stripComments) {
        result = result.replace(/<!--[\s\S]*?-->/g, '');
      }
      return result.replace(/<\/?[^>]+(>|$)/g, (match) => {
        const tagMatch = match.match(/<\/?([a-zA-Z0-9:-]+)/);
        if (tagMatch) {
          warnSanitizedTag(tagMatch[1].toLowerCase());
        }
        return '';
      });
    }
  }

  /**
   * Sanitizes a URL string, returning `about:blank` for disallowed protocols.
   *
   * Protects applications that bind user-provided URLs to `href`/`src`
   * attributes from `javascript:` and other pseudo-protocol XSS vectors.
   * @param {string} url - The URL to sanitize.
   * @param {string[]} [allowedProtocols] - Allowed protocols (including the
   *   trailing colon). Defaults to `['http:', 'https:', 'mailto:', 'tel:']`.
   * @returns {string} The trimmed URL when its protocol is allowed, or
   *   `'about:blank'` for disallowed protocols and empty/whitespace input.
   */
  static sanitizeUrl(url, allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:']) {
    if (url == null) return 'about:blank';
    const value = String(url);
    const trimmed = value.trim();
    if (trimmed === '') return 'about:blank';

    // Strip control characters and whitespace before the scheme check so
    // obfuscated forms like "java\nscript:" cannot bypass it.
    // eslint-disable-next-line no-control-regex
    const cleaned = value.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, '');
    const schemeMatch = cleaned.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
      const scheme = `${schemeMatch[1].toLowerCase()}:`;
      const allowed = allowedProtocols.map((protocol) => String(protocol).toLowerCase());
      if (!allowed.includes(scheme)) {
        return 'about:blank';
      }
    }
    return trimmed;
  }

  /**
   * Strips all HTML markup, script/style element content, and HTML comments from a string, returning plain text.
   * @param {string} html - The HTML string from which to strip tags.
   * @returns {string} Plain text with all tags removed.
   */
  static stripTags(html) {
    if (html == null) return '';
    const str = String(html);
    return str
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<\/?[^>]+(>|$)/g, '');
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

      if (child.nodeType === 8) {
        // Comment node
        if (!this.stripComments) {
          result += `<!--${child.data || child.nodeValue || ''}-->`;
        }
      } else if (child.nodeType === 3) {
        // Text node
        const text = child.textContent !== undefined ? child.textContent : child.nodeValue || child.data || '';
        result += escapeText(text);
      } else if (child.nodeType === 1) {
        // Element node
        const tagName = child.tagName.toLowerCase();
        const isAllowed = this.allowedTags.has(tagName) && !this.disallowedTags.has(tagName);

        if (isAllowed) {
          const isVoid = this.voidElements.has(tagName);
          result += `<${tagName}`;

          // Process attributes
          const attrs = child.attributes || [];
          for (let j = 0; j < attrs.length; j++) {
            const attr = attrs[j];
            const attrName = attr.name;
            const attrValue = attr.value;
            const lowerAttrName = attrName.toLowerCase();

            // Check if attribute is explicitly disallowed
            const disallowedForTag = this.disallowedAttributes[tagName] || [];
            const globalDisallowed = this.disallowedAttributes['*'] || [];
            const isDisallowedAttr =
              disallowedForTag.includes(lowerAttrName) || globalDisallowed.includes(lowerAttrName);

            if (isDisallowedAttr) {
              warnSanitizedAttribute(lowerAttrName);
              continue;
            }

            // Check if attribute is allowed
            const allowedAttrsForTag = this.allowedAttributes[tagName] || [];
            const globalAllowedAttrs = this.allowedAttributes['*'] || [];
            const isAllowedAttr =
              allowedAttrsForTag.includes(lowerAttrName) || globalAllowedAttrs.includes(lowerAttrName);

            if (isAllowedAttr) {
              if (URL_ATTRIBUTES.has(lowerAttrName)) {
                if (!isSafeUrl(attrValue, tagName, this.allowDataUrls)) {
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
          warnSanitizedTag(tagName);

          if (!this.stripContentTags.has(tagName)) {
            result += this._sanitizeNode(child);
          }
        }
      }
    }

    return result;
  }
}
