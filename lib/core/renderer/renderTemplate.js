import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { HtmlEscaper, SafeHtml } from '../security/escapeHtml.js';
import { logger } from '../runtime/AvenxLogger.js';

const escaper = new HtmlEscaper();

/**
 * Handles the rendering of HTML templates by resolving interpolation expressions.
 */
export class TemplateRenderer {
  /**
   * Renders the template by replacing {{ expression }} and {{{ expression }}} with evaluated values.
   * @param {string} template - The HTML template string.
   * @param {function(string): any} resolveExpression - Function to evaluate expressions.
   * @returns {string} The rendered HTML string.
   */
  render(template, resolveExpression) {
    return template.replace(/\{\{\{\s*(.*?)\s*\}\}\}|\{\{\s*(.*?)\s*\}\}/g, (match, gp1, gp2) => {
      const isRaw = gp1 !== undefined;
      const expression = isRaw ? gp1 : gp2;
      try {
        const value = resolveExpression(expression);
        if (value == null) {
          return '';
        }
        if (isRaw || value instanceof SafeHtml) {
          return String(value);
        }
        return escaper.escape(value);
      } catch (error) {
        if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
          throw error;
        }
        logger.warn(formatMessage(AvenxErrorCodes.TEMPLATE_RENDER_ERROR, expression, error));
        return '';
      }
    });
  }
}
