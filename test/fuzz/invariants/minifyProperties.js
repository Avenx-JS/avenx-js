/**
 * @file minifyProperties.js
 * @description Safety invariants and property-based verification for the bundle minifier.
 *
 * Implements Issue #1656:
 * Asserts the six safety properties of lib/bundler/minify.js:
 * 1. Line count preservation: minify(src).split('\n').length === src.split('\n').length.
 * 2. Semantic equivalence: Both src and minify(src) parse with Acorn, and evaluating both produces identical results.
 * 3. Literal value preservation: Every string Literal and TemplateElement in the AST is byte-identical in order.
 * 4. Idempotence: minify(minify(src)) === minify(src).
 * 5. Non-increasing length: minify(src).length <= src.length.
 * 6. Complete comment removal: Acorn parser reports 0 comments in the minified code.
 *
 * Accompanied by a fixed suite of named regression tests for deterministic verification.
 */

import assert from 'node:assert';
import vm from 'node:vm';
import * as acorn from 'acorn';
import fc from 'fast-check';
import { minify } from '../../../lib/bundler/minify.js';
import { jsMinifyProgramArbitrary } from '../generators/jsMinifyProgram.js';

/**
 * Traverses an Acorn AST and collects all string Literal and TemplateElement values.
 * @param {object} ast - Acorn Program AST.
 * @returns {Array<{type: 'Literal'|'TemplateElement', value?: string, raw?: string, cooked?: string}>}
 */
export function collectAstLiterals(ast) {
  const literals = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'Literal' && typeof node.value === 'string') {
      literals.push({ type: 'Literal', value: node.value });
    } else if (node.type === 'TemplateElement') {
      literals.push({
        type: 'TemplateElement',
        raw: node.value.raw,
        cooked: node.value.cooked,
        tail: node.tail,
      });
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) walk(item);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast);
  return literals;
}

/**
 * Asserts all six minifier safety invariants for a single JavaScript program.
 * @param {string} src - The original JavaScript source.
 * @param {string} [caseLabel] - Optional label for diagnostic messages.
 */
export function assertMinifyInvariants(src, caseLabel = '') {
  const label = caseLabel ? `[${caseLabel}] ` : '';

  // 1. Minification execution
  const minified = minify(src);

  // Invariant 1: Exact line count preservation
  const srcLineCount = src.split('\n').length;
  const minLineCount = minified.split('\n').length;
  assert.strictEqual(
    minLineCount,
    srcLineCount,
    `${label}Invariant 1 failed: Line count must be preserved exactly (${srcLineCount} vs ${minLineCount})`,
  );

  // Invariant 5: Non-increasing length
  assert.ok(
    minified.length <= src.length,
    `${label}Invariant 5 failed: Output length (${minified.length}) cannot exceed input length (${src.length})`,
  );

  // Invariant 4: Idempotence
  const doubleMinified = minify(minified);
  assert.strictEqual(
    doubleMinified,
    minified,
    `${label}Invariant 4 failed: Minification must be idempotent (minify(minify(src)) === minify(src))`,
  );

  // Invariant 2 & 6: AST parsing and comment removal check
  const srcComments = [];
  const minComments = [];

  const srcAst = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    onComment: srcComments,
  });

  const minAst = acorn.parse(minified, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    onComment: minComments,
  });

  assert.strictEqual(
    minComments.length,
    0,
    `${label}Invariant 6 failed: Expected 0 comments in minified output, found ${minComments.length}`,
  );

  // Invariant 2: Semantic evaluation equivalence
  const srcContext = { globalThis: {} };
  srcContext.globalThis = srcContext;
  vm.runInNewContext(src, srcContext, { filename: 'src.js' });

  const minContext = { globalThis: {} };
  minContext.globalThis = minContext;
  vm.runInNewContext(minified, minContext, { filename: 'min.js' });

  assert.deepStrictEqual(
    globalThis.structuredClone(minContext.result),
    globalThis.structuredClone(srcContext.result),
    `${label}Invariant 2 failed: Evaluation result must match before and after minification`,
  );

  // Invariant 3: AST literal value preservation
  const srcLiterals = collectAstLiterals(srcAst);
  const minLiterals = collectAstLiterals(minAst);

  assert.strictEqual(
    minLiterals.length,
    srcLiterals.length,
    `${label}Invariant 3 failed: Literal node count mismatch (${srcLiterals.length} vs ${minLiterals.length})`,
  );

  for (let i = 0; i < srcLiterals.length; i++) {
    assert.deepStrictEqual(
      minLiterals[i],
      srcLiterals[i],
      `${label}Invariant 3 failed: Literal mismatch at index ${i}: expected ${JSON.stringify(srcLiterals[i])}, got ${JSON.stringify(minLiterals[i])}`,
    );
  }

  return true;
}

