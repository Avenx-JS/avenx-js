const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const TEST_DIR = path.join(__dirname, 'test-project');
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

function setup() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR);
}

function cleanup() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
}

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
            'src/main.app.js'
        ];

        expectedPaths.forEach(p => {
            const fullPath = path.join(TEST_DIR, p);
            assert.ok(fs.existsSync(fullPath), `Missing expected path: ${p}`);
            console.log(`  ✅ Found: ${p}`);
        });

        // Verify content of a template file
        const settings = JSON.parse(fs.readFileSync(path.join(TEST_DIR, '.vscode/settings.json'), 'utf-8'));
        assert.ok(settings['files.associations'], 'settings.json should have files.associations');
        assert.strictEqual(settings['files.associations']['*.component.js'], 'html', 'Association for *.component.js should be html');

        console.log('✅ All init tests passed!');

        console.log('🧪 Testing avenx build...');
        execSync(`node ${BIN_PATH} build`, { cwd: TEST_DIR });
        
        const bundleJsPath = path.join(TEST_DIR, 'dist/bundle.js');
        const bundleCssPath = path.join(TEST_DIR, 'dist/bundle.css');
        assert.ok(fs.existsSync(bundleJsPath), 'Missing bundle.js');
        assert.ok(fs.existsSync(bundleCssPath), 'Missing bundle.css');
        
        const bundleContent = fs.readFileSync(bundleJsPath, 'utf-8');
        assert.ok(bundleContent.includes('class HtmlEscaper'), 'bundle.js should contain HtmlEscaper');
        assert.ok(bundleContent.includes('class SafeHtml'), 'bundle.js should contain SafeHtml');
        assert.ok(bundleContent.includes('function html('), 'bundle.js should contain html function');
        
        console.log('✅ All build tests passed!');

        console.log('🧪 Testing avenx generate component with global template...');
        execSync(`node ${BIN_PATH} generate component default-box`, { cwd: TEST_DIR });
        const defaultBoxJs = fs.readFileSync(path.join(TEST_DIR, 'src/components/default-box/default-box.component.js'), 'utf-8');
        assert.ok(defaultBoxJs.includes('DefaultBox Component'), 'Should contain default title');

        console.log('🧪 Testing avenx generate component with camelCase name...');
        execSync(`node ${BIN_PATH} generate component UserProfile`, { cwd: TEST_DIR });
        const userProfileJs = fs.readFileSync(path.join(TEST_DIR, 'src/components/user-profile/user-profile.component.js'), 'utf-8');
        assert.ok(userProfileJs.includes('UserProfile Component'), 'Should replace template name with camelCase preserved');

        // Run build to verify compiling works and produces the correct class name
        execSync(`node ${BIN_PATH} build`, { cwd: TEST_DIR });
        const newBundleContent = fs.readFileSync(path.join(TEST_DIR, 'dist/bundle.js'), 'utf-8');
        assert.ok(newBundleContent.includes('class UserProfile extends AvenxComponent'), 'Compiled bundle should contain correct class name for camelCase component');


        console.log('🧪 Testing avenx generate component with custom project-level templates...');
        // Create local templates folder
        const localTemplatesDir = path.join(TEST_DIR, '.avenxtemplates');
        fs.mkdirSync(localTemplatesDir, { recursive: true });

        // Test flat custom template file
        fs.writeFileSync(
            path.join(localTemplatesDir, 'component.js.template'),
            '// CUSTOM FLAT TEMPLATE\nclass {{ name }} extends AvenxComponent {}'
        );
        fs.writeFileSync(
            path.join(localTemplatesDir, 'component.css.template'),
            '/* CUSTOM FLAT CSS */'
        );

        execSync(`node ${BIN_PATH} generate component custom-flat-box`, { cwd: TEST_DIR });
        
        const customFlatBoxJs = fs.readFileSync(path.join(TEST_DIR, 'src/components/custom-flat-box/custom-flat-box.component.js'), 'utf-8');
        const customFlatBoxCss = fs.readFileSync(path.join(TEST_DIR, 'src/components/custom-flat-box/custom-flat-box.component.css'), 'utf-8');
        assert.ok(customFlatBoxJs.includes('// CUSTOM FLAT TEMPLATE'), 'Should use custom flat JS template');
        assert.ok(customFlatBoxJs.includes('class CustomFlatBox extends AvenxComponent'), 'Should replace template variables correctly');
        assert.strictEqual(customFlatBoxCss.trim(), '/* CUSTOM FLAT CSS */', 'Should use custom flat CSS template');

        // Test structured custom template file (taking precedence over flat)
        const structuredCompDir = path.join(localTemplatesDir, 'component');
        fs.mkdirSync(structuredCompDir, { recursive: true });
        fs.writeFileSync(
            path.join(structuredCompDir, 'component.js.template'),
            '// CUSTOM STRUCTURED TEMPLATE\nclass {{ name }} extends AvenxComponent {}'
        );
        fs.writeFileSync(
            path.join(structuredCompDir, 'component.css.template'),
            '/* CUSTOM STRUCTURED CSS */'
        );

        execSync(`node ${BIN_PATH} generate component custom-struct-box`, { cwd: TEST_DIR });

        const customStructBoxJs = fs.readFileSync(path.join(TEST_DIR, 'src/components/custom-struct-box/custom-struct-box.component.js'), 'utf-8');
        const customStructBoxCss = fs.readFileSync(path.join(TEST_DIR, 'src/components/custom-struct-box/custom-struct-box.component.css'), 'utf-8');
        assert.ok(customStructBoxJs.includes('// CUSTOM STRUCTURED TEMPLATE'), 'Should prioritize custom structured JS template');
        assert.ok(customStructBoxJs.includes('class CustomStructBox extends AvenxComponent'), 'Should replace template variables correctly');
        assert.strictEqual(customStructBoxCss.trim(), '/* CUSTOM STRUCTURED CSS */', 'Should prioritize custom structured CSS template');

        console.log('✅ Custom project-level templates tests passed!');

    } catch (error) {
        console.error('❌ Test failed!');
        console.error(error);
        process.exit(1);
    } finally {
        cleanup();
    }
}

runTest();
