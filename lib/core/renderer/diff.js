/**
 * Provides simple diffing logic for HTML content.
 */
export class HtmlDiff {
  /**
   * Compares two HTML strings and returns the next HTML if they differ.
   * @param {string} currentHtml - The current HTML content.
   * @param {string} nextHtml - The next HTML content.
   * @returns {string|null} The next HTML if it differs from current, otherwise null.
   */
  diff(currentHtml, nextHtml) {
    return currentHtml === nextHtml ? null : nextHtml;
  }
}
