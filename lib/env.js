import fs from 'fs';
import path from 'path';

/**
 * Parses the content of a .env file and returns an object of key-value pairs.
 * Matches dotenv behavior including single/double quotes and inline comments.
 * @param {string|Buffer} src
 * @returns {Object}
 */
export function parseEnv(src) {
  const obj = {};
  // Match standard env entries: KEY = VAL
  const regex = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s*)\s*(?:("|')((?:\\\2|.)*?)\2|([^#\r\n]+?))?\s*(?:#.*)?$/;
  const lines = src.toString().split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const key = match[1];
      let val = '';
      if (match[2]) {
        // Quoted value
        val = match[3];
        if (match[2] === '"') {
          val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        }
        // Unescape escaped quote character
        val = val.replace(new RegExp(`\\\\${match[2]}`, 'g'), match[2]);
      } else if (match[4]) {
        // Unquoted value
        val = match[4].trim();
      }
      obj[key] = val;
    }
  }
  return obj;
}

/**
 * Loads environment variables from the `.env` file in rootDir into process.env.
 * Does not overwrite existing environment variables.
 * @param {string} rootDir
 */
export function loadEnv(rootDir) {
  if (!rootDir) return;
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const parsed = parseEnv(content);
    for (const key of Object.keys(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = parsed[key];
      }
    }
  } catch {
    // Fail silently if reading fails
  }
}

/**
 * Replaces process.env.AVX_PUBLIC_... occurrences in the content
 * with their stringified values from process.env.
 * @param {string} content
 * @returns {string}
 */
export function replaceEnvVariables(content) {
  if (!content) return content;
  return content.replace(/process\.env\.AVX_PUBLIC_([a-zA-Z0-9_]+)/g, (match, key) => {
    const fullKey = 'AVX_PUBLIC_' + key;
    const val = process.env[fullKey];
    return val !== undefined ? JSON.stringify(val) : 'undefined';
  });
}
