import { runtimeImportStatement } from '../../../lib/compiler/codegen/expression.js';

/**
 * Builds the side-effect import that pulls a module's scoped stylesheet into
 * the graph, so Vite's CSS pipeline emits it the way the CLI build emits
 * bundle.css. Without it the compiler injects scope classes into the template
 * but the matching rules are never loaded.
 * @param {string|null} [stylePath] - Absolute path to the co-located stylesheet.
 * @returns {string} An import statement, or an empty string when there is none.
 */
function styleImport(stylePath) {
  if (!stylePath) return '';
  return `import ${JSON.stringify(stylePath)};\n`;
}

/**
 * Wraps a compiled Avenx component into a valid ES module.
 * @param {string} code
 * @param {string} className
 * @param {string|null} [stylePath] - Co-located stylesheet to import, if any.
 * @returns {string}
 */
export function wrapComponent(code, className, stylePath = null) {
  return `
${runtimeImportStatement('AvenxComponent', 'avenx-core/core')}
${styleImport(stylePath)}
${code}

export default ${className};
`;
}

/**
 * Wraps a compiled Avenx page into a valid ES module.
 * @param {string} code
 * @param {string} className
 * @param {string|null} [stylePath] - Co-located stylesheet to import, if any.
 * @returns {string}
 */
export function wrapPage(code, className, stylePath = null) {
  return `
${runtimeImportStatement('AvenxPage')}
${styleImport(stylePath)}
${code}

export default ${className};
`;
}
