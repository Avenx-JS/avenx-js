import { CompilerError } from './CompilerError.js';

/**
 * Specialized error class for CSS processing and preprocessor errors or warnings.
 * @augments CompilerError
 */
export class StyleCompilerError extends CompilerError {
  /**
   * Creates an instance of StyleCompilerError.
   * @param {string} code - The style compiler error or warning code.
   * @param {...any} args - Arguments to format within the template message.
   */
  constructor(code, ...args) {
    super(code, ...args);
    /**
     * Custom name identifier for style compiler errors.
     * @type {string}
     */
    this.name = 'StyleCompilerError';
  }
}
