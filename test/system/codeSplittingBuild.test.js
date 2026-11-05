import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import AvenxCompiler from '../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing Route-Level Code Splitting Build...');

const projects = [];

function cleanup() {
  for (const dir of projects) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
process.on('exit', cleanup);

function avenx(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-codesplit-'));
  projects.push(root);

  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  // Ensure node_modules/avenx-core points to repoRoot
  const nodeModulesDir = path.join(root, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  const symlinkPath = path.join(nodeModulesDir, 'avenx-core');
  try {
    fs.symlinkSync(repoRoot, symlinkPath, 'dir');
  } catch {
    // Ignore if symlink already exists
  }

  return root;
}

(async () => {
  // Test 1: Compiler directly with codeSplitting: true
  {
    const root = project({
      'avenx.config.json': JSON.stringify({
        codeSplitting: true,
      }),
      'src/pages/home.page.js': `<state title="Home" />
<div><h1>{{ title }}</h1></div>`,
      'src/pages/about.page.js': `<state description="About Us" />
<div><p>{{ description }}</p></div>`,
      'src/pages/dashboard.page.js': `<state count="0" />
<div><span>{{ count }}</span></div>`,
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
app.initRouter({
  '': 'Home',
  '#/about': 'About',
  '#/dashboard': 'Dashboard',
});
`,
    });

    const compiler = new AvenxCompiler({
      rootDir: root,
      srcDir: 'src',
      distDir: 'dist',
      codeSplitting: true,
    });

    compiler.build();
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/bundle.js')), true, 'bundle.js is generated');
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/pages/home.page.js')), true, 'dist/pages/home.page.js chunk is generated');
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/pages/about.page.js')), true, 'dist/pages/about.page.js chunk is generated');
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/pages/dashboard.page.js')), true, 'dist/pages/dashboard.page.js chunk is generated');

    const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf-8');

    // Verify bundle registers pages with dynamic import loaders
    assert.ok(/registerPage\(\s*["']Home["']\s*,\s*\(\)\s*=>\s*import\(\s*["']\.\/pages\/home\.page\.js["']\s*\)\s*\)/.test(bundle), 'Home is registered with async import loader');
    assert.ok(/registerPage\(\s*["']About["']\s*,\s*\(\)\s*=>\s*import\(\s*["']\.\/pages\/about\.page\.js["']\s*\)\s*\)/.test(bundle), 'About is registered with async import loader');
    assert.ok(/registerPage\(\s*["']Dashboard["']\s*,\s*\(\)\s*=>\s*import\(\s*["']\.\/pages\/dashboard\.page\.js["']\s*\)\s*\)/.test(bundle), 'Dashboard is registered with async import loader');

    // Verify page classes are split into their own chunks and NOT bundled inline in bundle.js
    assert.strictEqual(bundle.includes('class Home extends'), false, 'Home class is not bundled inline in bundle.js');
    assert.strictEqual(bundle.includes('class About extends'), false, 'About class is not bundled inline in bundle.js');
    assert.strictEqual(bundle.includes('class Dashboard extends'), false, 'Dashboard class is not bundled inline in bundle.js');

    // Verify page chunks contain their respective class definitions
    const homeChunk = fs.readFileSync(path.join(root, 'dist/pages/home.page.js'), 'utf-8');
    assert.ok(homeChunk.includes('class Home extends'), 'home chunk contains Home class');
    assert.ok(homeChunk.includes('export default Home'), 'home chunk exports default Home');

    const aboutChunk = fs.readFileSync(path.join(root, 'dist/pages/about.page.js'), 'utf-8');
    assert.ok(aboutChunk.includes('class About extends'), 'about chunk contains About class');
    assert.ok(aboutChunk.includes('export default About'), 'about chunk exports default About');

    // Test dynamic import of chunk works
    const importedHome = await import(path.join(root, 'dist/pages/home.page.js'));
    assert.ok(importedHome.default, 'Chunk exports default class');
    assert.strictEqual(typeof importedHome.default, 'function', 'Exported page is a class constructor');

    console.log('  ✅ Compiler generates separate chunks in dist/pages/ and registers async loaders');
  }

  // Test 2: CLI build with --code-splitting flag end-to-end
  {
    const root = project({
      'src/pages/welcome.page.js': '<div>Welcome</div>',
      'src/pages/help.page.js': '<div>Help</div>',
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
app.initRouter({ '': 'Welcome', '#/help': 'Help' });
`,
    });

    const build = avenx(['build', '--code-splitting'], root);
    assert.strictEqual(build.status, 0, `CLI avenx build --code-splitting succeeds:\n${build.output}`);

    assert.strictEqual(fs.existsSync(path.join(root, 'dist/bundle.js')), true);
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/pages/welcome.page.js')), true, 'dist/pages/welcome.page.js was generated');
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/pages/help.page.js')), true, 'dist/pages/help.page.js was generated');

    const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf-8');
    assert.ok(/registerPage\(\s*["']Welcome["']\s*,\s*\(\)\s*=>\s*import\(/.test(bundle), 'Welcome is registered via async loader');
    assert.ok(/registerPage\(\s*["']Help["']\s*,\s*\(\)\s*=>\s*import\(/.test(bundle), 'Help is registered via async loader');
    assert.strictEqual(bundle.includes('class Welcome extends'), false, 'Welcome is not in bundle.js');
    assert.strictEqual(bundle.includes('class Help extends'), false, 'Help is not in bundle.js');

    console.log('  ✅ CLI avenx build --code-splitting generates split page chunks');
  }

  // Test 3: avenx.config.json with codeSplitting: true
  {
    const root = project({
      'avenx.config.json': JSON.stringify({
        codeSplitting: true,
      }),
      'src/pages/home.page.js': '<div>Home</div>',
      'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
app.initRouter({ '': 'Home' });
`,
    });

    const build = avenx(['build'], root);
    assert.strictEqual(build.status, 0, `CLI build with codeSplitting in config succeeds:\n${build.output}`);
    assert.strictEqual(fs.existsSync(path.join(root, 'dist/pages/home.page.js')), true);

    const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf-8');
    assert.ok(/registerPage\(\s*["']Home["']\s*,\s*\(\)\s*=>\s*import\(/.test(bundle));
    assert.strictEqual(bundle.includes('class Home extends'), false);

    console.log('  ✅ avenx.config.json with codeSplitting: true is honored by avenx build');
  }

  console.log('🎉 All Route-Level Code Splitting Build tests passed!');
  cleanup();
})();
