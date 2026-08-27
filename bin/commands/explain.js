import { getDiagnostic, suggestCodes } from '../../lib/core/diagnostics/catalogue.js';

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
      console.error('❌ Please provide a diagnostic code (e.g., avenx explain AVX_W29 or avenx explain W29)');
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

  const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
  const bold = (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);
  const cyan = (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s);
  const yellow = (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
  const red = (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);

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
