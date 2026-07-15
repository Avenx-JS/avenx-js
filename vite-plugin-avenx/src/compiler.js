import path from 'node:path';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';

/**
 * Creates an Avenx compiler instance.
 * @returns {object} Compiler API.
 */
export function createCompiler() {
  const parser = new ComponentParser(new StyleProcessor());

  /**
   * Returns the generated class name from a component or page file.
   * @param {string} filePath Full path to the source file.
   * @param {string} suffix File suffix to remove.
   * @returns {string} Generated class name.
   */
  function getClassName(filePath, suffix) {
    return path
      .basename(filePath, suffix)
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  return {
    /**
     * Compiles an Avenx component.
     * @param {string} filePath Path to the component file.
     * @returns {{code: string, className: string}}
     */
    compileComponent(filePath) {
      const code = parser.parse(filePath);

      console.log('\n================ COMPILED COMPONENT ================\n');
      console.log(code);
      console.log('\n====================================================\n');

      const className = getClassName(filePath, '.component.js');

      return {
        code,
        className,
      };
    },

    /**
     * Compiles an Avenx page.
     * @param {string} filePath Path to the page file.
     * @returns {{code: string, className: string}}
     */
    compilePage(filePath) {
      const code = parser.parse(filePath, 'page');

      console.log('\n================ COMPILED PAGE =====================\n');
      console.log(code);
      console.log('\n====================================================\n');

      const className = getClassName(filePath, '.page.js');

      return {
        code,
        className,
      };
    },
  };
}