/**
 * AVX_W03 for `data-ax-bind` is reported once, against the source as written.
 *
 * `data-ax-bind="x"` expands to `value="{{ x }}"` plus `@input="x = ..."`.
 * Validating that expansion reported an undeclared bind twice, each with a code
 * frame quoting attributes the author never wrote.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-bind-w03-'));
const PAGES_DIR = path.join(TEST_DIR, 'src', 'pages');

/**
 * Compiles a page with the given template and returns its AVX_W03 warnings.
 * @param {string} template - The page template.
 * @returns {string[]} The text of each AVX_W03 warning, in order.
 */
function undeclaredWarnings(template) {
  const file = path.join(PAGES_DIR, 'home.page.js');
  fs.writeFileSync(file, `<state a="1" />\n\n${template}\n`);

  const seen = [];
  const previous = logger.config.transports;
  logger.configure({
    transports: [
      (level, formatted) => {
        if (level === 'warn') seen.push(Array.isArray(formatted) ? formatted.join(' ') : String(formatted));
      },
    ],
  });
  try {
    new ComponentParser(new StyleProcessor()).parse(file, 'page');
  } finally {
    logger.configure({ transports: previous });
  }
  return seen.filter((warning) => warning.includes('AVX_W03'));
}

try {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'avenx.config.json'), '{}');

  console.log('🧪 data-ax-bind reports AVX_W03 once, quoting the authored source...');
  {
    const warnings = undeclaredWarnings('<div><input data-ax-bind="nope" /></div>');
    assert.strictEqual(warnings.length, 1, `one warning for one bind, got ${warnings.length}`);
    assert.ok(warnings[0].includes('"nope"'), 'names the reference');
    assert.ok(warnings[0].includes('data-ax-bind="nope"'), 'the frame quotes the attribute as written');
    assert.ok(!warnings[0].includes('value="{{ nope }}"'), 'the frame does not quote the expanded value binding');
    assert.ok(!warnings[0].includes('event.target.value'), 'the frame does not quote the generated handler');
  }

  // Every expansion shape: select (@change), textarea, checkbox, radio.
  for (const template of [
    '<select data-ax-bind="nope"><option>x</option></select>',
    '<textarea data-ax-bind="nope"></textarea>',
    '<input type="checkbox" data-ax-bind="nope" />',
    '<input type="radio" value="x" data-ax-bind="nope" />',
  ]) {
    const warnings = undeclaredWarnings(`<div>${template}</div>`);
    assert.strictEqual(warnings.length, 1, `one warning for ${template}, got ${warnings.length}`);
    assert.ok(warnings[0].includes('data-ax-bind="nope"'), `the frame quotes ${template} as written`);
  }

  // A declared bind is still silent.
  assert.deepStrictEqual(undeclaredWarnings('<div><input data-ax-bind="a" /></div>'), []);
  assert.deepStrictEqual(undeclaredWarnings('<div><input data-ax-bind="state.a" /></div>'), []);
  console.log('  ✅ data-ax-bind');

  console.log('🧪 Other references report as before...');
  assert.strictEqual(undeclaredWarnings('<div>{{ nope }}</div>').length, 1, '{{ nope }} reports once');
  assert.strictEqual(undeclaredWarnings('<div><button @click="nope()">x</button></div>').length, 1, '@click reports once');
  assert.strictEqual(undeclaredWarnings('<div>{{ nope }} {{ nope }}</div>').length, 2, 'each occurrence reports');

  // Two separate references on one line are two findings, not a duplicate.
  {
    const warnings = undeclaredWarnings('<div><input data-ax-bind="first" /><input data-ax-bind="second" /></div>');
    assert.strictEqual(warnings.length, 2, 'two binds on one line report twice');
    assert.ok(warnings[0].includes('"first"') && warnings[1].includes('"second"'));
  }
  assert.strictEqual(
    undeclaredWarnings('<div><input data-ax-bind="nope" /> {{ other }}</div>').length,
    2,
    'a bind and an interpolation on one line report twice',
  );
  console.log('  ✅ other references');

  console.log('✅ data-ax-bind AVX_W03 tests passed.');
} catch (err) {
  console.error('❌ data-ax-bind AVX_W03 test failed:', err);
  process.exitCode = 1;
} finally {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
