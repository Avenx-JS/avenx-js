const assert = require('assert');
const { DomPatcher } = require('../../lib/core/renderer/domPatch');
const { MockDOMElement, setupDOMMock, teardownDOMMock } = require('../helpers/dom-mock');

/**
 *
 */
async function testSvgNamespaceRendering() {
  console.log('🧪 Testing SVG namespace rendering in DomPatcher...');

  setupDOMMock();

  try {
    // We override DOMParser specifically for this test to simulate SVG nodes
    // parsed with the HTML namespace (as happens when DOMParser parses as text/html).
    global.DOMParser = class {
      /**
       *
       * @param htmlString
       */
      parseFromString() {
        // Return a tree structure: body -> svg -> circle
        const body = new MockDOMElement('body');
        const svg = new MockDOMElement('svg'); // Defaults to HTML namespace
        const circle = new MockDOMElement('circle'); // Defaults to HTML namespace

        svg.appendChild(circle);
        body.appendChild(svg);

        return { body };
      }
    };

    const target = new MockDOMElement('div');
    const patcher = new DomPatcher();

    // Perform patch
    patcher.patch(target, '<svg><circle></circle></svg>');

    // The target should now contain the SVG element
    assert.strictEqual(target.childNodes.length, 1, 'Target should have 1 child');
    const renderedSvg = target.childNodes[0];
    assert.strictEqual(renderedSvg.tagName, 'SVG');
    assert.strictEqual(
      renderedSvg.namespaceURI,
      'http://www.w3.org/2000/svg',
      'SVG element should be in SVG namespace',
    );

    // The SVG element should contain the circle element
    assert.strictEqual(renderedSvg.childNodes.length, 1, 'SVG should have 1 child');
    const renderedCircle = renderedSvg.childNodes[0];
    assert.strictEqual(renderedCircle.tagName, 'CIRCLE');
    assert.strictEqual(
      renderedCircle.namespaceURI,
      'http://www.w3.org/2000/svg',
      'Circle element should be in SVG namespace',
    );

    console.log('  ✅ SVG namespace rendering test passed!');
  } finally {
    teardownDOMMock();
  }
}

(async () => {
  try {
    await testSvgNamespaceRendering();
    console.log('✅ SVG Namespace Test successfully completed!');
    process.exit(0);
  } catch (e) {
    console.error('❌ SVG Namespace Test failed!');
    console.error(e);
    process.exit(1);
  }
})();
