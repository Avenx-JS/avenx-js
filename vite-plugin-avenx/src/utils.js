import {
  COMPONENT_EXT,
  PAGE_EXT,
  COMPONENT_CSS_EXT,
  PAGE_CSS_EXT,
} from './constants.js';

/**
 * Returns true if the file is an Avenx component.
 * @param {string} file
 * @returns {boolean}
 */
export function isComponentFile(file) {
  return file.endsWith(COMPONENT_EXT);
}

/**
 * Returns true if the file is an Avenx page.
 * @param {string} file
 * @returns {boolean}
 */
export function isPageFile(file) {
  return file.endsWith(PAGE_EXT);
}

/**
 * Returns true if the file is an Avenx component stylesheet.
 * @param {string} file
 * @returns {boolean}
 */
export function isComponentStyle(file) {
  return file.endsWith(COMPONENT_CSS_EXT);
}

/**
 * Returns true if the file is an Avenx page stylesheet.
 * @param {string} file
 * @returns {boolean}
 */
export function isPageStyle(file) {
  return file.endsWith(PAGE_CSS_EXT);
}

/**
 * Returns true if the file is any Avenx source file.
 * @param {string} file
 * @returns {boolean}
 */
export function isAvenxFile(file) {
  return (
    isComponentFile(file) ||
    isPageFile(file) ||
    isComponentStyle(file) ||
    isPageStyle(file)
  );
}