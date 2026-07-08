const assert = require('assert');
const { AvenxError, AvenxErrorCodes, formatMessage } = require('../../lib/core/runtime/AvenxError');

/**
 *
 */
function testErrorFormatting() {
  console.log('🧪 Testing AvenxError class and formatting...');

  // Test base constructor
  const err = new AvenxError(AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND, '#missing-div');
  assert.ok(err instanceof Error, 'AvenxError should inherit from Error');
  assert.strictEqual(err.code, 'AVX_R01');
  assert.ok(err.message.includes('[AVX_R01]'), 'Should contain the error code');
  assert.ok(err.message.includes('#missing-div'), 'Should replace parameter {0}');

  // Test formatMessage utility
  const msg = formatMessage(AvenxErrorCodes.PAGE_NOT_FOUND, 'Home');
  assert.ok(msg.includes('[AVX_R02]'), 'Should contain error code');
  assert.ok(msg.includes('Home'), 'Should replace parameter {0}');

  console.log('  ✅ Error formatting tests passed!');
}

/**
 *
 */
function testAppErrorHandling() {
  console.log('🧪 Testing AvenxApp error throwing...');

  const mockElement = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    attributes: [],
    hasAttribute: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    replaceWith: () => {},
    childNodes: [],
  };

  // 1. Mocking document/window for DOM environment
  global.document = {
    querySelector: (selector) => {
      if (selector === '#app') return mockElement;
      return null;
    },
  };

  const { AvenxApp } = require('../../lib/core/runtime/AvenxApp');

  // Test missing mount target throws AVX_R01
  assert.throws(
    () => {
      new AvenxApp({ target: '#missing-app-element' });
    },
    (err) => {
      return err instanceof AvenxError && err.code === 'AVX_R01';
    },
    'Should throw AVX_R01 on missing target',
  );

  const app = new AvenxApp({ target: '#app' });

  // Test mounting unregistered page throws AVX_R02
  assert.throws(
    () => {
      app.mountPage('Dashboard');
    },
    (err) => {
      return err instanceof AvenxError && err.code === 'AVX_R02';
    },
    'Should throw AVX_R02 on unregistered page',
  );

  // Test mounting unregistered component throws AVX_R03
  assert.throws(
    () => {
      app.mount('Navbar');
    },
    (err) => {
      return err instanceof AvenxError && err.code === 'AVX_R03';
    },
    'Should throw AVX_R03 on unregistered component',
  );

  console.log('  ✅ AvenxApp error throwing tests passed!');
}

/**
 *
 */
function testCircularComputedWarning() {
  console.log('🧪 Testing circular computed warnings...');

  const mockElement = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    attributes: [],
    hasAttribute: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    replaceWith: () => {},
    childNodes: [],
  };

  global.document = {
    querySelector: () => mockElement,
    querySelectorAll: () => [],
  };

  global.DOMParser = class {
    /**
     *
     */
    parseFromString() {
      return { body: mockElement };
    }
  };
  global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

  const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');

  // Mock console.warn to capture circular computed warning
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };

  try {
    // Create component with circular computed property
    // computed 'a' evaluates 'this.state.a', which loops back to computed getter trap
    const comp = new AvenxComponent(
      {}, // initial state
      { a: 'this.state.a' }, // circular computed
      {}, // bridges
      '<div>{{ a }}</div>',
      {}, // methods
    );

    comp.__setMountTarget(mockElement);
    comp.update();

    // Verify circular computed warning with code AVX_R04 is captured
    const hasCircularWarning = warnings.some((w) => w.includes('AVX_R04'));
    assert.ok(hasCircularWarning, 'Should log AVX_R04 computed circular dependency warning');
  } finally {
    console.warn = originalWarn;
  }

  console.log('  ✅ Circular computed warning tests passed!');
}

try {
  testErrorFormatting();
  testAppErrorHandling();
  testCircularComputedWarning();
  console.log('✅ All error codes tests passed!');
} catch (error) {
  console.error('❌ Error codes tests failed!');
  console.error(error);
  process.exit(1);
}
