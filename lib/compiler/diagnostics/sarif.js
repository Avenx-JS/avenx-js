import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_CATALOGUE } from '../../core/diagnostics/catalogue.js';

/**
 * Map a compiler severity to its SARIF level.
 * @param {string} severity - Effective diagnostic severity.
 * @returns {string} A SARIF level.
 */
function level(severity) {
  if (severity === 'error') return 'error';
  if (severity === 'warning' || severity === 'warn') return 'warning';
  return 'note';
}

/**
 * Produce a project-relative URI, preserving spaces and punctuation in paths.
 * @param {string} filename - Source path or file URI.
 * @param {string} rootDir - Project root.
 * @returns {string} An artifact URI.
 */
function sourceUri(filename, rootDir) {
  const file = filename.startsWith('file:') ? fileURLToPath(filename) : filename;
  const paths = /^[A-Za-z]:[\\/]|^\\\\/.test(file) ? path.win32 : path;
  const relative = paths.isAbsolute(file) ? paths.relative(rootDir, file) : file;
  return relative.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
}

/**
 * Serialize structured compiler diagnostics as SARIF 2.1.0.
 * Catalogue metadata describes a rule; each result keeps its effective severity.
 * Missing positions stay missing instead of inventing an annotation on line 1.
 * @param {object} report - The result of runCheckPass.
 * @param {string} [rootDir] - Root used to resolve diagnostic paths.
 * @returns {object} A SARIF log with one Avenx run.
 */
export function toSarif(report, rootDir = process.cwd()) {
  const codes = [...new Set(report.diagnostics.map((d) => d.code || 'AVX_UNK'))].sort();
  const rules = codes.map((code) => {
    const entry = DIAGNOSTIC_CATALOGUE[code];
    return entry ? {
      id: code,
      name: entry.name,
      shortDescription: { text: entry.summary },
      helpUri: entry.docsUrl,
      defaultConfiguration: { level: level(entry.severity) },
      properties: { tags: [entry.category] },
    } : { id: code, shortDescription: { text: code } };
  });
  const results = report.diagnostics.map((diagnostic) => {
    const code = diagnostic.code || 'AVX_UNK';
    const result = {
      ruleId: code,
      ruleIndex: codes.indexOf(code),
      level: level(diagnostic.severity),
      message: { text: diagnostic.message || code },
    };
    if (diagnostic.file) {
      const physicalLocation = { artifactLocation: { uri: sourceUri(diagnostic.file, rootDir) } };
      if (Number.isInteger(diagnostic.line) && diagnostic.line > 0) {
        physicalLocation.region = { startLine: diagnostic.line };
        if (Number.isInteger(diagnostic.column) && diagnostic.column > 0) {
          physicalLocation.region.startColumn = diagnostic.column;
        }
      }
      result.locations = [{ physicalLocation }];
    }
    return result;
  });
  return {
    $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'Avenx', informationUri: 'https://avenx-js.com', rules } },
      results,
    }],
  };
}
