/**
 * @file compilerUnhandledNode.test.js
 * @description Every template AST node type must have an explicit branch in
 * the static-subtree passes, and a node type that has none must stop the build.
 *
 * The check exists because a pass that quietly ignores a node kind it does not
 * recognise emits output that is structurally valid and wrong -- which is how
 * unhandled `<slot>` tags got through once already.
 *
 * The subtle part is not the throw, it is that it has to survive
 * `optimizeStaticSubtrees`. That method wraps the whole walk in a try/catch and
 * degrades to the unoptimized template on failure, because marking static
 * subtrees is an optimization and must never fail a build. An exhaustiveness
 * failure caught by that handler would be reported as AVX_W06 and swallowed,
 * leaving exactly the silence the check was added to remove -- so it is tested
 * here through the public entry point, not only against the private walker.
 */

import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('🧪 Testing exhaustiveness checks for AST node types in ComponentParser...');

const parser = new ComponentParser();

/**
 * Builds a node of a type no compiler pass handles.
 * @param {object} [loc] - Optional `{ line, column }` source position.
 * @returns {object} An AST node with an unhandled type.
 */
function unknownNode(loc) {
  return { type: 'cdata', tagName: 'cdata-block', children: [], ...(loc || {}) };
}

// --- the node type and its location are reported -------------------------
{
  let caught = null;
  try {
    parser.markStaticNodes([unknownNode({ line: 42, column: 15 })]);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'an unhandled node type must throw');
  assert.strictEqual(caught.code, AvenxErrorCodes.COMPILER_UNHANDLED_AST_NODE, 'it is raised as AVX_C30');
  assert.strictEqual(caught.name, 'CompilerError', 'it goes through the compiler error type, not a bare Error');
  assert.strictEqual(caught.line, 42, 'the line is attached to the error');
  assert.strictEqual(caught.column, 15, 'the column is attached to the error');
  assert.ok(caught.message.includes('"cdata"'), 'the message names the node type');
  assert.ok(caught.message.includes('line 42, column 15'), 'the message carries the location');
  assert.ok(caught.message.includes('markStaticNodes'), 'the message names the pass that could not read it');
  console.log('  ✅ an unhandled node type reports its type, location and pass');
}

// --- a node with no location still reports usefully -----------------------
{
  assert.throws(
    () => parser.markStaticNodes([{ type: 'processing-instruction', children: [] }]),
    (err) => {
      assert.ok(err.message.includes('"processing-instruction"'), `expected the type in: ${err.message}`);
      assert.ok(!err.message.includes('line undefined'), 'a missing location is omitted, not printed as undefined');
      return true;
    },
  );
  console.log('  ✅ a node without a location still names its type');
}

// --- isStaticNode has the same guard, reached through a child -------------
{
  // `isStaticNode` recurses into children on its own, so a nested unknown node
  // reaches its default branch rather than the one in `markStaticNodes`. It is
  // module-private, so a nested child is the only way to exercise it.
  const parent = { type: 'element', tagName: 'div', attrs: {}, children: [unknownNode({ line: 7, column: 3 })] };
  assert.throws(
    () => parser.markStaticNodes([parent]),
    (err) => {
      assert.strictEqual(err.code, AvenxErrorCodes.COMPILER_UNHANDLED_AST_NODE);
      assert.ok(err.message.includes('isStaticNode'), `expected isStaticNode in: ${err.message}`);
      assert.strictEqual(err.line, 7, 'the child node location is reported, not the parent one');
      return true;
    },
  );
  console.log('  ✅ isStaticNode guards its own walk and reports the offending child');
}

// --- the failure survives optimizeStaticSubtrees --------------------------
{
  // The point of the check is that a developer sees it. `optimizeStaticSubtrees`
  // swallows ordinary failures by design, so this asserts the exemption.
  const surfacing = new ComponentParser();
  surfacing.markStaticNodes = function markStaticNodesWithUnknownChild() {
    return ComponentParser.prototype.markStaticNodes.call(this, [unknownNode({ line: 3, column: 1 })]);
  };

  const warnings = [];
  const originalConfig = { ...logger.config };
  logger.configure({
    level: 'warn',
    silent: false,
    transports: [{ log: (level, formatted) => level === 'warn' && warnings.push(String(formatted[0])) }],
  });

  try {
    assert.throws(
      () => surfacing.optimizeStaticSubtrees('<div>x</div>'),
      (err) => err.code === AvenxErrorCodes.COMPILER_UNHANDLED_AST_NODE,
      'an exhaustiveness failure must not be swallowed by the optimization fallback',
    );
    assert.strictEqual(
      warnings.filter((w) => w.includes(AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED)).length,
      0,
      'it must not be downgraded to the AVX_W06 optimization warning',
    );
  } finally {
    logger.configure(originalConfig);
  }
  console.log('  ✅ an exhaustiveness failure escapes optimizeStaticSubtrees instead of becoming AVX_W06');
}

// --- an ordinary optimization failure still degrades quietly --------------
{
  const failing = new ComponentParser();
  failing.markStaticNodes = () => {
    throw new Error('something else went wrong');
  };

  const warnings = [];
  const originalConfig = { ...logger.config };
  logger.configure({
    level: 'warn',
    silent: false,
    transports: [{ log: (level, formatted) => level === 'warn' && warnings.push(String(formatted[0])) }],
  });

  let result;
  try {
    result = failing.optimizeStaticSubtrees('<div>x</div>');
  } finally {
    logger.configure(originalConfig);
  }

  assert.strictEqual(result, '<div>x</div>', 'an ordinary failure still returns the unoptimized template');
  assert.ok(
    warnings.some((w) => w.includes(AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED)),
    'and is still reported as AVX_W06',
  );
  console.log('  ✅ an ordinary optimization failure still degrades to the unoptimized template');
}

// --- the node types the parser actually produces are all handled ----------
{
  // Guards the other direction: the exhaustiveness check must not reject a
  // template built out of the node kinds `parseHTML` really emits.
  const template = '<div class="card"><!-- note --><p>hello</p><span>{{ value }}</span></div>';
  const optimized = parser.optimizeStaticSubtrees(template);

  assert.ok(optimized.includes('<!-- note -->'), 'comments survive the pass');
  assert.ok(optimized.includes('hello'), 'text survives the pass');
  assert.ok(optimized.includes('{{ value }}'), 'interpolations survive the pass');
  assert.ok(optimized.includes('data-ax-static="true"'), 'a static subtree is still marked');

  assert.doesNotThrow(() => {
    parser.markStaticNodes([
      { type: 'comment', content: ' a comment ', children: [] },
      { type: 'text', content: 'plain text', children: [] },
      {
        type: 'element',
        tagName: 'div',
        attrs: {},
        children: [{ type: 'text', content: 'hello', children: [] }],
      },
    ]);
  }, 'element, text and comment nodes pass without error');
  console.log('  ✅ every node type the parser produces is still handled');
}

console.log('✅ Exhaustiveness checks for unhandled AST node types passed!');
