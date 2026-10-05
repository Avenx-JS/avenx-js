import assert from 'assert';
import { Sanitizer } from '../../lib/core/security/sanitize.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

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

function testCustomVoidTags() {
  console.log('🧪 Testing Sanitizer custom void tags...');
  setupDOMMock();

  try {
    // 1. Default void tags still self-close correctly
    const defaultSanitizer = new Sanitizer();
    const brContainer = new MockDOMElement('div');
    brContainer.appendChild(new MockDOMElement('br'));
    assert.strictEqual(defaultSanitizer._sanitizeNode(brContainer), '<br />');

    // 2. Custom void tag self-closes
    const customSanitizer = new Sanitizer({
      allowedTags: ['div', 'my-icon'],
      voidTags: ['my-icon'],
    });
    const iconContainer = new MockDOMElement('div');
    iconContainer.appendChild(new MockDOMElement('my-icon'));
    assert.strictEqual(customSanitizer._sanitizeNode(iconContainer), '<my-icon />');

    // 3. Mixed-case voidTags are normalized to lowercase
    const mixedCaseSanitizer = new Sanitizer({
      allowedTags: ['div', 'my-icon'],
      voidTags: ['My-Icon'],
    });
    const mixedContainer = new MockDOMElement('div');
    mixedContainer.appendChild(new MockDOMElement('my-icon'));
    assert.strictEqual(mixedCaseSanitizer._sanitizeNode(mixedContainer), '<my-icon />');

    // 4. No voidTags config — custom element gets closing tag (backward compat)
    const noVoidSanitizer = new Sanitizer({
      allowedTags: ['div', 'my-icon'],
    });
    const noVoidContainer = new MockDOMElement('div');
    noVoidContainer.appendChild(new MockDOMElement('my-icon'));
    assert.strictEqual(noVoidSanitizer._sanitizeNode(noVoidContainer), '<my-icon></my-icon>');

    console.log('  ✅ Custom void tags tests passed!');
  } finally {
    teardownDOMMock();
  }
}

function testSanitizeUrl() {
  console.log('🧪 Testing Sanitizer.sanitizeUrl pseudo-protocol protection...');

  // 1. Disallowed pseudo-protocols are replaced with about:blank
  assert.strictEqual(Sanitizer.sanitizeUrl('javascript:alert(1)'), 'about:blank');
  assert.strictEqual(Sanitizer.sanitizeUrl('JaVaScRiPt:alert(1)'), 'about:blank');
  assert.strictEqual(Sanitizer.sanitizeUrl('data:text/html,<script>alert(1)</script>'), 'about:blank');
  assert.strictEqual(Sanitizer.sanitizeUrl('vbscript:msgbox(1)'), 'about:blank');

  // 2. Leading whitespace is stripped before the scheme check
  assert.strictEqual(Sanitizer.sanitizeUrl('  javascript:alert(1)  '), 'about:blank');

  // 3. Allowed protocols pass through unchanged (trimmed)
  assert.strictEqual(Sanitizer.sanitizeUrl('https://example.com/path'), 'https://example.com/path');
  assert.strictEqual(Sanitizer.sanitizeUrl('  http://example.com  '), 'http://example.com');
  assert.strictEqual(Sanitizer.sanitizeUrl('mailto:user@example.com'), 'mailto:user@example.com');
  assert.strictEqual(Sanitizer.sanitizeUrl('tel:+1234567890'), 'tel:+1234567890');

  // 4. Relative URLs without a scheme are allowed
  assert.strictEqual(Sanitizer.sanitizeUrl('/relative/path'), '/relative/path');
  assert.strictEqual(Sanitizer.sanitizeUrl('#fragment'), '#fragment');
  assert.strictEqual(Sanitizer.sanitizeUrl('example.com'), 'example.com');

  // 5. Empty and nullish input returns about:blank
  assert.strictEqual(Sanitizer.sanitizeUrl(''), 'about:blank');
  assert.strictEqual(Sanitizer.sanitizeUrl('   '), 'about:blank');
  assert.strictEqual(Sanitizer.sanitizeUrl(null), 'about:blank');
  assert.strictEqual(Sanitizer.sanitizeUrl(undefined), 'about:blank');

  // 6. Custom allowed-protocol list
  assert.strictEqual(Sanitizer.sanitizeUrl('ftp://example.com', ['ftp:', 'https:']), 'ftp://example.com');
  assert.strictEqual(Sanitizer.sanitizeUrl('https://example.com', ['ftp:']), 'about:blank');

  console.log('  ✅ Sanitizer.sanitizeUrl tests passed!');
}

