/**
 * Provides utility for escaping HTML characters to prevent XSS.
 */
export class HtmlEscaper {
  /**
   * Escapes special HTML characters in a string.
   * @param {any} value - The value to escape.
   * @returns {string} The escaped string.
   */
  escape(value) {
    // Explicitly return an empty string for null or undefined
    if (value === null || value === undefined) {
      return '';
    }

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Unescapes HTML entities in a string back to original characters.
   * @param {any} value - The value to unescape.
   * @returns {string} The unescaped string.
   */
  unescape(value) {
    return unescapeHtml(value);
  }
}

/**
 * Reverses HTML entity encoding for strings containing entities like &amp;, &lt;, &gt;, &quot;, and &#39;.
 * @param {any} value - The value to unescape.
 * @returns {string} The unescaped string.
 */
export function unescapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * A wrapper class to designate that a string is safe HTML and should not be escaped.
 */
export class SafeHtml {
  /**
   * @param {any} value
   */
  constructor(value) {
    this.value = String(value);
    this.__isSafeHtml = true;
  }

  /**
   * @returns {string}
   */
  toString() {
    return this.value;
  }

  /**
   * @param {any} instance
   * @returns {boolean}
   */
  static [Symbol.hasInstance](instance) {
    return Boolean(
      instance &&
      typeof instance === 'object' &&
      (instance.__isSafeHtml === true ||
        instance.constructor === SafeHtml ||
        instance.constructor?.name === 'SafeHtml')
    );
  }
}

/**
 * Creates a SafeHtml wrapper for raw HTML insertion.
 * Can be used as a standard function: html('<p>unsafe</p>')
 * or as a tagged template literal: html`<p>${unsafe}</p>`
 * @param {string|TemplateStringsArray} strings
 * @param {...any} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  if (Array.isArray(strings) && strings.raw) {
    const escaper = new HtmlEscaper();
    let result = '';
    for (let i = 0; i < strings.length; i++) {
      result += strings[i];
      if (i < values.length) {
        const val = values[i];
        if (val instanceof SafeHtml) {
          result += val.toString();
        } else if (val == null) {
          result += '';
        } else {
          result += escaper.escape(val);
        }
      }
    }
    return new SafeHtml(result);
  }
  return new SafeHtml(strings);
}
