/**
 * Wraps a compiled Avenx component into a valid ES module.
 * @param {string} code
 * @param {string} className
 * @returns {string}
 */
export function wrapComponent(code, className) {
  return `
import { AvenxComponent } from 'avenx-core/core';

${code}

export default ${className};
`;
}

/**
 * Wraps a compiled Avenx page into a valid ES module.
 * @param {string} code
 * @param {string} className
 * @returns {string}
 */
export function wrapPage(code, className) {
  return `
import { AvenxPage } from 'avenx-core/runtime';

${code}

export default ${className};
`;
}