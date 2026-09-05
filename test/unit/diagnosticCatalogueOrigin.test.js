/**
 * Every docsUrl in DIAGNOSTIC_CATALOGUE must point at the project's real
 * documentation origin, so that `avenx explain <code>` always prints a link
 * that resolves.
 *
 * This is a string check — it does not open the URLs — and it is the regression
 * net for the drift that would otherwise silently route every code to a dead
 * host (e.g. `avenx.dev`) on the next catalogue rewrite.
 */
import assert from 'assert';
import { DIAGNOSTIC_CATALOGUE } from '../../lib/core/diagnostics/catalogue.js';

console.log('🧪 Testing diagnostic catalogue docsUrl origin...');

const EXPECTED_ORIGIN = 'https://avenx-js.com/';

try {
  const codes = Object.keys(DIAGNOSTIC_CATALOGUE).sort();

  for (const code of codes) {
    const entry = DIAGNOSTIC_CATALOGUE[code];
    assert.ok(entry, `${code} is present in the catalogue`);
    assert.ok('docsUrl' in entry, `${code} carries a docsUrl`);

    const url = entry.docsUrl;

    assert.ok(
      typeof url === 'string' && url.startsWith(EXPECTED_ORIGIN),
      `${code}: docsUrl "${url}" does not start with "${EXPECTED_ORIGIN}"` +
      ' — the catalogue points at the wrong host or path.'
    );

    assert.ok(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(url),
      `${code}: docsUrl "${url}" is not a well-formed absolute URL`
    );
  }

  console.log(`  ✅ all ${codes.length} catalogue entries point at the project documentation origin`);
} catch (error) {
  console.error('❌ diagnostic catalogue docsUrl origin tests failed!');
  console.error(error);
  process.exit(1);
}
