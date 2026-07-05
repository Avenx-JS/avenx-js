const assert = require('assert');
const { Sanitizer } = require('../../lib/core/security/sanitize');
const { MockDOMElement, setupDOMMock, teardownDOMMock } = require('../helpers/dom-mock');

function testSanitizerWithDOM() {
  console.log('🧪 Testing Sanitizer with DOMParser...');
  setupDOMMock();

  try {
    const sanitizer = new Sanitizer();

    // 1. Basic allowed tags and tag stripping
    const input1 = '<b>Hello</b><script>alert(1)</script>';
    const output1 = sanitizer.sanitize(input1);
    assert.strictEqual(output1, '<b>Hello</b>');

    // 2. Safe vs Unsafe attributes
    const input2 = '<a href="https://google.com" class="btn" onclick="run()">Link</a>';
    const output2 = sanitizer.sanitize(input2);
    assert.strictEqual(output2, '<a href="https://google.com" class="btn">Link</a>');

    // 3. Unsafe href protocols
    const input3 = '<a href="javascript:alert(1)">Bad Link</a>';
    assert.strictEqual(sanitizer.sanitize(input3), '<a>Bad Link</a>');

    const input4 = '<a href="  javascript:alert(1) ">Bad Link</a>';
    assert.strictEqual(sanitizer.sanitize(input4), '<a>Bad Link</a>');

    // 4. Safe image data URL vs unsafe link data URL
    const imgDataUrl = '<img src="data:image/png;base64,abc" alt="img"></img>';
    assert.strictEqual(sanitizer.sanitize(imgDataUrl), '<img src="data:image/png;base64,abc" alt="img" />');

    const linkDataUrl = '<a href="data:text/html,hello">Click</a>';
    assert.strictEqual(sanitizer.sanitize(linkDataUrl), '<a>Click</a>');

    // 5. Custom configuration
    const customSanitizer = new Sanitizer({
      allowedTags: ['custom-tag'],
      allowedAttributes: {
        'custom-tag': ['my-attr'],
      },
    });
    const customInput = '<custom-tag my-attr="foo" class="bar">Hello</custom-tag>';
    assert.strictEqual(customSanitizer.sanitize(customInput), '<custom-tag my-attr="foo">Hello</custom-tag>');

    // 6. Case normalization
    const upperInput = '<DIV CLASS="container">Test</DIV>';
    assert.strictEqual(sanitizer.sanitize(upperInput), '<div class="container">Test</div>');

    // 7. Manually constructed node trees to test void elements and special tags
    const container = new MockDOMElement('div');

    const brNode = new MockDOMElement('br');
    container.appendChild(brNode);

    const imgNode = new MockDOMElement('img');
    imgNode.setAttribute('src', 'http://example.com/pic.jpg');
    imgNode.setAttribute('onload', 'evil()');
    container.appendChild(imgNode);

    const scriptNode = new MockDOMElement('script');
    const textNode = {
      nodeType: 3,
      nodeName: '#text',
      textContent: 'alert("xss")',
    };
    scriptNode.appendChild(textNode);
    container.appendChild(scriptNode);

    const result = sanitizer._sanitizeNode(container);
    assert.strictEqual(result, '<br /><img src="http://example.com/pic.jpg" />');

    console.log('  ✅ Sanitizer with DOMParser tests passed!');
  } finally {
    teardownDOMMock();
  }
}

function testSanitizerFallback() {
  console.log('🧪 Testing Sanitizer Fallback (No DOM environment)...');

  // Ensure we are in a non-DOM environment
  const originalDOMParser = global.DOMParser;
  const originalDocument = global.document;
  delete global.DOMParser;
  delete global.document;

  try {
    const sanitizer = new Sanitizer();

    // 1. Fallback should strip HTML tags
    const input1 = '<div>Hello <b>World</b>! <script>alert(1)</script></div>';
    const output1 = sanitizer.sanitize(input1);
    assert.strictEqual(output1, 'Hello World! alert(1)');

    // 2. Coerces non-string inputs to string
    assert.strictEqual(sanitizer.sanitize(null), '');
    assert.strictEqual(sanitizer.sanitize(undefined), '');
    assert.strictEqual(sanitizer.sanitize(123), '123');

    console.log('  ✅ Sanitizer Fallback tests passed!');
  } finally {
    global.DOMParser = originalDOMParser;
    global.document = originalDocument;
  }
}

try {
  testSanitizerWithDOM();
  testSanitizerFallback();
  console.log('✅ All Sanitizer tests successfully completed!');
  process.exit(0);
} catch (error) {
  console.error('❌ Sanitizer tests failed!');
  console.error(error);
  process.exit(1);
}
