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
 * Blanks out JS single-line and block comments while preserving string literals
 * and character offsets.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(
    /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match) => (match.startsWith('/') ? ' '.repeat(match.length) : match),
  );
}

/**
 * Returns true if a `process.env` reference at `matchIndex` is guarded by a
 * `typeof process` check in the same expression, an enclosing `if`, or an
 * earlier `if (typeof process === 'undefined') return/throw` in the same block.
 * @param {string} source - Comment-stripped source text.
 * @param {number} matchIndex - Index of `process.env` in `source`.
 * @returns {boolean}
 */
function isGuardedProcessEnv(source, matchIndex) {
  let stmtStart = matchIndex;
  while (stmtStart > 0) {
    const ch = source[stmtStart - 1];
    if (ch === ';' || ch === '{' || ch === '}') break;
    stmtStart--;
  }
  const stmtPrefix = source.slice(stmtStart, matchIndex);
  if (/\btypeof\s+process\b(?!\s*\.)/.test(stmtPrefix)) {
    return true;
  }

  let enclosingBlockStart = -1;
  let depth = 0;
  for (let i = matchIndex - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === '}') {
      depth++;
    } else if (ch === '{') {
      if (depth === 0) {
        if (enclosingBlockStart === -1) enclosingBlockStart = i + 1;
        const beforeBrace = source.slice(Math.max(0, i - 300), i);
        const ifMatch = beforeBrace.match(/\bif\s*\(([^)]*)\)\s*$/);
        if (ifMatch && /\btypeof\s+process\b(?!\s*\.)/.test(ifMatch[1])) {
          return true;
        }
      } else {
        depth--;
      }
    }
  }

  const blockPrefix = source.slice(enclosingBlockStart === -1 ? 0 : enclosingBlockStart, matchIndex);
  if (
    /\bif\s*\([^)]*\btypeof\s+process\s*={2,3}\s*['"]undefined['"][^)]*\)\s*(?:\{[^}]*\b(?:return|throw)\b|\b(?:return|throw)\b)/.test(
      blockPrefix,
    )
  ) {
    return true;
  }

  return false;
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
 *
 * Any unguarded `process.env.X` or `process.env['X']` reference where `X` does
 * not start with `AVX_PUBLIC_` is reported once per variable per file as
 * AVX_W80 when `file` is given.
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

    const cleaned = stripComments(content);
    const nonPublic = new Set();
    const envRefPattern = /process\.env\.([a-zA-Z0-9_$]+)|process\.env\[\s*(['"])([^'"]+)\2\s*\]/g;
    for (const match of cleaned.matchAll(envRefPattern)) {
      const name = match[1] || match[3];
      if (name.startsWith('AVX_PUBLIC_')) continue;
      if (!isGuardedProcessEnv(cleaned, match.index)) {
        nonPublic.add(name);
      }
    }

    for (const name of nonPublic) {
      reportWarning(
        AvenxErrorCodes.COMPILER_NON_PUBLIC_ENV,
        new BuildError(AvenxErrorCodes.COMPILER_NON_PUBLIC_ENV, name, file),
        config,
      );
    }
  }

  return replaced;
}
