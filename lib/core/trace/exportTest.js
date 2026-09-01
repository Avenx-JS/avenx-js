/**
 * @file exportTest.js
 * @description Turns a recorded trace into an executable regression test.
 *
 * This is the part of the feature that earns its keep. A causal view explains
 * a bug once; an exported test keeps it fixed. The step from "I reproduced it"
 * to "there is a test for it" is the expensive one on every team, and a trace
 * already contains everything that step needs: the inputs, the expected
 * observations, and the responses to replay instead of the network.
 *
 * The generated file is deliberately readable and deliberately editable. It is
 * a starting point a developer prunes — delete the assertions you do not care
 * about, keep the ones that describe the bug — not an opaque artifact.
 * @module lib/core/trace/exportTest
 */

import { TraceNodeType, Determinism, INPUT_TYPES, indexNodes } from './schema.js';
import { formatCaptured } from './capture.js';

/**
 * Escapes a value for embedding in generated source.
 * @param {any} value - The value.
 * @returns {string} A JavaScript literal.
 */
function literal(value) {
  return JSON.stringify(value);
}

/**
 * Collects the inputs replay will drive, with the observations each caused.
 * @param {object} trace - The trace.
 * @returns {object[]} One entry per input, in recorded order.
 */
function inputSteps(trace) {
  const byId = indexNodes(trace);
  const stepOf = new Map();
  const steps = [];

  for (const node of trace.nodes) {
    if (!INPUT_TYPES.has(node.type) || (node.parent !== null && node.parent !== undefined)) {
      continue;
    }
    if (node.type === TraceNodeType.RESOURCE && node.phase === 'settled') {
      continue;
    }
    stepOf.set(node.id, steps.length);
    steps.push({ index: steps.length, input: node, writes: [], dom: [], navigations: [] });
  }

  for (const node of trace.nodes) {
    let current = node;
    while (current && !stepOf.has(current.id)) {
      current = current.parent === null || current.parent === undefined ? null : byId.get(current.parent);
    }
    if (!current) {
      continue;
    }
    const step = steps[stepOf.get(current.id)];
    if (node.type === TraceNodeType.WRITE && node.to !== undefined) {
      step.writes.push(node);
    } else if (node.type === TraceNodeType.DOM && (node.op === 'text' || node.op === 'attr')) {
      step.dom.push(node);
    } else if (node.type === TraceNodeType.NAVIGATION && node !== current) {
      step.navigations.push(node);
    }
  }

  return steps;
}

/**
 * Describes an input in a comment.
 * @param {object} input - The input node.
 * @returns {string} A short label.
 */
function describe(input) {
  if (input.type === TraceNodeType.EVENT) {
    const target = input.target ? `<${input.target.selector}>` : '<unknown>';
    const value = input.value !== undefined ? ` with value ${literal(input.value)}` : '';
    return `${input.eventType} on ${target}${value}`;
  }
  if (input.type === TraceNodeType.NAVIGATION) {
    return `navigate to ${input.to}`;
  }
  return input.type;
}

/**
 * Builds the assertion lines for one step.
 *
 * Assertions come from the recorded DOM and state changes rather than from the
 * final state alone, so a generated test fails at the step that broke rather
 * than at the end.
 * @param {object} step - A step from {@link inputSteps}.
 * @param {boolean} redacted - Whether the trace withheld values.
 * @returns {string[]} Assertion source lines, already indented.
 */
function assertionsFor(step, redacted) {
  const lines = [];

  for (const dom of step.dom) {
    if (!dom.target || dom.to === null || dom.to === undefined) {
      continue;
    }
    if (redacted && typeof dom.to === 'string' && dom.to.includes('[redacted]')) {
      continue;
    }
    const selector = literal(dom.target.selector);
    const nth = dom.target.nth || 0;
    const finder = nth === 0 ? `find(${selector})` : `findAll(${selector})[${nth}]`;
    if (dom.op === 'text') {
      lines.push(
        `      // ${dom.target.selector} showed ${formatCaptured(dom.from)} before this step.`,
        `      assert.strictEqual(app.${finder}.textContent.trim(), ${literal(String(dom.to).trim())});`,
      );
    } else {
      lines.push(
        `      assert.strictEqual(app.${finder}.getAttribute(${literal(dom.name)}), ${literal(String(dom.to))});`,
      );
    }
  }

  if (lines.length === 0) {
    // A step with no assertable DOM change still deserves a line, so the
    // developer can see it happened and decide what to check.
    lines.push('      // No DOM change was recorded for this step.');
  }

  return lines;
}

/**
 * Generates the source of a regression test from a trace.
 * @param {object} trace - The trace to export.
 * @param {object} options - Generation options.
 * @param {string} options.tracePath - Import specifier for the trace JSON, relative to the test.
 * @param {string} [options.componentPath] - Import specifier for the component to mount.
 * @param {string} [options.componentName] - The component's class name, for comments.
 * @param {Array<{name: string, path: string}>} [options.bridges] - Bridges the component
 *   imports, with import specifiers relative to the generated test.
 * @param {string} [options.title] - The test's title.
 * @returns {string} The generated test source.
 */
