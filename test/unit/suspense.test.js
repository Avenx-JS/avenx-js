import test from 'node:test';
import assert from 'node:assert';
import '../helpers/register-happy-dom.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import AvenxCompiler from '../../lib/compiler.js';
import { runtimeImportStatement } from '../../lib/core/tooling/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Suspense and Error Boundaries Integration', async (t) => {
  const compiler = new AvenxCompiler();
  const avenxComponentUrl = pathToFileURL(path.resolve('lib/core/runtime/AvenxComponent.js')).href;
  // The base class comes from its own module here, but the primitives the
  // compiled closures call live on the runtime index, so the framing needs both.
  const avenxRuntimeUrl = pathToFileURL(path.resolve('lib/core/index.js')).href;
  const tempDir = path.join(__dirname, 'temp_suspense_test');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  t.after(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Suspense correctly displays fallback then content', async () => {
    const rawComponent = `
<resource name="users">
  return new Promise((resolve) => setTimeout(() => resolve(['Alice', 'Bob']), 10));
</resource>

<@suspense>
  <@fallback>Loading users...</@fallback>
  <div id="users-list">
    <@for item in users>
      <span>{{ item }}</span>
    </@for>
  </div>
</@suspense>
`;
    const tempSrcPath = path.join(tempDir, 'SuspenseTestComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default SuspenseTestComponent;`;
    
    const tmpPath = path.join(tempDir, 'SuspenseTestComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);
    
    const module = await import(pathToFileURL(tmpPath).href);
    const SuspenseTestComponent = module.default;
    
    const container = document.createElement('div');
    const comp = new SuspenseTestComponent();
    comp.mount(container);
    
    // Initially should show fallback
    assert.strictEqual(container.innerHTML.includes('Loading users...'), true, 'Should render fallback immediately');
    assert.strictEqual(container.innerHTML.includes('Alice'), false, 'Should not render content yet');

    // Wait for promise to resolve
    await new Promise((r) => setTimeout(r, 40));

    // Wait for next tick so updates flush
    await comp.nextTick();
    
    // Now should show content
    assert.strictEqual(container.innerHTML.includes('Alice'), true, 'Should render resolved content');
    assert.strictEqual(container.innerHTML.includes('Bob'), true, 'Should render resolved content');
    assert.strictEqual(container.textContent.includes('Loading users...'), false, 'Fallback should be removed');
  });

  await t.test('Error Boundary correctly catches and displays error', async () => {
    const rawComponent = `
<resource name="failingData">
  return new Promise((resolve, reject) => setTimeout(() => reject(new Error('Network failure')), 10));
</resource>

<@errorBoundary>
  <@fallback as="err">Error: {{ err.message }}</@fallback>
  <div id="content">
    {{ failingData }}
  </div>
</@errorBoundary>
`;
    const tempSrcPath = path.join(tempDir, 'ErrorBoundaryTestComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default ErrorBoundaryTestComponent;`;
    
    const tmpPath = path.join(tempDir, 'ErrorBoundaryTestComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);
    
    const module = await import(pathToFileURL(tmpPath).href);
    const ErrorBoundaryTestComponent = module.default;
    
    const container = document.createElement('div');
    const comp = new ErrorBoundaryTestComponent();
    
    comp.mount(container);
    
    // Wait for promise to reject
    await new Promise((r) => setTimeout(r, 50));
    await comp.nextTick();
    
    assert.strictEqual(container.innerHTML.includes('Error: Network failure'), true, 'Should display error boundary fallback');
  });
});
