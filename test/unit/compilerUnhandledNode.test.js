import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';

console.log('🧪 Testing exhaustiveness checks for AST node types in ComponentParser...');

const parser = new ComponentParser();

// 1. Unhandled node with location info in markStaticNodes
const unknownNodeWithLoc = {
  type: 'cdata',
  tagName: 'cdata-block',
  line: 42,
  column: 15,
  children: [],
};

assert.throws(
  () => {
    parser.markStaticNodes([unknownNodeWithLoc]);
  },
  (err) => {
    const hasType = err.message.includes('Unhandled AST node type "cdata"');
    const hasLine = err.message.includes('line 42');
    const hasCol = err.message.includes('column 15');
    assert.ok(hasType && hasLine && hasCol, `Expected message to contain type and location, got: ${err.message}`);
    return true;
  },
  'Should throw an error with type and location when encountering unhandled node in markStaticNodes'
);

// 2. Unhandled node without location info
const unknownNodeNoLoc = {
  type: 'processing-instruction',
  children: [],
};

assert.throws(
  () => {
    parser.markStaticNodes([unknownNodeNoLoc]);
  },
  (err) => {
    assert.ok(
      err.message.includes('Unhandled AST node type "processing-instruction"'),
      `Expected message to contain type, got: ${err.message}`
    );
    return true;
  },
  'Should throw an error with type when encountering unhandled node without location'
);

// 3. Valid node types (element, text, comment) pass without throwing
const standardNodes = [
  { type: 'comment', content: ' a comment ', children: [] },
  { type: 'text', content: 'plain text', children: [] },
  {
    type: 'element',
    tagName: 'div',
    attrs: {},
    children: [{ type: 'text', content: 'hello', children: [] }],
  },
];

assert.doesNotThrow(() => {
  parser.markStaticNodes(standardNodes);
}, 'Standard node types should pass without error');

console.log('✅ Exhaustiveness checks for unhandled AST node types passed!');
