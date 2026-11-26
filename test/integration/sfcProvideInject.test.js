import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxError, AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { EXPRESSION_OPS } from '../../lib/core/expression/ops.js';

console.log('🧪 Testing SFC <provide> and <inject> Tags End-to-End Reactivity...');

import '../helpers/register-happy-dom.js';

const testRootElement = document.createElement('div');
testRootElement.id = 'app';
document.body.appendChild(testRootElement);

// Helper to evaluate compiled class from compiler output
function evalCompiledClass(code, className) {
  const cleanCode = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]*['"];?/g, '');
  const opNames = Object.keys(EXPRESSION_OPS);
  const opValues = Object.values(EXPRESSION_OPS);
  const factory = new Function(
    'AvenxComponent',
    'AvenxPage',
    'AvenxError',
    'AvenxErrorCodes',
    ...opNames,
    `${cleanCode}; return ${className};`,
  );
  return factory(AvenxComponent, AvenxPage, AvenxError, AvenxErrorCodes, ...opValues);
}

// ===========================================================================
// 2. Integration Tests
// ===========================================================================

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-pi-integ-'));
  try {
    const sp = new StyleProcessor();
    const cp = new ComponentParser(sp);

    function compileSource(source, name, isPage) {
      const filePath = path.join(scratch, `${name}.${isPage ? 'page' : 'component'}.js`);
      fs.writeFileSync(filePath, source);
      return cp.compileUnit(filePath, isPage ? 'page' : 'component');
    }

    // -----------------------------------------------------------------------
    // Test 1: Full Hierarchy Reactivity & Intermediate Component Render Shield
    // -----------------------------------------------------------------------
    console.log('  1. Provider SFC -> Intermediate Wrapper SFC -> Deep Consumer SFC reactivity...');

    let wrapperRenders = 0;

    const consumerSource = `
<inject>
  theme
  setTheme
</inject>
<div>
  <span class="theme-text">{{ theme }}</span>
  <button class="toggle-btn" @click="setTheme('light')">Toggle</button>
</div>
`;
    const consumerCode = compileSource(consumerSource, 'DeepConsumer', false);
    const DeepConsumer = evalCompiledClass(consumerCode, 'DeepConsumer');

    const wrapperSource = `
<div>
  <header>Intermediate Wrapper</header>
  <DeepConsumer data-avenx-comp="DeepConsumer" />
</div>
`;
    const wrapperCode = compileSource(wrapperSource, 'IntermediateWrapper', false);
    const RawWrapper = evalCompiledClass(wrapperCode, 'IntermediateWrapper');
    class IntermediateWrapper extends RawWrapper {
      runUpdate() {
        wrapperRenders++;
        super.runUpdate();
      }
    }

    const providerSource = `
<state theme="dark" />
<action name="setTheme">
  this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
</action>
<provide>
  theme
  setTheme
</provide>
<div>
  <IntermediateWrapper data-avenx-comp="IntermediateWrapper" />
</div>
`;
    const providerCode = compileSource(providerSource, 'RootPage', true);
    const RootPage = evalCompiledClass(providerCode, 'RootPage');

    const registry = new Map();
    registry.set('DeepConsumer', DeepConsumer);
    registry.set('IntermediateWrapper', IntermediateWrapper);

    testRootElement.innerHTML = '';
    const rootPage = new RootPage({}, registry);
    rootPage.mount(testRootElement);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Verify initial render
    const themeSpan = testRootElement.querySelector('.theme-text');
    assert.ok(themeSpan, 'theme text span is rendered in DOM');
    assert.strictEqual(themeSpan.textContent, 'dark', 'initial injected value rendered');

    // Reset render count after mount
    wrapperRenders = 0;

    // Mutate provider state directly via action
    rootPage.setTheme();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Assert consumer updated in DOM
    assert.strictEqual(themeSpan.textContent, 'light', 'consumer updated with new theme value');

    // EXPLICIT CHECK: Intermediate wrapper render count must NOT increment!
    assert.strictEqual(wrapperRenders, 0, 'intermediate wrapper was NOT re-rendered when provider state changed');

    // -----------------------------------------------------------------------
    // Test 2: Renaming Attribute Form (<inject currentTheme="theme" />)
    // -----------------------------------------------------------------------
    console.log('  2. Renaming attribute form reactivity (<inject currentTheme="theme" />)...');

    const renamedConsumerSource = `
<inject currentTheme="theme" />
<div>
  <span class="renamed-text">{{ currentTheme }}</span>
</div>
`;
    const renamedCode = compileSource(renamedConsumerSource, 'RenamedConsumer', false);
    const RenamedConsumer = evalCompiledClass(renamedCode, 'RenamedConsumer');

    const registry2 = new Map();
    registry2.set('RenamedConsumer', RenamedConsumer);

    const providerSource2 = `
<state theme="midnight" />
<provide theme />
<div>
  <RenamedConsumer data-avenx-comp="RenamedConsumer" />
</div>
`;
    const providerCode2 = compileSource(providerSource2, 'Provider2', true);
    const Provider2 = evalCompiledClass(providerCode2, 'Provider2');

    testRootElement.innerHTML = '';
    const page2 = new Provider2({}, registry2);
    page2.mount(testRootElement);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const renamedSpan = testRootElement.querySelector('.renamed-text');
    assert.ok(renamedSpan, 'renamed text span rendered');
    assert.strictEqual(renamedSpan.textContent, 'midnight', 'initial renamed value rendered');

    // Update provider state
    page2.state.theme = 'sunrise';
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(renamedSpan.textContent, 'sunrise', 'renamed local variable reactively updated');

    // -----------------------------------------------------------------------
    // Test 3: Missing Key Behavior
    // -----------------------------------------------------------------------
    console.log('  3. Missing key behavior (consumer injecting unprovided key does not throw)...');

    const orphanConsumerSource = `
<inject missingKey="theme" />
<div>
  <span class="orphan-text">{{ String(missingKey) }}</span>
</div>
`;
    const orphanCode = compileSource(orphanConsumerSource, 'OrphanConsumer', false);
    const OrphanConsumer = evalCompiledClass(orphanCode, 'OrphanConsumer');

    testRootElement.innerHTML = '';
    let orphanInstance;
    assert.doesNotThrow(() => {
      orphanInstance = new OrphanConsumer({}, {}, new Map());
      orphanInstance.mount(testRootElement);
    }, 'mounting consumer without provider does not throw');

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(orphanInstance.missingKey, undefined, 'unprovided injected key resolves to undefined');

    console.log('✅ SFC <provide> and <inject> Integration Tests successfully completed!');
  } catch (err) {
    console.error('❌ Integration test failed:', err);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
})();
