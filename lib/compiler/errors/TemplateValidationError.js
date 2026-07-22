import { CompilerError } from './CompilerError.js';

/**
 * Specialized error class for template syntax, parsing, and static validation warnings or errors.
 * @augments CompilerError
 */
export class TemplateValidationError extends CompilerError {
  /**
   * Creates an instance of TemplateValidationError.
   * @param {string} code - The template error or warning code.
   * @param {...any} args - Arguments to format within the template message.
   */
  constructor(code, ...args) {
    super(code, ...args);
    /**
     * Custom name identifier for template validation errors.
     * @type {string}
     */
    this.name = 'TemplateValidationError';
  }
}
