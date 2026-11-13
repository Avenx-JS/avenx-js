/**
 * @file jsMinifyProgram.js
 * @description Fast-check generator for randomized JavaScript programs testing minifier safety invariants.
 *
 * Produces syntactically valid, deterministic JavaScript programs combining constructs
 * that challenge source masking and comment stripping:
 * 1. Single-, double-, and backtick-quoted strings with escaped quotes (\', \", \`) and backslashes (\\, \\\').
 * 2. Template literals containing ${...} interpolations, nested template literals, and // or /* comment markers in literal text.
 * 3. Regex literals containing escaped /, character classes with /, quotes, and comment markers (//, /*).
 * 4. Line comments (//) at end of line and standalone, multi-line block comments, and inline block comments inside expressions.
 * 5. Chained division expressions (a / b / c, (a + b) / c / d).
 * 6. Multi-line strings (via backslash continuation) and multi-line template literals with meaningful indentation.
 */

import fc from 'fast-check';

/**
 * Escaped and special characters used in string generators.
 */
export const SINGLE_QUOTE_STRINGS = [
  "'plain single quoted string'",
  "'single with \\'escaped\\' quote'",
  "'single with double \"quotes\" and `backticks`'",
  "'escaped \\\\ backslash in single'",
  "'escaped \\\\\\' backslash and quote'",
  "'comment markers inside: // line and /* block */'",
  "'slashes inside: a / b / c'",
  "'multiple \\'escapes\\' and \\\\slashes\\\\'",
  "'multiline string\\\n    with leading indentation\\\n        and more indentation'",
  "'\\0 null byte and \\x41 hex escape'",
  "'looks like ${interpolation} but is literal'",
  "'contains closing brace } inside string'",
  "'consecutive escapes: \\'\\'\\' and \\\\\\\\'",
];

export const DOUBLE_QUOTE_STRINGS = [
  '"plain double quoted string"',
  '"double with \\"escaped\\" quote"',
  '"double with single \'quotes\' and `backticks`"',
  '"escaped \\\\ backslash in double"',
  '"escaped \\\\\\" backslash and quote"',
  '"comment markers inside: // line and /* block */"',
  '"slashes inside: a / b / c"',
  '"multiple \\"escapes\\" and \\\\slashes\\\\"',
  '"multiline string\\\n    with leading indentation\\\n        and more indentation"',
  '"\\0 null byte and \\x41 hex escape"',
  '"looks like ${interpolation} but is literal"',
  '"contains closing brace } inside string"',
  '"consecutive escapes: \\"\\"\\" and \\\\\\\\"',
];

export const TEMPLATE_LITERALS = [
  '`plain template literal`',
  '`template with \\`escaped\\` backtick`',
  '`template with escaped \\\\ backslash`',
  '`template with \\\\\\` backslash and backtick`',
  '`template with "double" and \'single\' quotes`',
  '`template with // line comment marker in text`',
  '`template with /* block comment marker */ in text`',
  '`template with \n    meaningful leading indentation\n        nested indentation\n    closing line`',
  '`template with \\${escapedInterpolation}`',
  '`template with ${a + b} arithmetic`',
  '`template with ratio ${(a / b) / c}`',
  '`template with ${`nested ${a + 1}`} template`',
  '`template with ${"// marker inside interpolation"} string`',
  '`template with ${"/* marker inside interpolation */"} string`',
  '`template with ${\'single quoted interpolation\'}`',
  '`template with ${/pattern\\/with\\/slash/.test("pattern/with/slash") ? 1 : 0} regex`',
  '`template with ${`level1-${`level2-${b}`}`} deep nesting`',
  '`template with ${`a-${`b-${`c-${1}`}`}`} three levels`',
  '`multiline template with\\n  newlines and ${a} interpolation\\n  and // marker`',
  '`multiline with tabs:\n\t\tindented line 1\n\t\tindented line 2\n`',
  '`text with slashes / and \\\\ and quotes \' " and markers // /* */`',
];

export const REGEX_EXPRESSIONS = [
  'String(/pattern/)',
  'String(/\\/abc\\//)',
  'String(/[/]/)',
  'String(/[\\/]/)',
  'String(/[\\]]/)',
  'String(/[a/b/c]/)',
  'String(/["\'`]/)',
  'String(/["\'`/]/)',
  'String(/\\/\\//)',
  'String(/\\/\\*/)',
  'String(/[/*]/)',
  'String(/test/gi)',
  'String(/foo\\/bar/m)',
  'String(/\\/\\*.*?\\*\\//)',
  'String(/\\/\\/.*/)',
  '/hello\\/world/.test("hello/world") ? 1 : 0',
  '/[/][*]/.test("/*") ? 1 : 0',
  '(/abc/i).test("ABC") ? 10 : 20',
  '(/[a-z][/][0-9]/).test("a/1") ? 100 : 200',
  '(/foo\\/bar/).test("foo/bar") ? 1 : 0',
];

