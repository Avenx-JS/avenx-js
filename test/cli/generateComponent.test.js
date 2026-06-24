const fs = require('fs');
const path = require('path');
const CLI = require('../../bin/avenx');
const assert = require('assert');
const rimraf = require('rimraf');

describe('CLI.generateComponent', function () {
    const testDir = path.join(__dirname, 'test-project');
    const cli = new CLI();

    before(function () {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        fs.writeFileSync(path.join(testDir, 'package.json'), '{}');
        process.chdir(testDir);
    });

    after(function () {
        rimraf.sync(testDir);
    });

    it('should create a component in the correct directory', function () {
        const componentName = 'my-component';
        cli.generateComponent(componentName);

        const componentPath = path.join(testDir, 'src', 'components', componentName);
        assert(fs.existsSync(componentPath));
        assert(fs.existsSync(path.join(componentPath, `${componentName}.js`)));
        assert(fs.existsSync(path.join(componentPath, `${componentName}.css`)));
    });

    it('should not overwrite existing components', function () {
        const componentName = 'existing-component';
        const componentPath = path.join(testDir, 'src', 'components', componentName);

        // Create the component manually
        fs.mkdirSync(componentPath, { recursive: true });
        fs.writeFileSync(path.join(componentPath, `${componentName}.js`), 'Existing content');

        cli.generateComponent(componentName);

        // Ensure the file was not overwritten
        const content = fs.readFileSync(path.join(componentPath, `${componentName}.js`), 'utf-8');
        assert.strictEqual(content, 'Existing content');
    });

    it('should throw an error if run outside a project root', function () {
        process.chdir('/');
        assert.throws(() => {
            new CLI();
        }, /Could not locate the project root/);
        process.chdir(testDir);
    });
});