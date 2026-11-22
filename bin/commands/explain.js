import { DIAGNOSTIC_CATALOGUE, getDiagnostic, suggestCodes } from '../../lib/core/diagnostics/catalogue.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { bold, cyan, red, yellow } from '../colors.js';

/** Categories in the order the catalogue presents them; any others follow alphabetically. */
const CATEGORY_ORDER = ['compiler', 'runtime', 'styling', 'routing', 'accessibility', 'environment'];

/** Every code the framework can emit; a `warnings` entry can only steer the AVX_W* ones (see lib/config.js). */
const KNOWN_CODES = new Set(Object.values(AvenxErrorCodes));

/**
 * Whether a `warnings` entry in avenx.config.json can change this code's severity.
 * @param {string} code
 * @returns {boolean}
 */
function isConfigurable(code) {
  return code.startsWith('AVX_W') && KNOWN_CODES.has(code);
}

/**
 * Executes the `avenx explain <CODE>` command.
 * @param {object} cli
 * @param {string} rawCode
 * @param {boolean} [asJson]
 */
export function explainDiagnostic(cli, rawCode, asJson = false) {
  if (!rawCode) {
    if (asJson) {
      console.log(JSON.stringify({ error: 'Diagnostic code required' }, null, 2));
    } else {
      console.error('❌ Please provide a diagnostic code (e.g., avenx explain AVX_W29 or avenx explain W29), or run avenx explain --list to see every code');
    }
    process.exit(1);
  }

  const diagnostic = getDiagnostic(rawCode);

  if (!diagnostic) {
    const suggestions = suggestCodes(rawCode);
    if (asJson) {
      console.log(JSON.stringify({
        error: `Unknown diagnostic code: '${rawCode}'`,
        suggestions
      }, null, 2));
    } else {
      console.error(`❌ Unknown diagnostic code: '${rawCode}'`);
      if (suggestions.length > 0) {
        console.log(`\nDid you mean: ${suggestions.join(', ')}?`);
      }
    }
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(diagnostic, null, 2));
    return;
  }

  const severityColor = diagnostic.severity === 'error' ? red : yellow;

  console.log(`\n${bold(diagnostic.code)}: ${diagnostic.name} [${severityColor(diagnostic.severity.toUpperCase())}]`);
  console.log(`Category: ${cyan(diagnostic.category)}\n`);
  console.log(`${bold('Summary:')}\n  ${diagnostic.summary}\n`);

  console.log(bold('Common Causes:'));
  diagnostic.causes.forEach((c) => console.log(`  • ${c}`));

  console.log(`\n${bold('How to Fix:')}`);
  diagnostic.remedies.forEach((r) => console.log(`  • ${r}`));

  console.log(`\n${bold('Documentation:')}\n  ${cyan(diagnostic.docsUrl)}\n`);
}

/**
 * Reads the filters given to `avenx explain --list`: a severity ("error" or
 * "warning"), a code letter ("C", "R" or "W", with or without the AVX_ prefix),
 * and `--category <name>` (or `--category=<name>`).
 * @param {string[]} args
 * @returns {{severity: string|null, prefix: string|null, category: string|null, error?: string}}
 */
function parseListFilters(args) {
  const filters = { severity: null, prefix: null, category: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--category' || arg.startsWith('--category=')) {
      const value = arg === '--category' ? args[++i] : arg.slice('--category='.length);
      if (!value) return { ...filters, error: '--category needs a category name' };
      filters.category = value.toLowerCase();
    } else if (arg.startsWith('-')) {
      continue;
    } else if (arg.toLowerCase() === 'error' || arg.toLowerCase() === 'warning') {
      filters.severity = arg.toLowerCase();
    } else if (/^(avx_?)?[crw]$/i.test(arg)) {
      filters.prefix = `AVX_${arg.slice(-1).toUpperCase()}`;
    } else {
      return { ...filters, error: `Unknown filter "${arg}". Use a severity (error, warning), a code letter (C, R, W) or --category <name>` };
    }
  }
  return filters;
}

/**
 * Executes `avenx explain --list [--json] [error|warning|C|R|W] [--category <name>]`.
 * Prints every catalogued code with its name, default severity, category, and
 * whether a `warnings` entry can configure it. `--json` emits the same entries
 * as an array, each shaped like the single-code `--json` payload plus a
 * `configurable` flag.
 * @param {string[]} args - Arguments after `--list`'s command word, flags included.
 * @param {boolean} [asJson]
 */
export function listDiagnostics(args = [], asJson = false) {
  const fail = (message) => {
    if (asJson) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(`❌ ${message}`);
    }
    process.exit(1);
  };

  const filters = parseListFilters(args);
  if (filters.error) fail(filters.error);

  const categories = new Set(Object.values(DIAGNOSTIC_CATALOGUE).map((d) => d.category));
  if (filters.category && !categories.has(filters.category)) {
    fail(`Unknown category '${filters.category}'. Categories: ${[...categories].sort().join(', ')}`);
  }

  const entries = Object.values(DIAGNOSTIC_CATALOGUE)
    .filter((d) => !filters.severity || d.severity === filters.severity)
    .filter((d) => !filters.prefix || d.code.startsWith(filters.prefix))
    .filter((d) => !filters.category || d.category === filters.category)
    .map((d) => ({ ...d, configurable: isConfigurable(d.code) }))
    .sort((a, b) => a.code.localeCompare(b.code));

  if (asJson) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) fail('No diagnostic codes match those filters.');

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => categories.has(c)),
    ...[...categories].filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  for (const category of orderedCategories) {
    const rows = entries.filter((d) => d.category === category);
    if (rows.length === 0) continue;
    console.log(`\n${bold(category.toUpperCase())} (${rows.length})`);
    for (const row of rows) {
      const configurable = row.configurable ? 'configurable' : 'not configurable';
      console.log(`  ${row.code}  ${row.severity.padEnd(8)}  ${configurable.padEnd(16)}  ${row.name}`);
    }
  }

  if (entries.some((d) => d.configurable)) {
    console.log(`\nSet a warning's severity in avenx.config.json, e.g. "warnings": { "AVX_W55": "off" }.`);
  }
}