function testConfigurablePolicyOptions() {
  console.log('🧪 Testing Sanitizer configurable policy options...');
  setupDOMMock();

  try {
    // 1. disallowedTags filtering
    const banBoldSanitizer = new Sanitizer({
      disallowedTags: ['b', 'script'],
    });
    const html1 = '<p>Text</p><b>Bold</b><i>Italic</i>';
    assert.strictEqual(banBoldSanitizer.sanitize(html1), '<p>Text</p>Bold<i>Italic</i>');

    // 2. disallowedAttributes filtering
    const banStyleSanitizer = new Sanitizer({
      disallowedAttributes: { div: ['style', 'id'] },
    });
    const html2 = '<div id="main" class="box" style="color:red">Content</div>';
    assert.strictEqual(banStyleSanitizer.sanitize(html2), '<div class="box">Content</div>');

    // Global disallowedAttributes array syntax
    const banGlobalAttrSanitizer = new Sanitizer({
      disallowedAttributes: ['style', 'title'],
    });
    const html2b = '<p title="tooltip" class="text" style="margin:0">Paragraph</p>';
    assert.strictEqual(banGlobalAttrSanitizer.sanitize(html2b), '<p class="text">Paragraph</p>');

    // 3. stripComments option (true vs false)
    const stripCommentsSanitizer = new Sanitizer({ stripComments: true });
    const keepCommentsSanitizer = new Sanitizer({ stripComments: false });

    const commentContainer = new MockDOMElement('div');
    commentContainer.childNodes.push({ nodeType: 8, data: ' secret comment ' });

    assert.strictEqual(stripCommentsSanitizer._sanitizeNode(commentContainer), '');
    assert.strictEqual(keepCommentsSanitizer._sanitizeNode(commentContainer), '<!-- secret comment -->');

    // 4. stripContentTags option
    const customStripContentSanitizer = new Sanitizer({
      allowedTags: ['p', 'b'],
      stripContentTags: ['secret-tag'],
    });
    const html4 = '<p>Public</p><secret-tag>Hidden Secret Content</secret-tag><b>End</b>';
    assert.strictEqual(customStripContentSanitizer.sanitize(html4), '<p>Public</p><b>End</b>');

    // 5. allowDataUrls preference
    const noDataUrlSanitizer = new Sanitizer({ allowDataUrls: false });
    const imgContainer = new MockDOMElement('div');
    const imgNode = new MockDOMElement('img');
    imgNode.setAttribute('src', 'data:image/png;base64,abc');
    imgNode.setAttribute('alt', 'pic');
    imgContainer.appendChild(imgNode);
    assert.strictEqual(noDataUrlSanitizer._sanitizeNode(imgContainer), '<img alt="pic" />');

    console.log('  ✅ Configurable policy options tests passed!');
  } finally {
    teardownDOMMock();
  }
}

function testSanitizerWarningsUseLogger() {
  console.log('🧪 Testing sanitizer warnings use the shared logger...');

  const originalConfig = {
    ...logger.config,
    transports: Array.isArray(logger.config.transports) ? [...logger.config.transports] : logger.config.transports,
  };
  const originalConsoleWarn = console.warn;

  try {
    // The DOM path must respect silent logging instead of writing directly to console.warn.
    const rawWarnings = [];
    console.warn = (...args) => rawWarnings.push(args);
    logger.configure({ level: 'info', silent: true });

    const silentRoot = new MockDOMElement('div');
    silentRoot.appendChild(new MockDOMElement('script'));
    const silentLink = new MockDOMElement('a');
    silentLink.setAttribute('onclick', 'evil()');
    silentRoot.appendChild(silentLink);
    new Sanitizer()._sanitizeNode(silentRoot);

    assert.deepStrictEqual(rawWarnings, [], 'silent logging should suppress all DOM sanitizer warnings');

    // Sanitizer warnings must also flow through formatter and transport customization.
    const formattedWarnings = [];
    logger.configure({
      level: 'info',
      silent: false,
      formatter: (level, args) => [`[SANITIZER-${level}]`, ...args],
      transports: [
        {
          log(level, formattedArgs) {
            formattedWarnings.push({ level, formattedArgs });
          },
        },
      ],
    });

    const formattedRoot = new MockDOMElement('div');
    const disallowedTag = new MockDOMElement('marquee');
    formattedRoot.appendChild(disallowedTag);

    const allowedTag = new MockDOMElement('a');
    allowedTag.setAttribute('onclick', 'evil()');
    formattedRoot.appendChild(allowedTag);

    new Sanitizer()._sanitizeNode(formattedRoot);

    assert.ok(
      formattedWarnings.some(
        ({ level, formattedArgs }) =>
          level === 'warn' &&
          formattedArgs[0] === '[SANITIZER-warn]' &&
          formattedArgs.some((value) => String(value).includes('Sanitized tag')),
      ),
      'custom formatter should apply to sanitized-tag warnings',
    );
    assert.ok(
      formattedWarnings.some(
        ({ level, formattedArgs }) =>
          level === 'warn' &&
          formattedArgs[0] === '[SANITIZER-warn]' &&
          formattedArgs.some((value) => String(value).includes('Sanitized attribute')),
      ),
      'custom formatter should apply to sanitized-attribute warnings',
    );

    console.log('  ✅ Sanitizer warnings respect logger configuration');
  } finally {
    console.warn = originalConsoleWarn;
    logger.configure(originalConfig);
  }
}

function testStripTags() {
  console.log('🧪 Testing Sanitizer.stripTags static method...');

  assert.strictEqual(Sanitizer.stripTags('<p>Hello <b>World</b></p>'), 'Hello World');
  assert.strictEqual(Sanitizer.stripTags('<div>Hello <script>alert(1)</script> <b>World</b></div>'), 'Hello  World');
  assert.strictEqual(Sanitizer.stripTags('<!-- comment -->Plain text'), 'Plain text');
  assert.strictEqual(Sanitizer.stripTags('<style>body { color: red; }</style>Content'), 'Content');
  assert.strictEqual(Sanitizer.stripTags(null), '');
  assert.strictEqual(Sanitizer.stripTags(undefined), '');
  assert.strictEqual(Sanitizer.stripTags(123), '123');

  console.log('  ✅ Sanitizer.stripTags tests passed!');
}

try {
  testSanitizerWithDOM();
  testSanitizerFallback();
  testCustomVoidTags();
  testConfigurablePolicyOptions();
  testSanitizeUrl();
  testSanitizerWarningsUseLogger();
  testStripTags();
  console.log('✅ All Sanitizer tests successfully completed!');
  process.exit(0);
} catch (error) {
  console.error('❌ Sanitizer tests failed!');
  console.error(error);
  process.exit(1);
}
