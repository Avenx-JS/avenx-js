import { CompilerError } from './CompilerError.js';

/**
 * Specialized error class for build pipeline, directory, and compiler configuration errors.
 * @augments CompilerError
 */
export class BuildError extends CompilerError {
  /**
   * Creates an instance of BuildError.
   * @param {string} code - The build error or warning code.
   * @param {...any} args - Arguments to format within the template message.
   */
  constructor(code, ...args) {
    super(code, ...args);
    /**
     * Custom name identifier for build errors.
     * @type {string}
     */
    this.name = 'BuildError';
  }
}
