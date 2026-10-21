import fs from 'fs';
import path from 'path';
import { getClosestKey } from './config.js';
import { AvenxErrorCodes } from './core/runtime/AvenxError.js';
import { BuildError } from './compiler/errors/BuildError.js';
import { reportWarning } from './compiler/utils/warningReporter.js';

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
 * Replaces process.env.AVX_PUBLIC_... and process.env['AVX_PUBLIC_...']
 * occurrences in the content with their stringified values from process.env.
 *
 * A reference to a variable that has no value is inlined as `undefined`. When
 * `file` is given, each such variable is reported once as AVX_W60, naming the
 * file, because a misspelled name or a missing `.env` entry in CI otherwise
 * builds cleanly and fails only at runtime. Callers that re-read a file the
 * build already processed (a cache key, the Atlas model) omit `file`, so the
 * same reference is not reported twice.
 * @param {string} content
 * @param {string} [file] - The file the content came from, as it should appear in the warning.
 * @param {object} [config] - The application configuration, for `warnings` overrides.
 * @returns {string}
 */
export function replaceEnvVariables(content, file, config) {
  if (!content) return content;
  const unset = new Set();
  const replaced = content.replace(
    /process\.env\.AVX_PUBLIC_([a-zA-Z0-9_]+)|process\.env\[\s*(['"])AVX_PUBLIC_([a-zA-Z0-9_]+)\2\s*\]/g,
    (match, dottedKey, quote, bracketKey) => {
      const key = dottedKey || bracketKey;
      const fullKey = 'AVX_PUBLIC_' + key;
      const val = process.env[fullKey];
      if (val === undefined) unset.add(fullKey);
      return val !== undefined ? JSON.stringify(val) : 'undefined';
    },
  );

  if (file) {
    const known = Object.keys(process.env).filter((key) => key.startsWith('AVX_PUBLIC_'));
    for (const name of unset) {
      const closest = getClosestKey(name, known);
      reportWarning(
        AvenxErrorCodes.COMPILER_UNDEFINED_PUBLIC_ENV,
        new BuildError(
          AvenxErrorCodes.COMPILER_UNDEFINED_PUBLIC_ENV,
          name,
          file,
          closest ? ` Did you mean "${closest}"?` : '',
        ),
        config,
      );
    }
  }

  return replaced;
}
