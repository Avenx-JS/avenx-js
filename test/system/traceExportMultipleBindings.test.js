/**
 * Regression test for #1764:
 * Multiple text bindings inside the same DOM element.
 * The trace records individual binding updates, but exported
 * assertions must not compare the whole element textContent
 * against the value of only one binding.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { generateTest } from '../../lib/core/trace/exportTest.js';
import { TraceNodeType } from '../../lib/core/trace/schema.js';

console.log(
  'Testing trace export with two bindings in the same element...',
);

// Simulates a click that updates two bindings inside one element.
const trace = {
  id: 'multiple-bindings',
  traceVersion: 1,
  createdAt: '2026-11-20T00:00:00.000Z',
  determinism: { status: 'deterministic' },

  nodes: [
    {
      id: 1,
      type: TraceNodeType.EVENT,
      parent: null,
      eventType: 'click',
      target: { selector: 'button.update' },
    },
    {
      id: 2,
      type: TraceNodeType.DOM,
      parent: 1,
      op: 'text',
      target: { selector: 'p.values' },
      from: '0',
      to: '1',
    },
    {
      id: 3,
      type: TraceNodeType.DOM,
      parent: 1,
      op: 'text',
      target: { selector: 'p.values' },
      from: '0',
      to: '2',
    },
  ],
};

// Generate the test using the real Avenx trace exporter.
const generated = generateTest(trace, {
  tracePath: './multiple-bindings.trace.json',
  componentName: 'MultipleBindings',
  componentPath: './multiple-bindings.component.js',
});

// Extract the assertions generated for the first click.
const caseBody = generated.match(
  /case 0: \{([\s\S]*?)\n\s*break;\s*\}/,
)?.[1];

assert.ok(
  caseBody,
  'exported test contains assertions for the recorded click',
);

// Both bindings contribute to the same DOM element.
// The actual text contains both values, not just one.
const app = {
  find(selector) {
    assert.equal(selector, 'p.values');

    return {
      textContent: '1 / 2',
    };
  },
};

// These assertions should pass when the element is correct.
// The current exporter incorrectly compares the whole text
// against each individual recorded binding value.
assert.doesNotThrow(
  () => vm.runInNewContext(caseBody, { app, assert }),
  'exported assertions must accept the complete text of an element with two bindings',
);

console.log(
  'PASS: exported assertions support multiple bindings in one element',
);
