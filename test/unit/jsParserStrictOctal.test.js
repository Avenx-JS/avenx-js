/**
 * Legacy octal and leading-zero decimal literals (`0755`, `09`) are early
 * errors in strict code. The compiler's JavaScript parser must reject them
 * there, as acorn does, and must keep reading them in sloppy code.
 */
import assert from 'assert';
import { parse } from '../../lib/compiler/parser/js/parser.js';
import { compileActionToSource } from '../../lib/compiler/codegen/actions.js';

console.log('🧪 Testing strict-mode legacy octal literals in the JS parser...');

/**
 * Parses a script and reports the error message, or null when it parses.
 * @param {string} source - Script source.
 * @returns {string|null} The error message, or null.
 */
function parseError(source) {
  try {
    parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
    return null;
  } catch (error) {
    return error.message;
  }
}

const strictCases = [
  '"use strict"; const a = 0755;',
  '"use strict"; const a = 09;',
  '"use strict"; const a = 08.5;',
  'function f() { "use strict"; return 0755; }',
];
for (const source of strictCases) {
  assert.ok(parseError(source), `accepted strict legacy octal: ${source}`);
}

// Sloppy code reads the same literal, so the rule must not reach it.
const sloppy = parse('const a = 0755;', { ecmaVersion: 'latest', sourceType: 'script' });
const literal = sloppy.body[0].declarations[0].init;
assert.strictEqual(literal.value, 493, 'sloppy 0755 should read as octal 493');

// Modern forms are not legacy octals and stay valid in strict code.
assert.strictEqual(parseError('"use strict"; const a = 0o755 + 0.5 + 0;'), null);

// A component action is emitted inside the bundle's 'use strict', so the same
// literal is an error there, and the modern form still compiles.
assert.throws(
  () => compileActionToSource('count = 0755;', {}),
  /could not be parsed/,
  'accepted strict legacy octal: component action count = 0755;'
);
assert.ok(compileActionToSource('count = 0o755;', {}).length > 0, 'modern octal should compile in an action');

console.log('✅ Strict-mode legacy octal literals are rejected');
