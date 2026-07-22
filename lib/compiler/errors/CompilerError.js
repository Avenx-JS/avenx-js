import { AvenxError } from '../../core/runtime/AvenxError.js';

/**
 * Base error class for all compiler-related errors and warnings in Avenx-JS.
 * Subclasses AvenxError to maintain compatibility with standard error handling.
 * @augments AvenxError
 */
export class CompilerError extends AvenxError {
  /**
   * Creates an instance of CompilerError.
   * @param {string} code - The AvenxErrorCode identifier.
   * @param {...any} args - Arguments to format within the template message.
   */
  constructor(code, ...args) {
    super(code, ...args);
    /**
     * Custom name identifier for compiler errors.
     * @type {string}
     */
    this.name = 'CompilerError';
  }
}
