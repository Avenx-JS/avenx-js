import assert from 'assert';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';

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

  // 6. Test static duplicate ID attributes and looped static IDs
  console.log('  Testing warnings for duplicate and looped static ID attributes...');

  // Duplicate static IDs
  const warningsIdDup = captureWarnings(() => {
    cp.extractTemplate(
      '<div id="main-header"></div><span id="main-header"></span>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsIdDup.length, 1);
  assert.ok(warningsIdDup[0].includes('AVX_W30'));
  assert.ok(warningsIdDup[0].includes('main-header'));

  // Static ID inside loop
  const warningsIdLoop = captureWarnings(() => {
    cp.extractTemplate(
      '<@for item in items><div id="card-box">{{item}}</div></@for>',
      {},
      'MyComp',
      'my-component.js',
      { items: [] },
      {},
      {},
    );
  });
  assert.strictEqual(warningsIdLoop.length, 1);
  assert.ok(warningsIdLoop[0].includes('AVX_W30'));
  assert.ok(warningsIdLoop[0].includes('card-box'));

  // Dynamic IDs should NOT trigger warnings
  const warningsIdDynamic = captureWarnings(() => {
    cp.extractTemplate(
      '<@for item in items><div :id="\'card-\' + item.id">{{item}}</div></@for>',
      {},
      'MyComp',
      'my-component.js',
      { items: [] },
      {},
      {},
    );
  });
  assert.strictEqual(warningsIdDynamic.length, 0);

  // A static id only in a loop's <@empty> branch renders at most once
  const warningsIdEmpty = captureWarnings(() => {
    cp.extractTemplate(
      '<@for it in items><li>{{ it }}</li><@empty><li id="none">leer</li></@empty></@for>',
      {},
      'MyComp',
      'my-component.js',
      { items: [] },
      {},
      {},
    );
  });
  assert.strictEqual(warningsIdEmpty.length, 0);

  // Unique static IDs should NOT trigger warnings
  const warningsIdUnique = captureWarnings(() => {
    cp.extractTemplate(
      '<div id="header"></div><div id="footer"></div>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsIdUnique.length, 0);

  // 7. Name-valued directives should NOT trigger expression warnings
  console.log('  Testing name-valued directive validation...');

  const warningsRef = captureWarnings(() => {
    cp.extractTemplate(
      '<state a="1" /><div><input data-ax-ref="myInput" aria-label="Input" /><p>{{ a }}</p></div>',
      {},
      'MyComp',
      'my-component.js',
      { a: 1 },
      {},
      {},
    );
  });
  assert.strictEqual(warningsRef.length, 0);

  const warningsValidationRules = captureWarnings(() => {
    cp.extractTemplate(
      '<state email="" password="" /><div><input data-ax-bind="email" data-ax-validate="required|email" aria-label="Email" /><input data-ax-bind="password" data-ax-validate="required|min:8:Mindestens 8 Zeichen" aria-label="Password" /></div>',
      {},
      'MyComp',
      'my-component.js',
      { email: '', password: '' },
      {},
      {},
    );
  });
  assert.strictEqual(warningsValidationRules.length, 0);
  assert.ok(!warningsValidationRules.some((warning) => warning.includes('"required"')));
  assert.ok(!warningsValidationRules.some((warning) => warning.includes('"Mindestens"')));
  assert.ok(!warningsValidationRules.some((warning) => warning.includes('"Zeichen"')));

  // 8. Expression-valued directives should still trigger warnings
  console.log('  Testing expression-valued directive validation...');

  const warningsUndeclaredBind = captureWarnings(() => {
    cp.extractTemplate(
      '<input data-ax-bind="missingField" data-ax-validate="required|email" aria-label="Email" />',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsUndeclaredBind.length, 1);
  assert.ok(warningsUndeclaredBind[0].includes('AVX_W03'));
  assert.ok(warningsUndeclaredBind[0].includes('missingField'));

  const warningsKey = captureWarnings(() => {
    cp.extractTemplate(
      '<div data-ax-key="undeclaredKey"></div>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsKey.length, 1);
  assert.ok(warningsKey[0].includes('AVX_W03'));
  assert.ok(warningsKey[0].includes('undeclaredKey'));

  const warningsSameTemplate = captureWarnings(() => {
    cp.extractTemplate(
      '<input data-ax-ref="myInput" aria-label="Input" /><p>{{ undeclaredVar }}</p>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsSameTemplate.length, 1);
  assert.ok(warningsSameTemplate[0].includes('AVX_W03'));
  assert.ok(warningsSameTemplate[0].includes('undeclaredVar'));
  assert.ok(!warningsSameTemplate[0].includes('Undeclared variable or method "myInput"'));

  // 9. Test warning when .component.js is a JavaScript module instead of a template (#1517)
  console.log('  Testing warning on JavaScript module as component template (#1517)...');
  const warningsJsModule = captureWarnings(() => {
    cp.extractTemplate(
      "export const x = 1;export function hello() { return 'hi'; }",
      {},
      'HelpersComp',
      'helpers.component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsJsModule.length, 1);
  assert.ok(warningsJsModule[0].includes('AVX_W63'));
  assert.ok(warningsJsModule[0].includes('helpers.component.js'));
  assert.ok(warningsJsModule[0].includes('single-file component template was expected'));

  const warningsClassModule = captureWarnings(() => {
    cp.extractTemplate(
      'export default class T extends AvenxComponent { constructor() {} }',
      {},
      'ClassComp',
      'class-comp.component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsClassModule.length, 1);
  assert.ok(warningsClassModule[0].includes('AVX_W63'));

  // Negative tests: templates with import/export words in text/expressions or starting with markup
  const warningsNegative = captureWarnings(() => {
    cp.extractTemplate(
      '<div>Please import your file or export data: {{ isExport ? \'export\' : \'import\' }}</div>',
      {},
      'NormalComp',
      'normal.component.js',
      { isExport: true },
      {},
      {},
    );
  });
  assert.strictEqual(warningsNegative.length, 0);

  // Fallback scope tests for AVX_W03
  console.log('  Testing <@fallback> scope...');

  // Deadlock fallback: name and custom alias are in scope
  const warningsDeadlock = captureWarnings(() => {
    cp.extractTemplate(
      '<@deadlock name="a"><p>Body</p><@fallback as="err"><p>{{ name }} {{ err.message }}</p></@fallback></@deadlock>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsDeadlock.length, 0);

  // Deadlock fallback: default alias is error
  const warningsDefaultAlias = captureWarnings(() => {
    cp.extractTemplate(
      '<@deadlock name="a"><p>Body</p><@fallback><p>{{ name }} {{ error.message }}</p></@fallback></@deadlock>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsDefaultAlias.length, 0);

  // Undeclared variables inside a fallback must still warn
  const warningsMissing = captureWarnings(() => {
    cp.extractTemplate(
      '<@deadlock name="a"><@fallback as="err"><p>{{ err.message }} {{ missingInFallback }}</p></@fallback></@deadlock>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.strictEqual(warningsMissing.length, 1);
  assert.ok(warningsMissing[0].includes('missingInFallback'));

  // The fallback alias must not be available outside the fallback
  const warningsOutside = captureWarnings(() => {
    cp.extractTemplate(
      '<div>{{ err.message }}</div><@deadlock name="a"><@fallback as="err"><p>{{ err.message }}</p></@fallback></@deadlock>',
      {},
      'MyComp',
      'my-component.js',
      {},
      {},
      {},
    );
  });
  assert.ok(warningsOutside.some((warning) => warning.includes('"err"')));

  console.log('  ✅ Compile-time Static Validation tests passed!');
}

try {
  runTests();
} catch (e) {
  console.error('❌ Compile-time Static Validation tests failed!');
  console.error(e);
  process.exit(1);
}
