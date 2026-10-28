import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import avenxTemplateParser from '../../lib/core/tooling/avenxTemplateParser.js';
import { templateAccessibilityRule } from '../../lib/core/tooling/eslintAccessibility.js';

console.log('🧪 Testing ESLint templateAccessibilityRule...');

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.component.js', '**/*.page.js'],
      languageOptions: {
        parser: avenxTemplateParser,
      },
      plugins: {
        avenx: {
          rules: {
            'template-accessibility': templateAccessibilityRule,
          },
        },
      },
      rules: {
        'avenx/template-accessibility': 'warn',
      },
    },
  ],
});

async function lint(source) {
  return eslint.lintText(source, {
    filePath: 'src/components/test.component.js',
  });
}

// ----------------------------------------------------
// Test 1: Valid template without accessibility issues
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <img src="/logo.png" alt="Company Logo">
    <button type="button" @click="onClick()">Click me</button>
    <a href="/dashboard">Dashboard</a>
    <label for="name">Name</label>
    <input id="name" type="text">
    <div tabindex="0">Focusable</div>
</div>
`);

  assert.strictEqual(result.warningCount, 0);
  assert.strictEqual(result.errorCount, 0);
  console.log('  ✅ Valid accessible template passes cleanly');
}

// ----------------------------------------------------
// Test 2: Reports AVX_W65 for missing img alt
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <img src="/logo.png">
</div>
`);

  assert.strictEqual(result.warningCount, 1);
  assert.strictEqual(result.messages[0].ruleId, 'avenx/template-accessibility');
  assert.strictEqual(result.messages[0].messageId, 'missingImgAlt');
  console.log('  ✅ Reports missing img alt');
}

// ----------------------------------------------------
// Test 3: Reports AVX_W66 for interactive non-interactive element
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <div @click="toggleDetails()">Click</div>
</div>
`);

  assert.strictEqual(result.warningCount, 1);
  assert.strictEqual(result.messages[0].ruleId, 'avenx/template-accessibility');
  assert.strictEqual(result.messages[0].messageId, 'interactiveRole');
  console.log('  ✅ Reports non-interactive element with click handler');
}

// ----------------------------------------------------
// Test 4: Reports AVX_W67 for anchor without href
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <a @click="openDialog()">Open</a>
</div>
`);

  assert.strictEqual(result.warningCount, 1);
  assert.strictEqual(result.messages[0].ruleId, 'avenx/template-accessibility');
  assert.strictEqual(result.messages[0].messageId, 'missingAnchorHref');
  console.log('  ✅ Reports anchor without href');
}

// ----------------------------------------------------
// Test 5: Reports AVX_W68 for unlabelled form control
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <input type="text" name="email">
</div>
`);

  assert.strictEqual(result.warningCount, 1);
  assert.strictEqual(result.messages[0].ruleId, 'avenx/template-accessibility');
  assert.strictEqual(result.messages[0].messageId, 'unlabelledFormControl');
  console.log('  ✅ Reports unlabelled form control');
}

// ----------------------------------------------------
// Test 6: Reports AVX_W69 for empty button
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <button class="icon-trash"></button>
</div>
`);

  assert.strictEqual(result.warningCount, 1);
  assert.strictEqual(result.messages[0].ruleId, 'avenx/template-accessibility');
  assert.strictEqual(result.messages[0].messageId, 'buttonNoAccessibleName');
  console.log('  ✅ Reports button with no accessible name');
}

// ----------------------------------------------------
// Test 7: Reports AVX_W70 for positive tabindex
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <div tabindex="5">Disrupted tab order</div>
</div>
`);

  assert.strictEqual(result.warningCount, 1);
  assert.strictEqual(result.messages[0].ruleId, 'avenx/template-accessibility');
  assert.strictEqual(result.messages[0].messageId, 'positiveTabindex');
  console.log('  ✅ Reports positive tabindex');
}

// ----------------------------------------------------
// Test 8: Custom components and slots are ignored
// ----------------------------------------------------
{
  const [result] = await lint(`
<div>
    <CustomButton @click="toggle()" />
    <InputField name="username" />
    <UserProfileCard />
</div>
`);

  assert.strictEqual(result.warningCount, 0);
  assert.strictEqual(result.errorCount, 0);
  console.log('  ✅ Custom components are ignored by accessibility rules');
}

console.log('🎉 All ESLint templateAccessibilityRule tests passed!');
