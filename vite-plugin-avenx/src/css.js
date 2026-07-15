import fs from 'node:fs';

/**
 * Loads and preprocesses an Avenx stylesheet.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
export function loadStyle(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs
    .readFileSync(filePath, 'utf8')
    .replace(/<@css>/g, '')
    .replace(/<\/@css>/g, '')
    .trim();
}