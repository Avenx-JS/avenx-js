import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { execSync, spawnSync, spawn } from 'child_process';

const TEST_DIR = path.join(__dirname, 'test-project');
const INTERACTIVE_TEST_DIR = path.join(__dirname, 'interactive-test-project');
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
  if (fs.existsSync(INTERACTIVE_TEST_DIR)) {
    fs.rmSync(INTERACTIVE_TEST_DIR, { recursive: true, force: true });
  }
}

/**
 *
 */
async function runTest() {
  console.log('🧪 Testing avenx init...');

  try {
    setup();

    // Run the init command in the test directory and capture output
    const init1Output = execSync(`node ${BIN_PATH} init`, { cwd: TEST_DIR, encoding: 'utf8' });

    // Assert that the first run logs the Created: lines
    assert.match(init1Output, /Created: src\/components/, 'first init run should log folder creation');
    assert.match(init1Output, /Created: \.vscode\/jsconfig\.json/, 'first init run should log file creation');
    assert.match(init1Output, /Created: package\.json/, 'first init run should log package.json creation');

    // Run the init command again in the test directory
    const init2Output = execSync(`node ${BIN_PATH} init`, { cwd: TEST_DIR, encoding: 'utf8' });

    // Assert that the second run does not log any directory or file creation lines
    assert.ok(!init2Output.includes('Created:'), 'second init run should not log any creation messages');

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
      'package.json',
    ];

    expectedPaths.forEach((p) => {
      const fullPath = path.join(TEST_DIR, p);
      assert.ok(fs.existsSync(fullPath), `Missing expected path: ${p}`);
      console.log(`  ✅ Found: ${p}`);
    });

    // Verify package.json exists and check contents
    const packageJsonFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
    const expectedVersion = packageJsonFile.version;
    const generatedPackagePath = path.join(TEST_DIR, 'package.json');
    const generatedPackage = JSON.parse(fs.readFileSync(generatedPackagePath, 'utf-8'));
    assert.strictEqual(generatedPackage.name, 'test-project', 'package.json name should match folder name');
    assert.strictEqual(generatedPackage.type, 'module', 'package.json type should be module');
    assert.deepStrictEqual(generatedPackage.scripts, {
      dev: 'avenx serve',
      build: 'avenx build',
      serve: 'avenx serve',
    }, 'package.json scripts should be pre-defined');
    assert.deepStrictEqual(generatedPackage.dependencies, {
      'avenx-core': `^${expectedVersion}`,
    }, 'package.json dependencies should contain avenx-core with correct version');
    console.log('  ✅ Verified package.json contents');

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

    console.log('🧪 Testing avenx clean...');

    // Dist directory should exist before clean (since we ran compile/build in earlier tests)
    const distPath = path.join(TEST_DIR, 'dist');
    assert.ok(fs.existsSync(distPath), 'dist directory should exist before clean');

    // Run avenx clean
    const cleanOutput = execSync(`node ${BIN_PATH} clean`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });

    assert.ok(!fs.existsSync(distPath), 'dist directory should be deleted after clean');
    assert.match(cleanOutput, /🧹 Cleaning build output directory/, 'should print cleaning message');
    assert.match(cleanOutput, /✅ Clean complete/, 'should print clean complete message');

    // Run clean again when dist directory does not exist
    const cleanAgainOutput = execSync(`node ${BIN_PATH} clean`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });

    assert.match(cleanAgainOutput, /does not exist\. Nothing to clean/, 'should handle non-existent directory');

    console.log('✅ Clean command tests passed!');

    console.log('🧪 Testing avenx destroy component (dry-run & actual)...');

    // 1. Dry run of destroying the default-box component
    const defaultBoxDir = path.join(TEST_DIR, 'src/components/default-box');
    assert.ok(fs.existsSync(defaultBoxDir), 'default-box dir should exist before destroy test');

    const destroyDryRunOutput = execSync(`node ${BIN_PATH} destroy component default-box --dry-run`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });

    assert.ok(fs.existsSync(defaultBoxDir), 'default-box dir should still exist after dry-run');
    assert.match(destroyDryRunOutput, /🧪 \[Dry Run\] Component 'default-box' files would be deleted/, 'should print dry run message');
    assert.match(destroyDryRunOutput, /No files were deleted or modified/, 'should report no modifications');

    // Make sure main.app.js still contains the registration
    let mainAppJsContent = fs.readFileSync(path.join(TEST_DIR, 'src/main.app.js'), 'utf-8');
    assert.ok(mainAppJsContent.includes('DefaultBox'), 'DefaultBox registration should still exist in main.app.js');

    // 2. Actual destroy
    const destroyOutput = execSync(`node ${BIN_PATH} destroy component default-box`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });

    assert.ok(!fs.existsSync(defaultBoxDir), 'default-box dir should be deleted');
    assert.match(destroyOutput, /✅ Component 'default-box' directory deleted/, 'should log deletion message');
    assert.match(destroyOutput, /Cleaned up imports and registrations/, 'should log clean up message');

    mainAppJsContent = fs.readFileSync(path.join(TEST_DIR, 'src/main.app.js'), 'utf-8');
    assert.ok(!mainAppJsContent.includes('DefaultBox'), 'DefaultBox registration should be removed from main.app.js');

    // 3. Test destroying non-existent component handles gracefully
    const destroyNonExistentOutput = execSync(`node ${BIN_PATH} d component default-box`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });
    assert.match(destroyNonExistentOutput, /ℹ️ Component 'default-box' directory was not found/, 'should handle gracefully');

    // 4. Test page generation & destroy
    console.log('🧪 Testing avenx destroy page...');
    // Create page first
    execSync(`node ${BIN_PATH} generate page reports-test`, { cwd: TEST_DIR });
    const reportsPageJs = path.join(TEST_DIR, 'src/pages/reports-test.page.js');
    const reportsPageCss = path.join(TEST_DIR, 'src/pages/reports-test.page.css');
    assert.ok(fs.existsSync(reportsPageJs), 'reports-test JS page should exist');
    assert.ok(fs.existsSync(reportsPageCss), 'reports-test CSS page should exist');

    // Add manual import to main.app.js to test cleanup
    fs.appendFileSync(
      path.join(TEST_DIR, 'src/main.app.js'),
      "\nimport ReportsTest from './pages/reports-test.page.js';\n"
    );

    // Destroy page
    const pageDestroyOutput = execSync(`node ${BIN_PATH} d p reports-test`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });
    assert.ok(!fs.existsSync(reportsPageJs), 'reports-test JS page should be deleted');
    assert.ok(!fs.existsSync(reportsPageCss), 'reports-test CSS page should be deleted');
    assert.match(pageDestroyOutput, /✅ Page 'ReportsTest' files deleted/, 'should log page deletion');

    mainAppJsContent = fs.readFileSync(path.join(TEST_DIR, 'src/main.app.js'), 'utf-8');
    assert.ok(!mainAppJsContent.includes('ReportsTest'), 'ReportsTest import should be cleaned up');

    // 5. Test bridge generation & destroy
    console.log('🧪 Testing avenx destroy bridge...');
    execSync(`node ${BIN_PATH} generate bridge auth-test`, { cwd: TEST_DIR });
    const authBridgePath = path.join(TEST_DIR, 'src/global/auth-test.bridge.js');
    assert.ok(fs.existsSync(authBridgePath), 'auth-test bridge should exist');

    const bridgeDestroyOutput = execSync(`node ${BIN_PATH} d bridge auth-test`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });
    assert.ok(!fs.existsSync(authBridgePath), 'auth-test bridge should be deleted');
    assert.match(bridgeDestroyOutput, /✅ Bridge 'AuthTestBridge' file deleted/, 'should log bridge deletion');

    // 6. Test guard generation & destroy
    console.log('🧪 Testing avenx destroy guard...');
    execSync(`node ${BIN_PATH} generate guard auth-test`, { cwd: TEST_DIR });
    const authGuardPath = path.join(TEST_DIR, 'src/guards/auth-test.guard.js');
    assert.ok(fs.existsSync(authGuardPath), 'auth-test guard should exist');

    const guardDestroyOutput = execSync(`node ${BIN_PATH} d guard auth-test`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
    });
    assert.ok(!fs.existsSync(authGuardPath), 'auth-test guard should be deleted');
    assert.match(guardDestroyOutput, /✅ Guard 'AuthTestGuard' file deleted/, 'should log guard deletion');

    console.log('✅ Destroy command tests passed!');

    // 7. Test watch command
    console.log('🧪 Testing avenx watch...');
    const watchProc = spawn(process.execPath, [BIN_PATH, 'watch'], {
      cwd: TEST_DIR,
    });

    let watchOutput = '';
    let resolveWatchReady;
    const watchReadyPromise = new Promise((resolve) => {
      resolveWatchReady = resolve;
    });

    let resolveRebuildDone;
    const rebuildDonePromise = new Promise((resolve) => {
      resolveRebuildDone = resolve;
    });

    watchProc.stdout.on('data', (data) => {
      const chunk = data.toString('utf8');
      watchOutput += chunk;

      if (chunk.includes('Watching for changes')) {
        resolveWatchReady();
      }
      if (chunk.includes('Change detected') || chunk.includes('Rebuilding') || chunk.includes('Build completed')) {
        if (watchOutput.includes('Build completed')) {
          resolveRebuildDone();
        }
      }
    });

    // Wait for the watcher to start
    await watchReadyPromise;
    console.log('  Watch process started and is ready.');

    // Make a change to a file to trigger rebuild
    const mainAppJsPath = path.join(TEST_DIR, 'src/main.app.js');
    fs.appendFileSync(mainAppJsPath, '\n// Trigger watch change\n');

    // Wait for rebuild to trigger and finish
    await rebuildDonePromise;
    console.log('  ✅ Rebuild was successfully triggered on change.');

    // Stop the watcher by sending SIGINT (Ctrl+C)
    watchProc.kill('SIGINT');

    const exitPromise = new Promise((resolve) => {
      watchProc.on('exit', (code, signal) => {
        resolve({ code, signal });
      });
    });

    const { code: exitCode, signal: exitSignal } = await exitPromise;
    assert.ok(
      exitCode === 0 || exitCode === null || exitSignal === 'SIGINT',
      `watch command should exit with 0 or be terminated by SIGINT (code: ${exitCode}, signal: ${exitSignal})`
    );
    console.log('  ✅ watch command exited gracefully on SIGINT.');

    console.log('✅ All watch command tests passed!');

    // 8. Test interactive wizard for avenx init
    console.log('🧪 Testing avenx init interactive wizard...');
    if (fs.existsSync(INTERACTIVE_TEST_DIR)) {
      fs.rmSync(INTERACTIVE_TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(INTERACTIVE_TEST_DIR);

    const initProc = spawn(process.execPath, [BIN_PATH, 'init', '--interactive'], {
      cwd: INTERACTIVE_TEST_DIR,
    });

    let initOutput = '';
    initProc.stdout.on('data', (data) => {
      const chunk = data.toString('utf8');
      initOutput += chunk;
      if (initOutput.includes('Select style preprocessor:') && !initOutput.includes('[Sent Preprocessor]')) {
        initOutput += '[Sent Preprocessor]';
        // Send choice '2' (Sass)
        initProc.stdin.write('2\n');
      }
      if (initOutput.includes('Select layout template:') && !initOutput.includes('[Sent Layout]')) {
        initOutput += '[Sent Layout]';
        // Send choice '2' (Routing)
        initProc.stdin.write('2\n');
      }
    });

    const initExitPromise = new Promise((resolve, reject) => {
      initProc.on('close', (code) => {
        resolve(code);
      });
      initProc.on('error', (err) => {
        reject(err);
      });
    });

    const initExitCode = await initExitPromise;
    assert.strictEqual(initExitCode, 0, `Interactive wizard should exit with 0, got ${initExitCode}`);

    // Verify correct files generated matching selection options
    // 1. avenx.config.json
    const configPath = path.join(INTERACTIVE_TEST_DIR, 'avenx.config.json');
    assert.ok(fs.existsSync(configPath), 'avenx.config.json should be created');
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(userConfig.style?.preprocessor, 'sass', 'preprocessor should be sass');

    // 2. routing templates
    const homePageJs = path.join(INTERACTIVE_TEST_DIR, 'src/pages/home.page.js');
    const homePageCss = path.join(INTERACTIVE_TEST_DIR, 'src/pages/home.page.css');
    const aboutPageJs = path.join(INTERACTIVE_TEST_DIR, 'src/pages/about.page.js');
    const aboutPageCss = path.join(INTERACTIVE_TEST_DIR, 'src/pages/about.page.css');
    const navbarJs = path.join(INTERACTIVE_TEST_DIR, 'src/components/navbar/navbar.component.js');
    const navbarCss = path.join(INTERACTIVE_TEST_DIR, 'src/components/navbar/navbar.component.css');
    const mainAppJs = path.join(INTERACTIVE_TEST_DIR, 'src/main.app.js');

    assert.ok(fs.existsSync(homePageJs), 'home.page.js should exist');
    assert.ok(fs.existsSync(homePageCss), 'home.page.css should exist');
    assert.ok(fs.existsSync(aboutPageJs), 'about.page.js should exist');
    assert.ok(fs.existsSync(aboutPageCss), 'about.page.css should exist');
    assert.ok(fs.existsSync(navbarJs), 'navbar.component.js should exist');
    assert.ok(fs.existsSync(navbarCss), 'navbar.component.css should exist');
    assert.ok(fs.existsSync(mainAppJs), 'main.app.js should exist');

    // Verify mainAppJs contains routing layout registration
    const interactiveMainAppContent = fs.readFileSync(mainAppJs, 'utf-8');
    assert.ok(interactiveMainAppContent.includes("app.register('Navbar', Navbar)"), 'navbar component should be registered');
    assert.ok(interactiveMainAppContent.includes("'': 'Home'"), 'routing should include home path');
    assert.ok(interactiveMainAppContent.includes("'#/about': 'About'"), 'routing should include about path');

    // Clean up interactive directory
    if (fs.existsSync(INTERACTIVE_TEST_DIR)) {
      fs.rmSync(INTERACTIVE_TEST_DIR, { recursive: true, force: true });
    }
    console.log('  ✅ Interactive wizard test passed!');

  } catch (error) {
    console.error('❌ Test failed!');
    console.error(error);
    process.exit(1);
  } finally {
    cleanup();
  }
}

runTest();
