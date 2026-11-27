import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const binPath = path.join(repoRoot, 'bin/avenx.js');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-component-test-')));

function runAvenx(args) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

function snapshot(directory = root, files = {}) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) snapshot(file, files);
    else files[path.relative(root, file).replace(/\\/g, '/')] = fs.readFileSync(file).toString('hex');
  }
  return files;
}

try {
  console.log('🧪 Testing the generated component test...');

  assert.strictEqual(runAvenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(runAvenx(['generate', 'component', 'Widget']).status, 0, 'component generation should succeed');

  const generatedTest = path.join(root, 'src/components/widget/widget.component.test.js');
  const before = snapshot();
  for (const options of [[], ['--dry-run']]) {
    const missingTemplate = runAvenx(['g', 'test', 'Widget', '--template', 'ghost', ...options]);
    assert.strictEqual(missingTemplate.status, 1, missingTemplate.output);
    assert.match(missingTemplate.output, /No scaffold template named "ghost"/);
    assert.deepStrictEqual(snapshot(), before, 'an unknown template writes nothing');
  }
  const preview = runAvenx(['generate', 'test', 'Widget', '--dry-run']);
  assert.strictEqual(preview.status, 0, preview.output);
  assert.match(preview.output, /src\/components\/widget\/widget\.component\.test\.js/);
  assert.deepStrictEqual(snapshot(), before, 'a dry run writes nothing');

  const generated = runAvenx(['generate', 'test', 'Widget']);
  assert.strictEqual(generated.status, 0, generated.output);
  assert.match(generated.output, /src\/components\/widget\/widget\.component\.test\.js/);
  const after = snapshot();
  delete after['src/components/widget/widget.component.test.js'];
  assert.deepStrictEqual(after, before, 'only the test file is written');

  const header = fs.readFileSync(generatedTest, 'utf8');
  fs.writeFileSync(generatedTest, '// keep the existing test\n');
  const duplicate = runAvenx(['g', 'test', 'widget']);
  assert.strictEqual(duplicate.status, 1, duplicate.output);
  assert.match(duplicate.output, /already exists/);
  assert.strictEqual(fs.readFileSync(generatedTest, 'utf8'), '// keep the existing test\n');
  assert.strictEqual(runAvenx(['g', 'test', 'widget', '--force']).status, 0);
  assert.strictEqual(fs.readFileSync(generatedTest, 'utf8'), header, '--force replaces only the test');

  const missingBefore = snapshot();
  for (const args of [['test', 'Missing'], ['test', 'Missing', '--dry-run'], ['test'], ['test', '../Widget']]) {
    const missing = runAvenx(['generate', ...args]);
    assert.strictEqual(missing.status, 1, missing.output);
    if (args[1] === 'Missing') {
      assert.match(missing.output, /src\/components\/missing\/missing\.component\.js/);
    }
  }
  assert.deepStrictEqual(snapshot(), missingBefore, 'invalid and missing names write nothing');

  const automatic = runAvenx(['generate', 'component', 'Automatic', '--with-test']);
  assert.strictEqual(automatic.status, 0, automatic.output);
  const automaticTest = fs.readFileSync(
    path.join(root, 'src/components/automatic/automatic.component.test.js'),
    'utf8',
  );
  assert.match(automaticTest, /Current count: 1/, '--with-test keeps the scaffold assertions');

  // `generate test` is for a component that already has its own markup, so it
  // must not assert the scaffold's <h1>, count and button (#1978). This one,
  // like the routing layout's navbar, has no state and no events.
  const navbarDir = path.join(root, 'src/components/navbar');
  fs.mkdirSync(navbarDir, { recursive: true });
  fs.writeFileSync(
    path.join(navbarDir, 'navbar.component.js'),
    '<nav>\n  <a href="#/">Home</a>\n  <a href="#/about">About</a>\n</nav>\n',
  );
  assert.strictEqual(runAvenx(['g', 'test', 'navbar']).status, 0);
  const navbarTest = fs.readFileSync(path.join(navbarDir, 'navbar.component.test.js'), 'utf8');
  for (const scaffoldOnly of [/find\('h1'\)/, /Current count/, /findAll\('button'\)/]) {
    assert.doesNotMatch(header, scaffoldOnly, 'generate test must not assert the scaffold markup');
    assert.doesNotMatch(navbarTest, scaffoldOnly, 'generate test must not assert the scaffold markup');
  }
  assert.strictEqual(
    navbarTest.slice(0, navbarTest.indexOf('import ')),
    automaticTest.slice(0, automaticTest.indexOf('import ')),
    'both templates carry the same setup header',
  );

  assert.strictEqual(runAvenx(['g', 'component', 'CustomCard']).status, 0);
  const templates = path.join(root, '.avenxtemplates/component');
  fs.mkdirSync(path.join(templates, 'house'), { recursive: true });
  fs.writeFileSync(path.join(templates, 'component.test.js.template'), '{{PascalCaseName}} | {{name}} | {{file}}');
  fs.writeFileSync(path.join(templates, 'house/component.test.js.template'), 'house: {{PascalCaseName}} | {{file}}');
  const customFile = path.join(root, 'src/components/custom-card/custom-card.component.test.js');
  assert.strictEqual(runAvenx(['g', 'test', 'custom_card']).status, 0);
  assert.strictEqual(fs.readFileSync(customFile, 'utf8'), 'CustomCard | custom-card | custom-card');
  const customBefore = snapshot();
  assert.strictEqual(runAvenx(['g', 'test', 'CustomCard', '--template', 'house', '--force', '-d']).status, 0);
  assert.deepStrictEqual(snapshot(), customBefore, 'a named-template preview writes nothing');
  assert.strictEqual(runAvenx(['g', 'test', 'CustomCard', '-t', 'house', '-f']).status, 0);
  assert.strictEqual(fs.readFileSync(customFile, 'utf8'), 'house: CustomCard | custom-card');
  // This placeholder-only probe is not a runnable test; the two built-in scaffolds below are.
  fs.unlinkSync(customFile);

  // Set the project up from the file's own header, so the header is what is tested.
  // Packages are linked instead of installed: @avenx/vite is not on npm, and the test has no network.
  const nodeModules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(nodeModules, '@avenx'), { recursive: true });
  fs.symlinkSync(repoRoot, path.join(nodeModules, 'avenx-core'), 'junction');
  for (const pkg of header.match(/npm install -D (.+)/)[1].split(' ')) {
    const isVitePlugin = pkg === '@avenx/vite' || pkg.includes('avenx-vite-');
    const target = isVitePlugin ? path.join(repoRoot, 'plugins/avenx-vite') : path.join(repoRoot, 'node_modules', pkg);
    const linkPath = isVitePlugin ? path.join(nodeModules, '@avenx/vite') : path.join(nodeModules, pkg);
    if (fs.existsSync(target)) {
      fs.symlinkSync(target, linkPath, 'junction');
    }
  }
  // `\r?\n`: the template is checked out with CRLF on Windows, and the
  // generated file keeps the template's line endings.
  const [, config] = header.match(/vitest\.config\.js includes:\r?\n([\s\S]*?)\r?\n \* 3\. Run:/);
  fs.writeFileSync(path.join(root, 'vitest.config.js'), config.replace(/^ \*\s{6}/gm, ''));

  assert.match(header, /npx vitest run/, 'the header should name the Vitest run command');
  // Vitest resolves the environment from its own install, so the run alone would not catch this.
  assert.match(header, /npm install -D .*happy-dom/, 'the header should install the DOM package');
  assert.doesNotMatch(
    header,
    /npm install[^\n]*@avenx\/vite/,
    'the header must not instruct installing unpublished @avenx/vite from npm',
  );

  // Vitest 5 supports Node ^22.12 || ^24 || >=26, and CI also runs versions outside that range.
  const vitestBin = path.join(repoRoot, 'node_modules/vitest/vitest.mjs');
  const hasVitest = fs.existsSync(vitestBin);
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (!hasVitest) {
    console.log('Skipping the Vitest run: Vitest is not installed');
  } else if (nodeMajor === 24 || nodeMajor >= 26 || (nodeMajor === 22 && nodeMinor >= 12)) {
    const result = spawnSync(process.execPath, [vitestBin, 'run'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 120000,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    assert.strictEqual(result.status, 0, `the generated component test should pass:\n${output}`);
    // Widget and Navbar (generate test): 1 test each; Automatic (--with-test): 2.
    assert.match(output, /Test Files\s+3 passed/, `every generated test file should run and pass:\n${output}`);
    assert.match(output, /Tests\s+4 passed/, `both generation paths should produce runnable tests:\n${output}`);
    assert.doesNotMatch(output, /AVX_R(08|33|34)/, `the run should be free of render errors:\n${output}`);
    console.log('Generated component tests pass under Vitest as set up by the file header');
  } else {
    console.log(`Skipping the Vitest run: Vitest does not support Node ${process.versions.node}`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
