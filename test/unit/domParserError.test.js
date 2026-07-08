const assert = require('assert');
const { DomPatcher } = require('../../lib/core/renderer/domPatch');
const { MockDOMElement, setupDOMMock, teardownDOMMock } = require('../helpers/dom-mock');

/**
 *
 */
function testDomParserErrorHandling() {
  console.log('🧪 Testing DOMParser error handling in DomPatcher...');

  setupDOMMock();

  try {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.join(' '));
    };

    try {
      // Mock DOMParser to simulate a parser error element
      global.DOMParser = class {
        /**
         *
         * @param htmlString
         */
        parseFromString() {
          const body = new MockDOMElement('body');
          const parserError = new MockDOMElement('parsererror');

          // Set textContent directly on the mock element
          parserError.textContent = 'XML Parsing Error: mismatched tag';

          body.appendChild(parserError);

          // Return a mock Document object with a querySelector method
          return {
            body,
            querySelector: (selector) => {
              if (selector === 'parsererror') {
                return parserError;
              }
              return null;
            },
          };
        }
      };

      const target = new MockDOMElement('div');
      const originalChild = new MockDOMElement('span');
      target.appendChild(originalChild);

      const patcher = new DomPatcher();

      // Perform patch with invalid HTML
      patcher.patch(target, '<div class="invalid"');

      // 1. Verify warning was logged containing the error code AVX_R13 and error details
      const hasParsingErrorWarning = warnings.some(
        (w) => w.includes('AVX_R13') && w.includes('XML Parsing Error: mismatched tag'),
      );
      assert.ok(hasParsingErrorWarning, 'Should log AVX_R13 parsing error warning with details');

      // 2. Verify target element children were NOT mutated (remained the same)
      assert.strictEqual(target.childNodes.length, 1, 'Target should still have 1 child');
      assert.strictEqual(target.childNodes[0], originalChild, 'Target child should not have changed');
    } finally {
      console.warn = originalWarn;
    }

    console.log('  ✅ DOMParser error handling test passed!');
  } finally {
    teardownDOMMock();
  }
}

try {
  testDomParserErrorHandling();
  console.log('✅ DOMParser Error Test successfully completed!');
  process.exit(0);
} catch (e) {
  console.error('❌ DOMParser Error Test failed!');
  console.error(e);
  process.exit(1);
}