export function generateTest(trace, options) {
  const steps = inputSteps(trace);
  const deterministic = (trace.determinism && trace.determinism.status) === Determinism.DETERMINISTIC;
  const title = options.title || `regression: ${trace.id}`;
  const redacted = !!trace.redacted;

  const lines = [];

  lines.push(
    '/**',
    ` * Regression test generated by \`avenx trace export ${trace.id}\`.`,
    ' *',
    ` * Recorded ${trace.createdAt || 'at an unknown time'}${trace.meta && trace.meta.url ? ` at ${trace.meta.url}` : ''}.`,
    ` * ${steps.length} recorded input${steps.length === 1 ? '' : 's'}.`,
    ' *',
    ' * replay() drives the recorded inputs back through the real framework and',
    ' * compares every state and DOM change against the recording. The assertions',
    ' * below are additional, and are yours to prune: keep the ones that describe',
    ' * the bug, delete the rest.',
  );

  if (!deterministic) {
    lines.push(
      ' *',
      ' * ⚠ This trace was recorded as best-effort, so replay may not reproduce it:',
    );
    for (const reason of (trace.determinism && trace.determinism.reasons) || []) {
      lines.push(` *   - ${reason.reason}${reason.detail ? `: ${reason.detail}` : ''}`);
    }
    lines.push(
      ' *   allowBestEffort is set below so this file runs, but the result will',
      ' *   never be reported as verified. Fix the source of non-determinism and',
      ' *   re-record for a test you can rely on.',
    );
  }

  if (redacted) {
    lines.push(
      ' *',
      ` * Redacted paths (${(trace.redactions || []).join(', ')}) were withheld at`,
      ' * record time, so no assertion below can check them.',
    );
  }

  lines.push(' */', '');

  lines.push(
    "import assert from 'assert';",
    "import { mountTestComponent, replay } from 'avenx-core/testing';",
  );
  if (options.componentPath) {
    lines.push("import { loadComponent } from 'avenx-core/tooling';");
  }

  // A component that imports a bridge compiles to a reference the bundle
  // supplies, so the test has to hand the real bridge instances in. Bridge
  // modules are ordinary ES modules, so they import normally.
  const bridges = options.bridges || [];
  for (const entry of bridges) {
    lines.push(`import ${entry.name} from ${literal(entry.path)};`);
  }

  lines.push(`import trace from ${literal(options.tracePath)} with { type: 'json' };`, '');

  if (options.componentPath) {
    const bridgeArg =
      bridges.length > 0 ? `,\n  { bridges: { ${bridges.map((entry) => entry.name).join(', ')} } },` : ',';
    lines.push(
      `const ${options.componentName || 'Component'} = loadComponent(`,
      `  new URL(${literal(options.componentPath)}, import.meta.url).pathname${bridgeArg}`,
      ');',
      '',
    );
  } else {
    lines.push(
      '// The recording did not identify a single component to mount. Replace this',
      '// with however your application is set up for tests.',
      '// const Component = loadComponent("../src/components/…/….component.js");',
      '',
    );
  }

  lines.push(`console.log(${literal(`🧪 ${title}`)});`, '');

  lines.push('let app;', '');
  lines.push('const result = await replay(trace, {');
  if (!deterministic) {
    lines.push('  // See the note above: this trace is best-effort.');
    lines.push('  allowBestEffort: true,');
  }
  lines.push('  async mount() {');
  if (options.componentPath) {
    lines.push(`    app = await mountTestComponent(${options.componentName || 'Component'}, {});`);
  } else {
    lines.push('    app = await mountTestComponent(Component, {});');
  }
  lines.push('    return app;', '  },');

  lines.push('  async at(step) {', '    switch (step.index) {');
  for (const step of steps) {
    lines.push(`      // Step ${step.index + 1}: ${describe(step.input)}`);
    lines.push(`      case ${step.index}: {`);
    for (const line of assertionsFor(step, redacted)) {
      lines.push(`  ${line}`);
    }
    lines.push('        break;', '      }');
  }
  lines.push('      default:', '        break;', '    }', '  },', '});', '');

  lines.push(
    '// replay() throws on divergence, so reaching here means every recorded state',
    '// and DOM change was reproduced exactly.',
    'assert.strictEqual(result.ok, true);',
  );
  if (deterministic) {
    lines.push(
      "assert.strictEqual(result.verified, true, 'a deterministic trace reproduced exactly');",
    );
  }

  const finalWrites = steps.flatMap((step) => step.writes);
  const lastWrite = finalWrites[finalWrites.length - 1];
  if (lastWrite && lastWrite.path && !String(lastWrite.to).includes('[redacted]')) {
    lines.push(
      '',
      `// Final recorded state: ${lastWrite.path} ended at ${formatCaptured(lastWrite.to)}.`,
    );
  }

  lines.push('', 'app.unmount();', `console.log(${literal(`✅ ${title}`)});`, '');

  return lines.join('\n');
}

/**
 * Suggests a file name stem for an exported trace.
 * @param {object} trace - The trace.
 * @returns {string} A kebab-case stem such as `cart-item-click`.
 */
export function suggestName(trace) {
  const nodes = trace.nodes || [];
  const component = nodes.find((node) => node.component);
  const input = nodes.find((node) => node.type === TraceNodeType.EVENT);

  const parts = [];
  if (component) {
    parts.push(
      String(component.component)
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase(),
    );
  }
  if (input && input.eventType) {
    parts.push(input.eventType);
  }
  if (parts.length === 0) {
    parts.push(String(trace.id || 'trace').replace(/[^a-z0-9]+/gi, '-'));
  }
  return parts.join('-').replace(/-+/g, '-');
}
