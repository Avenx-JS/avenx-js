const assert = require('assert');
const StyleProcessor = require('../../lib/compiler/StyleProcessor');
const ComponentParser = require('../../lib/compiler/ComponentParser');

/**
 *
 */
function runTests() {
  console.log('🧪 Testing Compile-time Static Validation...');

  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  // Helper to capture console.warn messages during static validation
  /**
   *
   * @param fn
   */
  function captureWarnings(fn) {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => {
      warnings.push(msg);
    };
    try {
      fn();
    } finally {
      console.warn = originalWarn;
    }
    return warnings;
  }

  // 1. Test extractRootIdentifiers function
  console.log('  Testing cp.extractRootIdentifiers...');
  assert.deepStrictEqual(cp.extractRootIdentifiers('count'), ['count']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('count + 1'), ['count']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('user.name'), ['user']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('user?.profile?.age'), ['user']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('nonExistentMethod()'), ['nonExistentMethod']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('console.log("hello")'), ['console']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('active ? "yes" : "no"'), ['active']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('{ status: "active", count }'), ['count']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('active ? { x: 1 } : { y: foo }'), ['active', 'foo']);
  assert.deepStrictEqual(cp.extractRootIdentifiers('`hello ${name}`'), ['name']);

  // 2. Test warning on undeclared variables in interpolations
  console.log('  Testing warning on undeclared variables...');
  const warnings1 = captureWarnings(() => {
    cp.extractTemplate(
      '<div>{{ missingVar }} and {{ count }}</div>',
      {},
      'MyComp',
      'my-component.js',
      { count: 0 },
      {},
      {},
    );
  });
  assert.strictEqual(warnings1.length, 1);
  assert.ok(warnings1[0].includes('Undeclared variable or method "missingVar"'));

  // 3. Test warning on undeclared variables in event handlers
  const warnings2 = captureWarnings(() => {
    cp.extractTemplate(
      '<button @click="missingMethod(count)">Click</button>',
      {},
      'MyComp',
      'my-component.js',
      { count: 0 },
      {},
      {},
    );
  });
  assert.strictEqual(warnings2.length, 1);
  assert.ok(warnings2[0].includes('Undeclared variable or method "missingMethod"'));

  // 4. Test standard JS globals are ignored
  console.log('  Testing JS globals and special variables are ignored...');
  const warnings3 = captureWarnings(() => {
    cp.extractTemplate(
      '<div>{{ Math.round(price) }} - {{ console.log(props.title) }}</div>',
      {},
      'MyComp',
      'my-component.js',
      { price: 9.99 },
      {},
      {},
    );
  });
  assert.strictEqual(warnings3.length, 0);

  // 5. Test loop variables in <@for> loops
  console.log('  Testing loop variables scope in <@for> loops...');

  // Valid references
  const warnings4 = captureWarnings(() => {
    cp.extractTemplate(
      `<div>
                <@for item in items>
                    <span>{{ item.name }}</span>
                </@for>
            </div>`,
      {},
      'MyComp',
      'my-component.js',
      { items: [] },
      {},
      {},
    );
  });
  assert.strictEqual(warnings4.length, 0);

  // Undeclared loop list reference
  const warnings5 = captureWarnings(() => {
    cp.extractTemplate(
      `<div>
                <@for item in missingList>
                    <span>{{ item.name }}</span>
                </@for>
            </div>`,
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warnings5.length, 1);
  assert.ok(warnings5[0].includes('Undeclared variable or method "missingList"'));

  // Undeclared variable used inside loop (distinct from loop var)
  const warnings6 = captureWarnings(() => {
    cp.extractTemplate(
      `<div>
                <@for item in items>
                    <span>{{ item.name }} - {{ missingVar }}</span>
                </@for>
            </div>`,
      {},
      'MyComp',
      'my-component.js',
      { items: [] },
      {},
      {},
    );
  });
  assert.strictEqual(warnings6.length, 1);
  assert.ok(warnings6[0].includes('Undeclared variable or method "missingVar"'));

  console.log('  ✅ Compile-time Static Validation tests passed!');
}

try {
  runTests();
} catch (e) {
  console.error('❌ Compile-time Static Validation tests failed!');
  console.error(e);
  process.exit(1);
}
