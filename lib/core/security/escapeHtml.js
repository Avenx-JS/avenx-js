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
  }

  /**
   * @returns {string}
   */
  toString() {
    return this.value;
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
