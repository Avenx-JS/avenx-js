import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { execSync, spawnSync } from 'child_process';

const TEST_DIR = path.join(__dirname, 'test-project');
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

/**
 *
 * @param {string[]} args
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function runCli(args) {
  return spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: TEST_DIR,
    encoding: 'utf8',
  });
}

/**
 *
 */
function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR);
}

/**
 *
 */
function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

/**
 *
 */
function runTest() {
  console.log('🧪 Testing avenx init...');

  try {
    setup();

    // Run the init command in the test directory
    execSync(`node ${BIN_PATH} init`, { cwd: TEST_DIR });

    // Assertions
    const expectedPaths = [
      'src/components',
      'src/global',
      'dist',
      '.vscode',
      '.vscode/jsconfig.json',
      '.vscode/settings.json',
      'index.html',
      'src/main.app.js',
    ];

    expectedPaths.forEach((p) => {
      const fullPath = path.join(TEST_DIR, p);
      assert.ok(fs.existsSync(fullPath), `Missing expected path: ${p}`);
      console.log(`  ✅ Found: ${p}`);
    });

    // Verify content of a template file
    const settings = JSON.parse(fs.readFileSync(path.join(TEST_DIR, '.vscode/settings.json'), 'utf-8'));

    assert.ok(settings['files.associations'], 'settings.json should have files.associations');

    assert.strictEqual(
      settings['files.associations']['*.component.js'],
      'html',
      'Association for *.component.js should be html',
    );

    console.log('✅ All init tests passed!');

    console.log('🧪 Testing avenx build...');

    const buildOutput = execSync(`node ${BIN_PATH} build 2>&1`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });

    const bundleJsPath = path.join(TEST_DIR, 'dist/bundle.js');

    const bundleCssPath = path.join(TEST_DIR, 'dist/bundle.css');

    assert.ok(fs.existsSync(bundleJsPath), 'Missing bundle.js');

    assert.ok(fs.existsSync(bundleCssPath), 'Missing bundle.css');

    const bundleContent = fs.readFileSync(bundleJsPath, 'utf-8');

    assert.ok(bundleContent.includes('HtmlEscaper'), 'bundle.js should contain HtmlEscaper');

    assert.ok(bundleContent.includes('SafeHtml'), 'bundle.js should contain SafeHtml');

    assert.ok(bundleContent.includes('html'), 'bundle.js should contain html function');

    assert.match(buildOutput, /Asset sizes:/, 'prints asset size');

    assert.match(buildOutput, /bundle\.js: \d+\.\d{2} KB/, 'prints bundle.js asset size');

    assert.match(
      buildOutput,
      /WARNING: bundle\.js exceeds 50 KB \(\d+\.\d{2} KB\)/,
      'warns when bundle.js exceeds threshold',
    );

    assert.match(buildOutput, /bundle\.css: \d+\.\d{2} KB/, 'prints bundle.css size');

    console.log('🧪 Testing custom output bundle name...');

    fs.writeFileSync(path.join(TEST_DIR, 'avenx.config.json'), JSON.stringify({ outputName: 'app' }));

    const customBuildOutput = execSync(`node ${BIN_PATH} build 2>&1`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });

    const customJsPath = path.join(TEST_DIR, 'dist/app.js');

    const customCssPath = path.join(TEST_DIR, 'dist/app.css');

    assert.ok(fs.existsSync(customJsPath), 'Missing app.js when outputName is configured');

    assert.ok(fs.existsSync(customCssPath), 'Missing app.css when outputName is configured');

    assert.match(customBuildOutput, /app\.js: \d+\.\d{2} KB/, 'prints custom app.js asset size');

    assert.match(customBuildOutput, /app\.css: \d+\.\d{2} KB/, 'prints custom app.css asset size');

    console.log('✅ Custom output bundle name tests passed!');

    // Remove custom config so remaining tests use default bundle names
    fs.rmSync(path.join(TEST_DIR, 'avenx.config.json'), { force: true });

    console.log('✅ All build tests passed!');

    console.log('🧪 Testing avenx generate component with global template...');

    execSync(`node ${BIN_PATH} generate component default-box`, { cwd: TEST_DIR });

    const defaultBoxJs = fs.readFileSync(
      path.join(TEST_DIR, 'src/components/default-box/default-box.component.js'),
      'utf-8',
    );

    assert.ok(defaultBoxJs.includes('DefaultBox Component'), 'Should contain default title');

    const duplicateComponentResult = runCli(['generate', 'component', 'default-box']);

    assert.strictEqual(duplicateComponentResult.status, 1, 'Duplicate component generation should fail');

    assert.match(
      duplicateComponentResult.stderr,
      /Component 'default-box' already exists/,
      'Duplicate component generation should explain the existing path',
    );

    assert.strictEqual(
      fs.readFileSync(path.join(TEST_DIR, 'src/components/default-box/default-box.component.js'), 'utf-8'),
      defaultBoxJs,
      'Duplicate component generation should not overwrite existing component files',
    );

    console.log('🧪 Testing avenx generate component with camelCase name...');

    execSync(`node ${BIN_PATH} generate component UserProfile`, { cwd: TEST_DIR });

    const userProfileJs = fs.readFileSync(
      path.join(TEST_DIR, 'src/components/user-profile/user-profile.component.js'),
      'utf-8',
    );

    assert.ok(userProfileJs.includes('UserProfile Component'), 'Should replace template name with camelCase preserved');

    // Run build to verify compiling works and produces the correct class name
    execSync(`node ${BIN_PATH} build`, { cwd: TEST_DIR });

    const newBundleContent = fs.readFileSync(path.join(TEST_DIR, 'dist/bundle.js'), 'utf-8');

    assert.ok(
      newBundleContent.includes('class UserProfile extends AvenxComponent'),
      'Compiled bundle should contain correct class name for camelCase component',
    );

    console.log('🧪 Testing avenx generate component with custom project-level templates...');

    // Create local templates folder
    const localTemplatesDir = path.join(TEST_DIR, '.avenxtemplates');

    fs.mkdirSync(localTemplatesDir, {
      recursive: true,
    });

    // Test flat custom template file
    fs.writeFileSync(
      path.join(localTemplatesDir, 'component.js.template'),
      '// CUSTOM FLAT TEMPLATE\nclass {{ name }} extends AvenxComponent {}',
    );

    fs.writeFileSync(path.join(localTemplatesDir, 'component.css.template'), '/* CUSTOM FLAT CSS */');

    execSync(`node ${BIN_PATH} generate component custom-flat-box`, { cwd: TEST_DIR });

    const customFlatBoxJs = fs.readFileSync(
      path.join(TEST_DIR, 'src/components/custom-flat-box/custom-flat-box.component.js'),
      'utf-8',
    );

    const customFlatBoxCss = fs.readFileSync(
      path.join(TEST_DIR, 'src/components/custom-flat-box/custom-flat-box.component.css'),
      'utf-8',
    );

    assert.ok(customFlatBoxJs.includes('// CUSTOM FLAT TEMPLATE'), 'Should use custom flat JS template');

    assert.ok(
      customFlatBoxJs.includes('class CustomFlatBox extends AvenxComponent'),
      'Should replace template variables correctly',
    );

    assert.strictEqual(customFlatBoxCss.trim(), '/* CUSTOM FLAT CSS */', 'Should use custom flat CSS template');

    // Test structured custom template file
    const structuredCompDir = path.join(localTemplatesDir, 'component');

    fs.mkdirSync(structuredCompDir, {
      recursive: true,
    });

    fs.writeFileSync(
      path.join(structuredCompDir, 'component.js.template'),
      '// CUSTOM STRUCTURED TEMPLATE\nclass {{ name }} extends AvenxComponent {}',
    );

    fs.writeFileSync(path.join(structuredCompDir, 'component.css.template'), '/* CUSTOM STRUCTURED CSS */');

    execSync(`node ${BIN_PATH} generate component custom-struct-box`, { cwd: TEST_DIR });

    const customStructBoxJs = fs.readFileSync(
      path.join(TEST_DIR, 'src/components/custom-struct-box/custom-struct-box.component.js'),
      'utf-8',
    );

    const customStructBoxCss = fs.readFileSync(
      path.join(TEST_DIR, 'src/components/custom-struct-box/custom-struct-box.component.css'),
      'utf-8',
    );

    assert.ok(
      customStructBoxJs.includes('// CUSTOM STRUCTURED TEMPLATE'),
      'Should prioritize custom structured JS template',
    );

    assert.ok(
      customStructBoxJs.includes('class CustomStructBox extends AvenxComponent'),
      'Should replace template variables correctly',
    );

    assert.strictEqual(
      customStructBoxCss.trim(),
      '/* CUSTOM STRUCTURED CSS */',
      'Should prioritize custom structured CSS template',
    );

    console.log('🧪 Testing avenx generate page does not overwrite partial existing files...');

    const pageCssPath = path.join(TEST_DIR, 'src/pages/reports.page.css');

    const pageJsPath = path.join(TEST_DIR, 'src/pages/reports.page.js');

    fs.writeFileSync(pageCssPath, '/* keep existing page styles */');

    const duplicatePageResult = runCli(['generate', 'page', 'reports']);

    assert.strictEqual(duplicatePageResult.status, 1, 'Page generation should fail when any target file exists');

    assert.match(
      duplicatePageResult.stderr,
      /Page 'reports' already exists/,
      'Page generation should explain which page already exists',
    );

    assert.strictEqual(
      fs.readFileSync(pageCssPath, 'utf-8'),
      '/* keep existing page styles */',
      'Page generation should not overwrite existing CSS when JS is missing',
    );

    assert.ok(!fs.existsSync(pageJsPath), 'Page generation should not create JS after detecting an existing CSS file');

    console.log('✅ Custom project-level templates tests passed!');

    console.log('🧪 Testing avenx generate component from a subdirectory...');

    // Create nested directory to simulate a subdirectory
    const srcSubdir = path.join(TEST_DIR, 'src');

    // Run CLI generate component command from nested src directory
    execSync(`node ${BIN_PATH} generate component sub-box`, { cwd: srcSubdir });

    const subBoxJsPath = path.join(TEST_DIR, 'src/components/sub-box/sub-box.component.js');

    const subBoxCssPath = path.join(TEST_DIR, 'src/components/sub-box/sub-box.component.css');

    assert.ok(fs.existsSync(subBoxJsPath), 'Missing sub-box component JS file at root components dir');

    assert.ok(fs.existsSync(subBoxCssPath), 'Missing sub-box component CSS file at root components dir');

    const incorrectNestedDir = path.join(TEST_DIR, 'src/src');

    assert.ok(!fs.existsSync(incorrectNestedDir), 'Should not create double nested src/src directory');

    const mainAppContent = fs.readFileSync(path.join(TEST_DIR, 'src/main.app.js'), 'utf-8');

    assert.ok(
      mainAppContent.includes("import SubBox from './components/sub-box/sub-box.component.js';"),
      'Component should be registered with correct relative path in main.app.js',
    );

    assert.ok(
      mainAppContent.includes("app.register('SubBox', SubBox);"),
      'Component class should be registered on app',
    );

    console.log('✅ Subdirectory command execution tests passed!');
  } catch (error) {
    console.error('❌ Test failed!');
    console.error(error);
    process.exit(1);
  } finally {
    cleanup();
  }
}

runTest();
