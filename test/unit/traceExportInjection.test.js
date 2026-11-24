/**
 * @file traceExportInjection.test.js
 * @description A recorded trace cannot inject code into the test it generates.
 *
 * `avenx trace export` writes a JavaScript file from a recording. Trace fields
 * were interpolated into comments verbatim, so a value containing `*&#47;` or a
 * newline escaped the comment and became executable source. A trace is not
 * necessarily trustworthy input: with `avenx serve --trace` running, any page
 * the developer visits could POST one to the ingest endpoint.
 *
 * Every field that reaches generated source is now neutralised for its context,
 * and identifiers are validated rather than interpolated.
 */
import assert from 'node:assert';
import { parse } from 'acorn';
import { generateTest } from '../../lib/core/trace/exportTest.js';
import { TraceNodeType } from '../../lib/core/trace/schema.js';

/**
 * Builds a trace whose fields carry an injection payload.
 * @param {object} overrides - Fields to merge into the trace.
 * @returns {object} A trace.
 */
function traceWith(overrides = {}) {
  return {
    id: 'abc',
    traceVersion: 1,
    createdAt: 'now',
    nodes: [],
    determinism: { status: 'deterministic' },
    ...overrides,
  };
}

/**
 * Asserts that no payload escaped a comment into executable source.
 *
 * The generated file is parsed: a payload that stayed inside a comment is not
 * in the AST at all, and one that broke out is. This is the property that
 * matters -- the text may still appear, inertly, in a comment.
 * @param {string} source - The generated test source.
 * @param {string} label - What was generated.
 */
function assertNoBreakout(source, label) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (error) {
    assert.fail(`${label}: generated source must parse, got ${error.message}`);
  }
  const seen = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Identifier' && node.name === 'INJECTED') seen.push(node.name);
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === 'string') walk(value);
    }
  };
  walk(ast);
  assert.deepStrictEqual(seen, [], `${label}: a payload became executable source`);
}

const options = { componentName: 'Probe', componentPath: './p.js', tracePath: './t.json' };

try {
  console.log('🧪 Block-comment breakout via trace metadata');
  for (const field of ['createdAt', 'id']) {
    const source = generateTest(traceWith({ [field]: 'x */ globalThis.INJECTED = 1; /* y' }), options);
    assertNoBreakout(source, field);
  }

  const metaUrl = generateTest(traceWith({ meta: { url: 'http://x */ globalThis.INJECTED = 1; /*' } }), options);
  assertNoBreakout(metaUrl, 'meta.url');

  const reasons = generateTest(
    traceWith({
      determinism: { status: 'best-effort', reasons: [{ reason: 'r */ globalThis.INJECTED = 1; /*', detail: 'd' }] },
    }),
    options,
  );
  assertNoBreakout(reasons, 'determinism reasons');

  const redactions = generateTest(
    traceWith({ redacted: true, redactions: ['a */ globalThis.INJECTED = 1; /*'] }),
    options,
  );
  assertNoBreakout(redactions, 'redactions');

  console.log('🧪 Line-comment breakout via a recorded selector or navigation');
  const newlinePayload = 'btn\n      globalThis.INJECTED = 1;';
  const domTrace = traceWith({
    nodes: [
      {
        id: 1,
        type: TraceNodeType.EVENT,
        eventType: 'click',
        target: { selector: newlinePayload },
        parent: null,
      },
      {
        id: 2,
        type: TraceNodeType.DOM,
        op: 'text',
        target: { selector: newlinePayload },
        from: 'a',
        to: 'b',
        parent: 1,
      },
    ],
  });
  assertNoBreakout(generateTest(domTrace, options), 'dom selector');

  const navTrace = traceWith({
    nodes: [{ id: 1, type: TraceNodeType.NAVIGATION, to: '#/x\n      globalThis.INJECTED = 1;', parent: null }],
  });
  assertNoBreakout(generateTest(navTrace, options), 'navigation target');

  console.log('🧪 A U+2028 line separator cannot start a statement either');
  const sepTrace = traceWith({
    createdAt: 'x globalThis.INJECTED = 1;',
  });
  const sepSource = generateTest(sepTrace, options);
  assert.ok(!sepSource.includes(' '), 'U+2028 must not reach generated source');
  assertNoBreakout(sepSource, 'U+2028');

  console.log('🧪 Identifiers are validated, not interpolated');
  const badName = generateTest(traceWith(), { ...options, componentName: 'Probe; globalThis.INJECTED = 1; const X' });
  assert.ok(!badName.includes('INJECTED'), 'a bogus component name must not become source');
  assert.match(badName, /const Component = loadComponent\(/, 'it falls back to a safe identifier');

  console.log('🧪 A well-formed trace still generates a usable test');

  const good = generateTest(
    traceWith({
      createdAt: '2026-09-17T10:00:00.000Z',
      meta: { url: 'http://localhost:3000/#/' },
      nodes: [
        {
          id: 1,
          type: TraceNodeType.EVENT,
          eventType: 'click',
          target: { selector: 'button.inc' },
          parent: null,
        },
        {
          id: 2,
          type: TraceNodeType.DOM,
          op: 'text',
          target: { selector: 'span.count' },
          from: '0',
          to: '1',
          parent: 1,
        },
      ],
    }),
    options,
  );

  assert.match(good, /Regression test generated by/);

  assert.match(good, /button\.inc/, 'the real selector still appears');

  assert.doesNotMatch(
    good,
    /\.textContent/,
    'individual binding values must not be compared against the entire element text',
  );

  assert.match(
    good,
    /Replay verifies the recorded text operation for span\.count/,
    'the generated test explains that replay verifies text operations',
  );

  assert.match(good, /assert\.strictEqual\(result\.ok, true\)/, 'the generated test must assert successful replay');

  assert.match(
    good,
    /assert\.strictEqual\(result\.verified, true,/,
    'a deterministic trace must assert successful verification',
  );

  assert.match(good, /2026-09-17T10:00:00\.000Z/, 'an ordinary timestamp is kept');

  assertNoBreakout(good, 'well-formed trace');

  console.log('  ✅ Trace export injection tests passed!');
} catch (error) {
  console.error('❌ Trace export injection tests failed:', error);
  process.exitCode = 1;
}
