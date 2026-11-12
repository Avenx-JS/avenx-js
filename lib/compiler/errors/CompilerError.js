import { AvenxError } from '../../core/runtime/AvenxError.js';
import { formatCodeFrame, getLineAndColumn } from '../../core/utils/codeFrame.js';

export { formatCodeFrame, getLineAndColumn };

/**
 * Base error class for all compiler-related errors and warnings in Avenx-JS.
 * Subclasses AvenxError to maintain compatibility with standard error handling.
 * @augments AvenxError
 */
export class CompilerError extends AvenxError {
  /**
   * Creates an instance of CompilerError.
   * @param {string} code - The AvenxErrorCode identifier.
   * @param {...any} args - Arguments to format within the template message, optionally ending with a location options object.
   */
  constructor(code, ...args) {
    let locOptions = null;
    let formatArgs = args;

    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      if (
        lastArg &&
        typeof lastArg === 'object' &&
        !Array.isArray(lastArg) &&
        !(lastArg instanceof Error) &&
        (lastArg.line !== undefined || lastArg.source !== undefined || lastArg.location !== undefined)
      ) {
        locOptions = lastArg.location || lastArg;
        formatArgs = args.slice(0, -1);
      }
    }

    super(code, ...formatArgs);
    /**
     * Custom name identifier for compiler errors.
     * @type {string}
     */
    this.name = 'CompilerError';

    if (locOptions) {
      this.setLocation(locOptions);
    }
  }

  /**
   * Attaches source location information and generates a code frame with carets (^).
   * @param {object} loc - Location options object containing { line, column, source, filename, index, length }.
   * @returns {CompilerError} Returns this error instance for chaining.
   */
  setLocation(loc = {}) {
    const { source, filename, index, length } = loc;
    let { line, column } = loc;

    if (source && index !== undefined && (!line || !column)) {
      const pos = getLineAndColumn(source, index);
      line = pos.line;
      column = pos.column;
    }

    this.line = line;
    this.column = column;
    this.source = source;
    if (filename) {
      this.filename = filename;
    }

    if (source && line && column) {
      this.frame = formatCodeFrame(source, line, column, { length });
      if (this.frame && !this.message.includes(this.frame)) {
        this.message += `\n\n${this.frame}`;
      }
    }

    return this;
  }

  /**
   * Helper static method to format code frames.
   * @param {string} source
   * @param {number} line
   * @param {number} column
   * @param {object} [options]
   * @returns {string}
   */
  static formatCodeFrame(source, line, column, options) {
    return formatCodeFrame(source, line, column, options);
  }

  /**
   * Helper static method to compute line and column coordinates.
   * @param {string} source
   * @param {number} index
   * @returns {{ line: number, column: number }}
   */
  static getLineAndColumn(source, index) {
    return getLineAndColumn(source, index);
  }
}

