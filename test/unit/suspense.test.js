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
    // textContent excludes the contents of an inert <template>, so this fails
    // while the fallback is still unrendered markup rather than visible text.
    assert.strictEqual(container.textContent.includes('Loading users...'), true, 'Fallback should be visible text while pending');
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

  await t.test('Suspense only replaces its own subtree and preserves siblings in every state', async () => {
    const rawComponent = `
<state userId="1" />

<resource name="userData">
  return new Promise((resolve) => setTimeout(() => resolve({ name: 'Ada' }), 30));
</resource>

<div>
  <h1 id="header">Dashboard</h1>
  <@suspense>
    <@fallback><div id="loading">Loading…</div></@fallback>
    <div id="content">user: {{ userData.name }}</div>
  </@suspense>
  <footer id="foot">always visible</footer>
</div>
`;
    const tempSrcPath = path.join(tempDir, 'SuspenseSubtreeComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default SuspenseSubtreeComponent;`;
    const tmpPath = path.join(tempDir, 'SuspenseSubtreeComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);

    const { default: SuspenseSubtreeComponent } = await import(pathToFileURL(tmpPath).href);
    const container = document.createElement('div');
    const comp = new SuspenseSubtreeComponent();
    comp.mount(container);

    // Pending state: header and foot MUST be present alongside loading fallback
    assert.ok(container.querySelector('#header'), 'header must be present while pending');
    assert.ok(container.querySelector('#loading'), 'loading fallback must be present while pending');
    assert.strictEqual(container.querySelector('#content'), null, 'content must not be present while pending');
    assert.ok(container.querySelector('#foot'), 'foot must be present while pending');

    await new Promise((r) => setTimeout(r, 60));
    await comp.nextTick();

    // Resolved state: header and foot still present, loading gone, content rendered
    assert.ok(container.querySelector('#header'), 'header must be present when resolved');
    assert.strictEqual(container.querySelector('#loading'), null, 'loading fallback must be removed when resolved');
    assert.strictEqual(container.querySelector('#content')?.textContent, 'user: Ada');
    assert.ok(container.querySelector('#foot'), 'foot must be present when resolved');
  });

  await t.test('ErrorBoundary only replaces its own subtree and preserves siblings', async () => {
    const rawComponent = `
<resource name="failing">
  return Promise.reject(new Error('boom'));
</resource>

<div>
  <h1 id="header">Dashboard</h1>
  <@errorBoundary>
    <@fallback as="err"><div id="err">failed: {{ err.message }}</div></@fallback>
    <div id="content">{{ failing.name }}</div>
  </@errorBoundary>
  <footer id="foot">footer</footer>
</div>
`;
    const tempSrcPath = path.join(tempDir, 'ErrorSubtreeComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default ErrorSubtreeComponent;`;
    const tmpPath = path.join(tempDir, 'ErrorSubtreeComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);

    const { default: ErrorSubtreeComponent } = await import(pathToFileURL(tmpPath).href);
    const container = document.createElement('div');
    const comp = new ErrorSubtreeComponent();
    comp.mount(container);

    await new Promise((r) => setTimeout(r, 30));
    await comp.nextTick();

    assert.ok(container.querySelector('#header'), 'header must be present on rejection');
    assert.strictEqual(container.querySelector('#err')?.textContent, 'failed: boom');
    assert.strictEqual(container.querySelector('#content'), null, 'content must not be present on rejection');
    assert.ok(container.querySelector('#foot'), 'foot must be present on rejection');
  });

  await t.test('Two <@suspense> boundaries in one component are independent', async () => {
    const rawComponent = `
<resource name="fastRes">
  return Promise.resolve('FastReady');
</resource>
<resource name="slowRes">
  return new Promise((resolve) => setTimeout(() => resolve('SlowReady'), 40));
</resource>

<div>
  <h1 id="header">Dual Suspense</h1>
  <@suspense>
    <@fallback><div id="loading-1">Loading 1</div></@fallback>
    <div id="content-1">{{ fastRes }}</div>
  </@suspense>
  <div id="mid">middle</div>
  <@suspense>
    <@fallback><div id="loading-2">Loading 2</div></@fallback>
    <div id="content-2">{{ slowRes }}</div>
  </@suspense>
  <footer id="foot">end</footer>
</div>
`;
    const tempSrcPath = path.join(tempDir, 'DualSuspenseComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default DualSuspenseComponent;`;
    const tmpPath = path.join(tempDir, 'DualSuspenseComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);

    const { default: DualSuspenseComponent } = await import(pathToFileURL(tmpPath).href);
    const container = document.createElement('div');
    const comp = new DualSuspenseComponent();
    comp.mount(container);

    // Wait a tick so fastRes (resolved microtask) settles while slowRes (40ms) is still pending
    await new Promise((r) => setTimeout(r, 10));
    await comp.nextTick();

    assert.ok(container.querySelector('#header'), 'header present');
    assert.ok(container.querySelector('#mid'), 'middle sibling present');
    assert.ok(container.querySelector('#foot'), 'footer present');
    assert.strictEqual(container.querySelector('#content-1')?.textContent, 'FastReady', 'first boundary resolved independently');
    assert.strictEqual(container.querySelector('#loading-1'), null, 'first boundary fallback gone');
    assert.ok(container.querySelector('#loading-2'), 'second boundary still showing fallback');
    assert.strictEqual(container.querySelector('#content-2'), null, 'second boundary content not rendered yet');

    await new Promise((r) => setTimeout(r, 60));
    await comp.nextTick();

    assert.strictEqual(container.querySelector('#content-1')?.textContent, 'FastReady');
    assert.strictEqual(container.querySelector('#content-2')?.textContent, 'SlowReady');
    assert.strictEqual(container.querySelector('#loading-2'), null);
  });

  await t.test('Two <@errorBoundary> boundaries in one component are independent', async () => {
    const rawComponent = `
<resource name="okRes">
  return Promise.resolve('Healthy');
</resource>
<resource name="badRes">
  return Promise.reject(new Error('bad'));
</resource>

<div>
  <h1 id="header">Dual ErrorBoundary</h1>
  <@errorBoundary>
    <@fallback as="err"><div id="err-1">err1: {{ err.message }}</div></@fallback>
    <div id="ok-1">{{ okRes }}</div>
  </@errorBoundary>
  <@errorBoundary>
    <@fallback as="err"><div id="err-2">err2: {{ err.message }}</div></@fallback>
    <div id="bad-2">{{ badRes }}</div>
  </@errorBoundary>
  <footer id="foot">end</footer>
</div>
`;
    const tempSrcPath = path.join(tempDir, 'DualErrorComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default DualErrorComponent;`;
    const tmpPath = path.join(tempDir, 'DualErrorComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);

    const { default: DualErrorComponent } = await import(pathToFileURL(tmpPath).href);
    const container = document.createElement('div');
    const comp = new DualErrorComponent();
    comp.mount(container);

    await new Promise((r) => setTimeout(r, 30));
    await comp.nextTick();

    assert.ok(container.querySelector('#header'), 'header present');
    assert.strictEqual(container.querySelector('#ok-1')?.textContent, 'Healthy', 'healthy boundary unaffected');
    assert.strictEqual(container.querySelector('#err-1'), null);
    assert.strictEqual(container.querySelector('#err-2')?.textContent, 'err2: bad', 'failing boundary caught');
    assert.strictEqual(container.querySelector('#bad-2'), null);
    assert.ok(container.querySelector('#foot'), 'footer present');
  });

  await t.test('<@for> inside <@suspense> preserves siblings while pending and after resolving', async () => {
    const rawComponent = `
<resource name="items">
  return new Promise((resolve) => setTimeout(() => resolve(['X', 'Y']), 25));
</resource>

<div>
  <h1 id="header">List</h1>
  <@suspense>
    <@fallback><div id="loading">Loading list…</div></@fallback>
    <ul id="list">
      <@for item in items>
        <li>{{ item }}</li>
      </@for>
    </ul>
  </@suspense>
  <footer id="foot">bottom</footer>
</div>
`;
    const tempSrcPath = path.join(tempDir, 'SuspenseListSubtreeComponent.component.js');
    fs.writeFileSync(tempSrcPath, rawComponent);
    const parsedBody = compiler.compileComponent(tempSrcPath);
    const fullModuleCode = `${runtimeImportStatement('AvenxComponent', avenxComponentUrl, avenxRuntimeUrl)}\n${parsedBody}\nexport default SuspenseListSubtreeComponent;`;
    const tmpPath = path.join(tempDir, 'SuspenseListSubtreeComponentModule.js');
    fs.writeFileSync(tmpPath, fullModuleCode);

    const { default: SuspenseListSubtreeComponent } = await import(pathToFileURL(tmpPath).href);
    const container = document.createElement('div');
    const comp = new SuspenseListSubtreeComponent();
    comp.mount(container);

    assert.ok(container.querySelector('#header'), 'header present while list pending');
    assert.ok(container.querySelector('#loading'), 'loading fallback present while list pending');
    assert.ok(container.querySelector('#foot'), 'foot present while list pending');

    await new Promise((r) => setTimeout(r, 50));
    await comp.nextTick();

    assert.ok(container.querySelector('#header'), 'header present after list resolved');
    assert.strictEqual(container.querySelector('#loading'), null);
    assert.strictEqual(container.querySelectorAll('#list li').length, 2);
    assert.ok(container.querySelector('#foot'), 'foot present after list resolved');
  });
});
