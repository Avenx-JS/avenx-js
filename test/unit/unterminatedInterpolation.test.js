/**
 * @file unterminatedInterpolation.test.js
 * @description AVX_W54 -- an interpolation opened and never closed.
 *
 * An unterminated `{{` is not a parse failure. The lexer treats the braces as
 * ordinary text, so the template compiles, the build exits 0, and the emitted
 * program carries the literal text `{{ a ` into the page -- a visitor reads the
 * braces and the expression source. Forgetting one `}}` was indistinguishable
 * from working code until someone loaded the page, and the state the broken
 * interpolation meant to read was then reported by AVX_W40 as read nowhere,
 * which pointed the developer at the wrong line entirely.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

console.log('Testing AVX_W54 (unterminated interpolation)...');

const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-w54-'));
const filePath = path.join(dir, 'probe.component.js');

/**
 * Validates a template and returns the warnings it produced.
 * @param {string} template - The template source.
 * @param {object} [config] - Project configuration.
 * @returns {string[]} The warning messages.
 */
function warningsFor(template, config = {}) {
  const messages = [];
  const original = console.warn;
  console.warn = (msg) => messages.push(String(msg));
  try {
    const parser = new ComponentParser(new StyleProcessor());
    parser.reportUnterminatedInterpolations(template, filePath, 'Probe', config);
  } finally {
    console.warn = original;
  }
  return messages;
}

try {
  // --- fires on an unterminated interpolation ----------------------------
  {
    const messages = warningsFor('<p>{{ a </p>');
    assert.strictEqual(messages.length, 1, 'one unterminated interpolation, one warning');
    assert.ok(/AVX_W54/.test(messages[0]), `expected AVX_W54, got:\n${messages[0]}`);
    assert.ok(
      /probe\.component\.js/.test(messages[0]),
      'the message names the file, in the "in template of <file>" form that ' +
        '`avenx check --json` reads a location out of. ' +
        `Got:\n${messages[0]}`,
    );
    console.log('  ✅ fires on an unterminated interpolation');
  }

  // --- silent on well-formed templates -----------------------------------
  {
    assert.deepStrictEqual(warningsFor('<p>{{ a }}</p>'), [], 'a closed interpolation is fine');
    assert.deepStrictEqual(warningsFor('<p>{{{ raw }}}</p>'), [], 'a triple-brace interpolation is fine');
    assert.deepStrictEqual(warningsFor('<p>{ single }</p>'), [], 'a single brace is ordinary text');
    assert.deepStrictEqual(warningsFor('<p>no braces at all</p>'), [], 'plain text is fine');
    assert.deepStrictEqual(warningsFor(''), [], 'an empty template is fine');
    console.log('  ✅ silent on well-formed templates');
  }

  // --- braces inside a closed interpolation are not re-examined -----------
  {
    assert.deepStrictEqual(
      warningsFor('<p>{{ fmt({ a: 1 }) }}</p>'),
      [],
      'an object literal inside an interpolation body is not a second opener',
    );
    console.log('  ✅ an object literal inside an interpolation is not reported');
  }

  // --- several unterminated interpolations are each reported -------------
  {
    const messages = warningsFor('<p>{{ a </p><p>{{ b </p>');
    assert.strictEqual(messages.length, 2, 'each unterminated interpolation is named');
    console.log('  ✅ each unterminated interpolation is reported');
  }

  // --- honours the warnings configuration --------------------------------
  {
    assert.deepStrictEqual(
      warningsFor('<p>{{ a </p>', { warnings: { AVX_W54: 'off' } }),
      [],
      '"off" must silence it -- a template may legitimately contain literal "{{"',
    );
    assert.throws(
      () => warningsFor('<p>{{ a </p>', { warnings: { AVX_W54: 'error' } }),
      /AVX_W54/,
      '"error" must fail the build',
    );
    console.log('  ✅ honours "off" and "error" in avenx.config.json');
  }

  console.log('✅ AVX_W54 tests passed!');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