/**
 * Fixed suite of named deterministic regression cases.
 */
export const REGRESSION_CASES = [
  {
    name: 'Escaped quotes and backslashes in strings',
    code: [
      "const a = 'single with \\'escaped\\' quote and \\\\ backslash and \\\\\\' both';",
      'const b = "double with \\"escaped\\" quote and \\\\ backslash and \\\\\\" both";',
      'globalThis.result = { a, b };',
    ].join('\n'),
  },
  {
    name: 'Multi-line strings with backslash line continuation and leading indentation',
    code: `
      const s = "line 1\\
          line 2 with leading indentation\\
              line 3 deeper indentation";
      globalThis.result = s;
    `,
  },
  {
    name: 'Template literal with comment markers in literal text',
    code: `
      const a = 10, b = 20;
      const t = \`start // not a line comment\\n/* not a block comment */ \${a + b} end\`;
      globalThis.result = t;
    `,
  },
  {
    name: 'Multi-line template literal with internal indentation preserved',
    code: `
      const a = 42;
      const html = \`
          <section class="card">
              <header>\${a}</header>
              <p>Text</p>
          </section>
      \`;
      globalThis.result = html;
    `,
  },
  {
    name: 'Nested template literals with interpolations',
    code: `
      const x = 5;
      const res = \`outer-\${\`middle-\${\`inner-\${x}\`}\`}-end\`;
      globalThis.result = res;
    `,
  },
  {
    name: 'Regex literals containing slashes, character classes, and comment markers',
    code: `
      const r1 = /\\/path\\/to\\/resource/;
      const r2 = /[/]/;
      const r3 = /\\/\\//;
      const r4 = /\\/\\*/;
      const r5 = /[/*]/;
      const r6 = /["'\`]/;
      globalThis.result = [String(r1), String(r2), String(r3), String(r4), String(r5), String(r6)];
    `,
  },
  {
    name: 'Chained division expressions looking like regex starts',
    code: `
      const a = 120, b = 2, c = 3, d = 4;
      const res1 = a / b / c;
      const res2 = (a + b) / (c + 1) / 2;
      const res3 = ((a / b) / c);
      globalThis.result = [res1, res2, res3];
    `,
  },
  {
    name: 'Line comments at end of line and standalone lines',
    code: `
      // Standalone top comment
      const a = 1; // End of line comment
      //
      // Standalone middle comment with "quotes" and \`backticks\`
      const b = 2; // Another eol comment with // nested markers
      globalThis.result = a + b;
      // Standalone bottom comment
    `,
  },
  {
    name: 'Single-line and multi-line block comments, including inside expressions',
    code: `
      /* Standalone single-line block */
      const a = 10 /* inline comment */ + 20;
      /*
       * Multi-line block comment
       * spanning multiple lines
       */
      const b = 30 + /*
       * split across lines
       */ 40;
      globalThis.result = a + b;
    `,
  },
  {
    name: 'Inline block comments between identifier and operator without syntax corruption',
    code: `
      function calc(val) {
        return/* comment */val /* c1 */ * /* c2 */ 2;
      }
      globalThis.result = calc(21);
    `,
  },
  {
    name: 'Interpolations containing string comment markers and regexes',
    code: `
      const a = 1;
      const t = \`value: \${"// not comment"} and \${"/* not block */"} and \${/abc/.test("abc") ? 1 : 0}\`;
      globalThis.result = t;
    `,
  },
];

/**
 * Runs the deterministic named regression cases.
 */
export function runRegressionSuite() {
  console.log(`  🧪 Running ${REGRESSION_CASES.length} named regression cases...`);
  for (const { name, code } of REGRESSION_CASES) {
    assertMinifyInvariants(code, name);
  }
  console.log(`  ✅ All ${REGRESSION_CASES.length} named regression cases passed.`);
}

/**
 * Runs the property-based verification suite for the minifier invariants.
 * @param {number} [numRuns] - Number of random program iterations to test.
 */
export function testMinifyProperties(numRuns = 100) {
  console.log(`🧪 Minifier safety invariants: 6 core properties [${numRuns} runs]...`);

  // 1. Run deterministic named regression suite first
  runRegressionSuite();

  // 2. Run fast-check randomized program property suite
  fc.assert(
    fc.property(jsMinifyProgramArbitrary(), ({ code }) => {
      assertMinifyInvariants(code);
      return true;
    }),
    { numRuns },
  );

  console.log(`  ✅ All ${numRuns} randomized programs satisfied all 6 minifier safety invariants.`);
}