export const DIVISION_EXPRESSIONS = [
  'a / b / c',
  '(a + b) / (c + 1) / 2',
  '((a * 10) / b) / c',
  '120 / b / c',
  '(a / b) / (c / 1)',
  'a / (b / c)',
  '(a + 100) / b / c / 2',
  '((a + b + c) / d)',
  '(a / 2) / (b / 1)',
  'a / b / c / 2',
];

export const LINE_COMMENTS = [
  '// A simple line comment',
  '// Line comment with quotes: "hello" \'world\' `backtick`',
  '// Line comment with comment markers: // and /* */',
  '// Line comment with division / regex lookalike: a / b / c /',
  '// Line comment with backslashes \\ and escapes \\n',
  '// 🚀 Unicode in comment',
  '// Comment with multiple slashes // // //',
  '// /* block start in line comment */',
  '//',
];

export const BLOCK_COMMENTS = [
  '/* inline block comment */',
  '/* block comment with "quotes" \'single\' `backtick` */',
  '/* block comment with // line comment marker inside */',
  '/* block comment with division: a / b / c */',
  '/*\n * multi-line block comment\n * spanning several lines\n */',
  '/*\n   indented multi-line comment\n   second line\n */',
  '/**/',
  '/* * * * */',
  '/*\n *\n *\n */',
  '/*\n * multi-line with // and quotes \' " `\n */',
];

/**
 * Arbitrary generator for an expression from one of the core construct categories.
 * @returns {fc.Arbitrary<string>}
 */
export function expressionArbitrary() {
  const singleQuoteArb = fc.constantFrom(...SINGLE_QUOTE_STRINGS);
  const doubleQuoteArb = fc.constantFrom(...DOUBLE_QUOTE_STRINGS);
  const templateArb = fc.constantFrom(...TEMPLATE_LITERALS);
  const regexArb = fc.constantFrom(...REGEX_EXPRESSIONS);
  const divisionArb = fc.constantFrom(...DIVISION_EXPRESSIONS);

  // Compound expression: combining values with arithmetic or concatenation
  const compoundArb = fc
    .record({
      left: fc.constantFrom('a', 'b', '10', '"start-"', "'prefix-'"),
      op: fc.constantFrom('+', '-'),
      right: fc.constantFrom('b', 'c', '1', '"-end"', "'-suffix'"),
      comment: fc.option(fc.constantFrom('/* between operands */', '/*\n * multiline\n */'), { nil: '' }),
    })
    .map(({ left, op, right, comment }) => {
      if (left.startsWith('"') || left.startsWith("'")) {
        return `${left} + ${comment ? `${comment} ` : ''}${right.replace('-', '')}`;
      }
      return `${left} ${op} ${comment ? `${comment} ` : ''}${right}`;
    });

  return fc.oneof(singleQuoteArb, doubleQuoteArb, templateArb, regexArb, divisionArb, compoundArb);
}

/**
 * Arbitrary generator for a complete, runnable JavaScript program.
 * @param {object} [options]
 * @param {number} [options.minItems]
 * @param {number} [options.maxItems]
 * @returns {fc.Arbitrary<{code: string, meta: object}>}
 */
export function jsMinifyProgramArbitrary(options = {}) {
  const minItems = options.minItems ?? 4;
  const maxItems = options.maxItems ?? 10;

  return fc
    .record({
      preComments: fc.array(fc.constantFrom(...LINE_COMMENTS, ...BLOCK_COMMENTS), { minLength: 0, maxLength: 3 }),
      postComments: fc.array(fc.constantFrom(...LINE_COMMENTS, ...BLOCK_COMMENTS), { minLength: 0, maxLength: 3 }),
      items: fc.array(
        fc.record({
          expr: expressionArbitrary(),
          leadingComment: fc.option(fc.constantFrom(...BLOCK_COMMENTS), { nil: '' }),
          trailingComment: fc.option(fc.constantFrom(...LINE_COMMENTS), { nil: '' }),
          indent: fc.constantFrom('', '  ', '    '),
        }),
        { minLength: minItems, maxLength: maxItems },
      ),
      hasInlineSplits: fc.boolean(),
    })
    .map(({ preComments, postComments, items, hasInlineSplits }) => {
      const lines = [];

      // Preamble comments
      for (const comment of preComments) {
        lines.push(comment);
      }

      // Variable declarations used by expressions
      lines.push('const a = 120, b = 2, c = 3, d = 4;');

      // Start result array assignment
      lines.push('globalThis.result = [');

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let itemStr = '';
        if (item.leadingComment) {
          itemStr += `${item.leadingComment} `;
        }
        itemStr += item.expr;
        if (i < items.length - 1 || hasInlineSplits) {
          itemStr += ',';
        }
        if (item.trailingComment) {
          itemStr += ` ${item.trailingComment}`;
        }
        lines.push(`${item.indent}${itemStr}`);
      }

      // Optional inline split comment across lines within an extra item
      if (hasInlineSplits) {
        lines.push('  10 + /*');
        lines.push('   * split block comment inside array item');
        lines.push('   */ 20');
      }

      lines.push('];');

      // Postamble comments
      for (const comment of postComments) {
        lines.push(comment);
      }

      const code = lines.join('\n');
      return { code, meta: { itemCount: items.length } };
    });
}
