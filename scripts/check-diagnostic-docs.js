import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_CATALOGUE } from '../lib/core/diagnostics/catalogue.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDirectory = path.join(root, 'docs/src/content/docs');
const referenceFile = path.join(docsDirectory, 'troubleshooting/errors.md');

// Add an entry only when a catalogue code is intentionally omitted from the
// troubleshooting reference. Keep the reason beside the code for review.
const DOCUMENTATION_EXCEPTIONS = Object.freeze({});

const CODE_PATTERN = /\bAVX_[A-Z]+[0-9]{2}\b/g;

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(file);
      return entry.isFile() && /\.mdx?$/.test(entry.name) ? [file] : [];
    });
}

function extractCodes(source) {
  return [...new Set(source.match(CODE_PATTERN) || [])].sort();
}

/**
 * Compare the troubleshooting reference with the catalogue, and all docs
 * with the catalogue for stale diagnostic identifiers.
 * @param {object} options
 * @param {string[]} [options.catalogueCodes]
 * @param {string} [options.referenceFile]
 * @param {string} [options.docsDirectory]
 * @param {Record<string, string>} [options.exceptions]
 * @returns {{undocumented: string[], stale: {code: string, files: string[]}[]}}
 */
export function compareDiagnosticDocs({
  catalogueCodes = Object.keys(DIAGNOSTIC_CATALOGUE),
  referenceFile = path.join(docsDirectory, 'troubleshooting/errors.md'),
  docsDirectory: docsRoot = docsDirectory,
  exceptions = DOCUMENTATION_EXCEPTIONS,
} = {}) {
  const known = new Set(catalogueCodes);
  const referenceCodes = new Set(extractCodes(fs.readFileSync(referenceFile, 'utf8')));
  const files = markdownFiles(docsRoot);
  const mentions = new Map();

  for (const file of files) {
    for (const code of extractCodes(fs.readFileSync(file, 'utf8'))) {
      if (!mentions.has(code)) mentions.set(code, []);
      mentions.get(code).push(path.relative(docsRoot, file).split(path.sep).join('/'));
    }
  }

  const undocumented = [...known]
    .filter((code) => !referenceCodes.has(code) && !exceptions[code])
    .sort();
  const stale = [...mentions]
    .filter(([code]) => !known.has(code))
    .map(([code, locations]) => ({ code, files: locations.sort() }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return { undocumented, stale };
}

/**
 * Run the documentation consistency check and report both directions of drift.
 * @param {object} [options]
 * @param {(message: string) => void} [options.report]
 * @returns {{undocumented: string[], stale: {code: string, files: string[]}[]}}
 */
export function checkDiagnosticDocs({ report = console.log, ...options } = {}) {
  const result = compareDiagnosticDocs(options);
  const reference = path.relative(root, options.referenceFile || referenceFile);

  if (result.undocumented.length) {
    report(`Catalogue codes missing from ${reference}:`);
    for (const code of result.undocumented) report(`  ${code}`);
  }

  if (result.stale.length) {
    report('Documentation mentions codes absent from the diagnostic catalogue:');
    for (const item of result.stale) report(`  ${item.code}: ${item.files.join(', ')}`);
  }

  if (!result.undocumented.length && !result.stale.length) {
    report('Diagnostic documentation matches the catalogue.');
  } else {
    report('Document each missing code or remove each stale mention, then rerun npm run test:diagnostic-docs.');
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkDiagnosticDocs();
    process.exitCode = result.undocumented.length || result.stale.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
