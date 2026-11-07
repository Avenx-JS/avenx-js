import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const binPath = path.join(repoRoot, 'bin/avenx.js');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-component-test-')));

function runAvenx(args) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

try {
  console.log('🧪 Testing the generated component test...');

  assert.strictEqual(runAvenx(['init']).status, 0, 'init should succeed');
  assert.strictEqual(
    runAvenx(['generate', 'component', 'Widget', '--with-test']).status,
    0,
    'component generation should succeed',
  );

  const generatedTest = path.join(root, 'src/components/widget/widget.component.test.js');
  const header = fs.readFileSync(generatedTest, 'utf8');

  // Set the project up from the file's own header, so the header is what is tested.
  // Packages are linked instead of installed: @avenx/vite is not on npm, and the test has no network.
  const nodeModules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(nodeModules, '@avenx'), { recursive: true });
  fs.symlinkSync(repoRoot, path.join(nodeModules, 'avenx-core'), 'junction');
  for (const pkg of header.match(/npm install -D (.+)/)[1].split(' ')) {
    const target =
      pkg === '@avenx/vite'
        ? path.join(repoRoot, 'plugins/avenx-vite')
        : path.join(repoRoot, 'node_modules', pkg);
    if (fs.existsSync(target)) {
      fs.symlinkSync(target, path.join(nodeModules, pkg), 'junction');
    }
  }
  const [, config] = header.match(/vitest\.config\.js includes:\n([\s\S]*?)\n \* 3\. Run:/);
  fs.writeFileSync(path.join(root, 'vitest.config.js'), config.replace(/^ \*\s{6}/gm, ''));

  assert.match(header, /npx vitest run/, 'the header should name the Vitest run command');
  // Vitest resolves the environment from its own install, so the run alone would not catch this.
  assert.match(header, /npm install -D .*happy-dom/, 'the header should install the DOM package');

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
    assert.match(output, /Tests\s+2 passed/, `both generated tests should run:\n${output}`);
    assert.doesNotMatch(output, /AVX_R(08|33|34)/, `the run should be free of render errors:\n${output}`);
    console.log('Generated component tests pass under Vitest as set up by the file header');
  } else {
    console.log(`Skipping the Vitest run: Vitest does not support Node ${process.versions.node}`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
