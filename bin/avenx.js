const fs = require('fs');
const path = require('path');

class CLI {
    constructor() {
        this.baseDir = this.findProjectRoot(process.cwd());
    }

    findProjectRoot(currentPath) {
        let currentDir = currentPath;
        while (!fs.existsSync(path.join(currentDir, 'package.json')) && currentDir !== path.parse(currentDir).root) {
            currentDir = path.dirname(currentDir);
        }
        if (fs.existsSync(path.join(currentDir, 'package.json'))) {
            return currentDir;
        }
        throw new Error('Could not locate the project root. Ensure your command is run within a valid Avenx.js project directory.');
    }

    generateComponent(name) {
        const componentsDir = path.join(this.baseDir, 'src', 'components', name);
        if (!fs.existsSync(componentsDir)) {
            fs.mkdirSync(componentsDir, { recursive: true });
            fs.writeFileSync(path.join(componentsDir, `${name}.js`), '// Component JS Template\n');
            fs.writeFileSync(path.join(componentsDir, `${name}.css`), '/* Component CSS Template */\n');
            console.log(`Component ${name} created at ${componentsDir}`);
        } else {
            console.error(`Error: Component ${name} already exists at ${componentsDir}`);
        }
    }
}

module.exports = CLI;