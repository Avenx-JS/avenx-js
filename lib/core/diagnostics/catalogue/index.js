import { AvenxErrorCodes } from '../../runtime/AvenxError.js';
import accessibility from './accessibility.js';
import compiler from './compiler.js';
import environment from './environment.js';
import routing from './routing.js';
import runtime from './runtime.js';
import styling from './styling.js';

/**
 * Merges per-category diagnostic maps into a single catalogue, refusing
 * duplicate codes, mismatched category metadata, or drift from knownCodes.
 * @param {Record<string, Record<string, object>>} categoryModules
 * @param {string[]|null} [knownCodes]
 * @returns {Record<string, object>}
 */
export function buildDiagnosticCatalogue(
  categoryModules,
  knownCodes = Object.values(AvenxErrorCodes),
) {
  const merged = {};

  for (const [category, entries] of Object.entries(categoryModules)) {
    for (const [code, entry] of Object.entries(entries)) {
      if (Object.hasOwn(merged, code)) {
        throw new Error(
          `Duplicate diagnostic code '${code}' in category '${category}' (already defined in '${merged[code].category}')`,
        );
      }
      if (!entry || entry.code !== code) {
        throw new Error(
          `Diagnostic entry key '${code}' does not match entry.code '${entry?.code}'`,
        );
      }
      if (entry.category !== category) {
        throw new Error(
          `Diagnostic code '${code}' in category '${category}' declares category '${entry.category}'`,
        );
      }
      merged[code] = entry;
    }
  }

  if (knownCodes !== null) {
    const known = new Set(knownCodes);
    for (const code of known) {
      if (!Object.hasOwn(merged, code)) {
        throw new Error(`Missing diagnostic catalogue entry for code '${code}'`);
      }
    }
    for (const code of Object.keys(merged)) {
      if (!known.has(code)) {
        throw new Error(`Obsolete diagnostic catalogue entry '${code}' is not in known codes`);
      }
    }
  }

  return merged;
}

/**
 * Structured diagnostic catalogue mapping stable error and warning codes
 * to detailed descriptions, causes, remedies, and documentation links.
 */
export const DIAGNOSTIC_CATALOGUE = buildDiagnosticCatalogue({
  compiler,
  runtime,
  styling,
  routing,
  environment,
  accessibility,
});

/**
 * Normalizes input code string to standard format (e.g. 'c01', 'avx_c01' -> 'AVX_C01').
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code = '') {
  const clean = code.trim().toUpperCase();
  if (clean.startsWith('AVX_')) return clean;
  if (clean.startsWith('AVX')) return `AVX_${clean.slice(3)}`;
  return `AVX_${clean}`;
}

/**
 * Looks up an entry from the catalogue.
 * @param {string} code
 * @returns {object|null}
 */
export function getDiagnostic(code) {
  const normalized = normalizeCode(code);
  return DIAGNOSTIC_CATALOGUE[normalized] || null;
}

/**
 * Suggests near matches for an unknown code.
 * @param {string} inputCode
 * @returns {string[]}
 */
export function suggestCodes(inputCode) {
  const normalized = normalizeCode(inputCode);
  return Object.keys(DIAGNOSTIC_CATALOGUE).filter((k) => {
    return (
      k.includes(normalized) ||
      k.replace('AVX_', '').includes(normalized.replace('AVX_', ''))
    );
  });
}
