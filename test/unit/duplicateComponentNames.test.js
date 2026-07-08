const assert = require('assert');
const path = require('path');
const fs = require('fs');
const AvenxCompiler = require('../../lib/compiler');

try {
  console.log('🧪 Testing AvenxCompiler duplicate component name detection...');

  const tempDir = path.join(__dirname, 'temp_compiler_duplicate_test_src');
  const compDir = path.join(tempDir, 'components');
  const sharedDir = path.join(compDir, 'shared');

  const cleanUp = () => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  cleanUp(); // in case a previous failed run left files behind

  const compiler = new AvenxCompiler();
  compiler.srcDir = tempDir; // override srcDir for testing

  // --- Case 1: duplicate class names in different directories should throw ---
  console.log('  Testing: duplicate component names across directories throws AVX_C03');

  const cardTemplate = `
    <state title="Card" />
    <div @css root>{{ title }}</div>
    <@css>
        root { padding: 8px; }
    </@css>
    `;

  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(compDir, 'card.component.js'), cardTemplate);
  fs.writeFileSync(path.join(sharedDir, 'card.component.js'), cardTemplate);

  assert.throws(
    () => compiler.processComponents(),
    (err) => {
      assert.ok(err instanceof Error, 'Should throw an Error instance');
      assert.ok(err.message.includes('AVX_C03'), 'Error should reference code AVX_C03');
      assert.ok(err.message.includes('Card'), 'Error should mention the conflicting class name "Card"');
      assert.ok(
        err.message.includes(path.join(compDir, 'card.component.js')),
        'Error should list the first conflicting file path',
      );
      assert.ok(
        err.message.includes(path.join(sharedDir, 'card.component.js')),
        'Error should list the second conflicting file path',
      );
      return true;
    },
    'processComponents() should throw when two files compile to the same class name',
  );

  // Clean up case 1 files before the next case
  fs.rmSync(compDir, { recursive: true, force: true });

  // --- Case 2: uniquely-named components should compile without throwing ---
  console.log('  Testing: unique component names compile without throwing');

  const profileCardTemplate = `
    <state title="Profile Card" />
    <div @css root>{{ title }}</div>
    <@css>
        root { padding: 12px; }
    </@css>
    `;

  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(compDir, 'card.component.js'), cardTemplate);
  fs.writeFileSync(path.join(sharedDir, 'profile-card.component.js'), profileCardTemplate);

  assert.doesNotThrow(() => {
    const result = compiler.processComponents();
    assert.ok(typeof result === 'string', 'processComponents() should return a string when names are unique');
  }, 'processComponents() should not throw when all component class names are unique');

  cleanUp();

  console.log('  ✅ AvenxCompiler duplicate component name tests passed!');
} catch (error) {
  console.error('❌ AvenxCompiler duplicate component name tests failed!');
  console.error(error);
  process.exit(1);
}
