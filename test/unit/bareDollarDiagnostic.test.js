import assert from 'assert';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { DIAGNOSTIC_CATALOGUE } from '../../lib/core/diagnostics/catalogue.js';
import {
  BARE_DOLLAR_HELPERS,
  THIS_ONLY_DOLLAR_MEMBERS,
} from '../../lib/core/runtime/componentHelpers.js';
import {
  formatDollarMemberSuggestion,
  validateActionBareDollarMembers,
  validateBareDollarMembers,
} from '../../lib/compiler/parser/validate.js';

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

function runTests() {
  console.log('🧪 Testing AVX_W71 Bare Dollar Diagnostic...');

  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  // 1. Error Code and Catalogue Registration
  console.log('  1. Checking error code and catalogue registration...');
  assert.strictEqual(AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER, 'AVX_W71');
  assert.ok(DIAGNOSTIC_CATALOGUE.AVX_W71, 'AVX_W71 must be in DIAGNOSTIC_CATALOGUE');
  assert.strictEqual(DIAGNOSTIC_CATALOGUE.AVX_W71.code, 'AVX_W71');
  assert.strictEqual(DIAGNOSTIC_CATALOGUE.AVX_W71.name, 'CompilerBareDollarMember');
  assert.strictEqual(DIAGNOSTIC_CATALOGUE.AVX_W71.severity, 'warning');

  // 2. formatDollarMemberSuggestion unit checks
  console.log('  2. Checking formatDollarMemberSuggestion...');
  for (const member of THIS_ONLY_DOLLAR_MEMBERS) {
    const suggestion = formatDollarMemberSuggestion(member);
    assert.strictEqual(suggestion, ` Use "this.${member}" instead.`);
  }
  assert.strictEqual(formatDollarMemberSuggestion('$ref'), ' Did you mean "$refs"?');
  assert.strictEqual(formatDollarMemberSuggestion('$emits'), ' Did you mean "$emit"?');
  assert.strictEqual(formatDollarMemberSuggestion('$destry'), ' Did you mean "this.$destroy"?');
  assert.strictEqual(formatDollarMemberSuggestion('$isMount'), ' Did you mean "this.$isMounted"?');
  assert.strictEqual(formatDollarMemberSuggestion('$totallyUnknown'), '');

  // 3. Action Body Diagnostics
  console.log('  3. Checking <action> bare dollar diagnostic...');
  const actionContent = `
<state count=0 />
<action name="cleanup">
  $destroy();
  this.$destroy();
  $ref.value = 1;
  $destry();
  $unknownHelper();
  $isMounted;
  $inspect();
  $emit("finished");
  const $local = 42;
  $local;
  obj.$foo();
</action>
<div>{{ count }}</div>
`;

  const actionWarnings = captureWarnings(() => {
    cp.extractMethods(actionContent, 'MyComponent', 'MyComponent.component.js');
  });

  assert.strictEqual(actionWarnings.length, 6, `Expected 6 warnings, got ${actionWarnings.length}`);
  // $destroy at line 4
  assert.ok(actionWarnings[0].includes('AVX_W71'));
  assert.ok(actionWarnings[0].includes('Bare identifier "$destroy" in action "cleanup" at line 4.'));
  assert.ok(actionWarnings[0].includes('Use "this.$destroy" instead.'));

  // $ref at line 6
  assert.ok(actionWarnings[1].includes('AVX_W71'));
  assert.ok(actionWarnings[1].includes('Bare identifier "$ref" in action "cleanup" at line 6.'));
  assert.ok(actionWarnings[1].includes('Did you mean "$refs"?'));

  // $destry at line 7
  assert.ok(actionWarnings[2].includes('AVX_W71'));
  assert.ok(actionWarnings[2].includes('Bare identifier "$destry" in action "cleanup" at line 7.'));
  assert.ok(actionWarnings[2].includes('Did you mean "this.$destroy"?'));

  // $unknownHelper at line 8
  assert.ok(actionWarnings[3].includes('AVX_W71'));
  assert.ok(actionWarnings[3].includes('Bare identifier "$unknownHelper" in action "cleanup" at line 8.'));
  assert.ok(!actionWarnings[3].includes('Did you mean'), 'unknown helper with no close match should not have suggestion');

  // $isMounted at line 9
  assert.ok(actionWarnings[4].includes('AVX_W71'));
  assert.ok(actionWarnings[4].includes('Bare identifier "$isMounted" in action "cleanup" at line 9.'));
  assert.ok(actionWarnings[4].includes('Use "this.$isMounted" instead.'));

  // $inspect at line 10
  assert.ok(actionWarnings[5].includes('AVX_W71'));
  assert.ok(actionWarnings[5].includes('Bare identifier "$inspect" in action "cleanup" at line 10.'));
  assert.ok(actionWarnings[5].includes('Use "this.$inspect" instead.'));

  // 4. Injected $ Helpers in Actions must NOT trigger warnings
  console.log('  4. Checking all bare injected $ helpers pass cleanly in actions...');
  const allBareActionContent = `
<state count=0 />
<action name="testHelpers">
  $route.path;
  $router.push("/next");
  $emit("ping");
  $watch(() => count, () => {});
  $watchEffect(() => {});
  $nextTick(() => {});
  $refs.input.focus();
  $element.focus();
  $slots.default;
  $app.title;
</action>
<div>{{ count }}</div>
`;

  const cleanActionWarnings = captureWarnings(() => {
    cp.extractMethods(allBareActionContent, 'TestHelpers', 'TestHelpers.component.js');
  });
  assert.strictEqual(cleanActionWarnings.length, 0, `Expected 0 warnings, got: ${cleanActionWarnings.join('\n')}`);
  for (const helper of BARE_DOLLAR_HELPERS) {
    assert.ok(allBareActionContent.includes(helper), `${helper} must have action coverage`);
  }

  const templateGlobalWarnings = captureWarnings(() => {
    const warnings = validateActionBareDollarMembers(
      '<action name="onMount">$i18n.on("change", () => {});</action>',
      'I18n.component.js',
      'I18n',
      { templateGlobals: ['$i18n'] },
    );
    assert.strictEqual(warnings.length, 0, 'configured templateGlobals must be accepted in actions');
  });
  assert.strictEqual(templateGlobalWarnings.length, 0, '$i18n must not emit AVX_W71 when configured');

  // 5. Template Expressions Diagnostics
  console.log('  5. Checking template bare dollar diagnostic...');
  const templateContent = `
<state count=0 />
<template>
  <div>{{ $destroy() }}</div>
  <div>{{ $ref }}</div>
  <@if $isMounted>
    <span>Mounted</span>
  </@if>
  <button @click="$destroy()">Destroy</button>
  <button @click="this.$destroy()">Safe Destroy</button>
  <button @click="$refs.btn.focus()">Safe Ref</button>
  <button @click="$emit('done')">Safe Emit</button>
</template>
`;

  const templateWarnings = captureWarnings(() => {
    cp.extractTemplate(
      templateContent,
      {},
      'TemplateComp',
      'TemplateComp.component.js',
      { count: 0 },
      {},
      {},
      {},
      [],
      templateContent,
    );
  });

  assert.strictEqual(templateWarnings.length, 4, `Expected 4 template warnings, got ${templateWarnings.length}`);
  // {{ $destroy() }} at line 4
  assert.ok(templateWarnings[0].includes('AVX_W71'));
  assert.ok(templateWarnings[0].includes('Bare identifier "$destroy" in template of TemplateComp.component.js at line 4.'));
  assert.ok(templateWarnings[0].includes('Use "this.$destroy" instead.'));

  // {{ $ref }} at line 5
  assert.ok(templateWarnings[1].includes('AVX_W71'));
  assert.ok(templateWarnings[1].includes('Bare identifier "$ref" in template of TemplateComp.component.js at line 5.'));
  assert.ok(templateWarnings[1].includes('Did you mean "$refs"?'));

  // <@if $isMounted> at line 6
  assert.ok(templateWarnings[2].includes('AVX_W71'));
  assert.ok(templateWarnings[2].includes('Bare identifier "$isMounted" in template of TemplateComp.component.js at line 6.'));
  assert.ok(templateWarnings[2].includes('Use "this.$isMounted" instead.'));

  // @click="$destroy()" at line 9
  assert.ok(templateWarnings[3].includes('AVX_W71'));
  assert.ok(templateWarnings[3].includes('Bare identifier "$destroy" in template of TemplateComp.component.js at line 9.'));
  assert.ok(templateWarnings[3].includes('Use "this.$destroy" instead.'));

  // 6. Template Expressions with all bare injected helpers must NOT trigger warnings or AVX_W03
  console.log('  6. Checking all bare injected $ helpers pass cleanly in template...');
  const cleanTemplate = `
<state count=0 />
<template>
  <div>{{ $route.path }}</div>
  <div>{{ $router.mode }}</div>
  <div>{{ $element ? "hasElem" : "noElem" }}</div>
  <div>{{ $refs ? "hasRefs" : "noRefs" }}</div>
  <div>{{ $slots ? "hasSlots" : "noSlots" }}</div>
  <div>{{ $app ? "hasApp" : "noApp" }}</div>
  <button @click="$emit('save')">Emit</button>
  <button @click="$watch('count', () => {})">Watch</button>
  <button @click="$watchEffect(() => {})">WatchEffect</button>
  <button @click="$nextTick(() => {})">NextTick</button>
</template>
`;

  const cleanTemplateWarnings = captureWarnings(() => {
    cp.extractTemplate(
      cleanTemplate,
      {},
      'CleanComp',
      'CleanComp.component.js',
      { count: 0 },
      {},
      {},
      {},
      [],
      cleanTemplate,
    );
  });
  assert.strictEqual(cleanTemplateWarnings.length, 0, `Expected 0 warnings, got: ${cleanTemplateWarnings.join('\n')}`);

  // 7. Suppressing AVX_W71 in config
  console.log('  7. Checking AVX_W71 suppression in config...');
  const suppressedCp = new ComponentParser(sp);
  suppressedCp.config = { warnings: { AVX_W71: 'off' } };

  const suppressedWarnings = captureWarnings(() => {
    const methods = suppressedCp.extractMethods(actionContent, 'Suppressed', 'Suppressed.component.js', suppressedCp.config);
    suppressedCp.extractTemplate(
      templateContent,
      {},
      'Suppressed',
      'Suppressed.component.js',
      { count: 0 },
      {},
      methods,
      {},
      [],
      templateContent,
    );
  });
  assert.strictEqual(suppressedWarnings.length, 0, 'AVX_W71 warnings must be suppressed when configured "off"');

  // 8. validateBareDollarMembers helper
  console.log('  8. Checking validateBareDollarMembers helper...');
  let helperWarnings;
  captureWarnings(() => {
    helperWarnings = validateBareDollarMembers(actionContent, null, 'MyComponent.component.js', 'MyComponent');
  });
  assert.strictEqual(helperWarnings.length, 6);
  assert.strictEqual(helperWarnings[0].code, 'AVX_W71');

  console.log('✅ All AVX_W71 bare dollar diagnostic tests passed!');
}

runTests();
