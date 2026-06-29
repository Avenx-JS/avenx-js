#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const AvenxCompiler = require('../lib/compiler');

const [, , command, ...args] = process.argv;

/**
 * Avenx CLI - Command Line Interface for Avenx-JS.
 */
class AvenxCLI {
    /**
     * Creates an instance of AvenxCLI.
     * Initializes the base directory and framework directory paths.
     */
    constructor() {
        this.baseDir = process.cwd();
        this.frameworkDir = path.join(__dirname, '..');
    }

    /**
     * Reads a template, checking the local .avenxtemplates/ folder first.
     * Checks for:
     * 1. Structured path: <project_root>/.avenxtemplates/<subfolder>/<filename>
     * 2. Flat path: <project_root>/.avenxtemplates/<filename>
     * 3. Global path: <framework_dir>/templates/<subfolder>/<filename>
     *
     * @param {string} subfolder - The template subfolder (e.g., 'component', 'page', 'vscode')
     * @param {string} filename - The template filename (e.g., 'component.js.template')
     * @returns {string} The template file content
     */
    readTemplate(subfolder, filename) {
        const localStructuredPath = path.join(this.baseDir, '.avenxtemplates', subfolder, filename);
        if (fs.existsSync(localStructuredPath)) {
            return fs.readFileSync(localStructuredPath, 'utf-8');
        }

        const localFlatPath = path.join(this.baseDir, '.avenxtemplates', filename);
        if (fs.existsSync(localFlatPath)) {
            return fs.readFileSync(localFlatPath, 'utf-8');
        }

        const globalPath = path.join(this.frameworkDir, 'templates', subfolder, filename);
        return fs.readFileSync(globalPath, 'utf-8');
    }

    /**
     * Executes a given CLI command with provided arguments.
     * 
     * @param {string} command - The command to run (e.g., 'init', 'generate', 'build', 'serve', 'help').
     * @param {string[]} args - Additional arguments for the command.
     */
    run(command, args) {
        const type = args[0];
        const name = args[1];

        switch (command) {
            case 'init':
                this.initProject();
                break;
            case 'generate':
            case 'g':
                if (type === 'bridge') {
                    this.generateBridge(name);
                } else if (type === 'guard') {
                    this.generateGuard(name);
                } else if (type === 'page' || type === 'p') {
                    this.generatePage(name);
                } else {
                    // Default to component if only one arg or type is 'component'
                    this.generateComponent(name || type);
                }
                break;
            case 'build':
            case 'b':
                this.buildProject();
                break;
            case 'check':
            case 'lint':
                this.checkProject(args);
                break;
            case 'serve':
                this.serveProject(args[0] || process.env.PORT || 3000);
                break;
            case 'help':
            default:
                this.printHelp();
                break;
        }
    }

    /**
     * Initializes a new Avenx project structure.
     */
    initProject() {
        console.log('🚀 Initializing new Avenx-JS project...');
        const dirs = [
            'src/components',
            'src/pages',
            'src/global',
            'src/guards',
            'dist',
            '.vscode'
        ];

        dirs.forEach(dir => {
            const fullPath = path.join(this.baseDir, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                console.log(`  Created: ${dir}`);
            }
        });

        // Create initial .vscode files
        const jsConfigPath = path.join(this.baseDir, '.vscode/jsconfig.json');
        if (!fs.existsSync(jsConfigPath)) {
            const template = this.readTemplate('vscode', 'jsconfig.json.template');
            fs.writeFileSync(jsConfigPath, template);
            console.log('  Created: .vscode/jsconfig.json');
        }

        const settingsPath = path.join(this.baseDir, '.vscode/settings.json');
        if (!fs.existsSync(settingsPath)) {
            const template = this.readTemplate('vscode', 'settings.json.template');
            fs.writeFileSync(settingsPath, template);
            console.log('  Created: .vscode/settings.json');
        }

        // Create initial index.html
        const indexHtmlPath = path.join(this.baseDir, 'index.html');
        if (!fs.existsSync(indexHtmlPath)) {
            fs.writeFileSync(indexHtmlPath, this.getInitialHtml());
            console.log('  Created: index.html');
        }

        // Create initial main.app.js
        const mainAppPath = path.join(this.baseDir, 'src/main.app.js');
        if (!fs.existsSync(mainAppPath)) {
            fs.writeFileSync(mainAppPath, "import { AvenxApp } from 'avenx-core/runtime';\n\nconst app = new AvenxApp({ target: '#app' });\n");
            console.log('  Created: src/main.app.js');
        }

        console.log('✅ Project initialized successfully!');
    }

    /**
     * Generates a new Bridge class and template file.
     */
    generateBridge(name) {
        if (!name) {
            console.error('❌ Error: Please provide a bridge name (e.g., avenx g bridge auth)');
            return;
        }

        const lowerName = name.toLowerCase();
        const capitalizedName = lowerName
            .split(/[-_]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('') + "Bridge";

        const globalDir = path.join(this.baseDir, 'src/global');
        if (!fs.existsSync(globalDir)) {
            fs.mkdirSync(globalDir, { recursive: true });
        }

        const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);

        if (fs.existsSync(bridgePath)) {
            console.error(`❌ Error: Bridge '${lowerName}' already exists.`);
            return;
        }

        const template = this.readTemplate('bridge', 'bridge.js.template');

        fs.writeFileSync(
            bridgePath,
            template.replace(/{{ name }}/g, capitalizedName)
        );

        console.log(`✅ Bridge '${capitalizedName}' generated at src/global/${lowerName}.bridge.js`);
        console.log(`ℹ️ It will be automatically registered as '${capitalizedName}' on the next build.`);
    }

    /**
     * Generates a new Guard class and template file.
     */
    generateGuard(name) {
        if (!name) {
            console.error('❌ Error: Please provide a guard name (e.g., avenx g guard auth)');
            return;
        }

        const lowerName = name.toLowerCase();
        const capitalizedName = lowerName
            .split(/[-_]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('') + "Guard";

        const guardDir = path.join(this.baseDir, 'src/guards');
        if (!fs.existsSync(guardDir)) {
            fs.mkdirSync(guardDir, { recursive: true });
        }

        const guardPath = path.join(guardDir, `${lowerName}.guard.js`);

        if (fs.existsSync(guardPath)) {
            console.error(`❌ Error: Guard '${lowerName}' already exists.`);
            return;
        }

        const template = this.readTemplate('guard', 'guard.js.template');

        fs.writeFileSync(
            guardPath,
            template.replace(/{{ name }}/g, capitalizedName)
        );

        console.log(`✅ Guard '${capitalizedName}' generated at src/guards/${lowerName}.guard.js`);
        console.log(`ℹ️ It can be used in your route configurations.`);
    }

    /**
     * Generates a new Page class and template files.
     */
    generatePage(name) {
        if (!name) {
            console.error('❌ Error: Please provide a page name (e.g., avenx g page home)');
            return;
        }

        const lowerName = name.toLowerCase();
        const capitalizedName = lowerName
            .split(/[-_]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');

        const pageDir = path.join(this.baseDir, 'src/pages');
        if (!fs.existsSync(pageDir)) {
            fs.mkdirSync(pageDir, { recursive: true });
        }

        const jsPath = path.join(pageDir, `${lowerName}.page.js`);
        const cssPath = path.join(pageDir, `${lowerName}.page.css`);

        if (fs.existsSync(jsPath)) {
            console.error(`❌ Error: Page '${lowerName}' already exists.`);
            return;
        }

        const jsTemplate = this.readTemplate('page', 'page.js.template');
        const cssTemplate = this.readTemplate('page', 'page.css.template');

        fs.writeFileSync(jsPath, jsTemplate.replace(/{{ name }}/g, capitalizedName));
        fs.writeFileSync(cssPath, cssTemplate);

        console.log(`✅ Page '${capitalizedName}' generated at src/pages/${lowerName}.page.js`);
        console.log(`ℹ️ It will be automatically registered and routed if you update src/main.app.js.`);
    }

    /**
     * Generates a new component folder and template files, and registers it in main.app.js.
     */
    generateComponent(name) {
        if (!name) {
            console.error('❌ Error: Please provide a component name (e.g., avenx g my-component)');
            return;
        }

        const lowerName = name.toLowerCase();
        const capitalizedName = lowerName
            .split(/[-_]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');

        const compDir = path.join(this.baseDir, 'src/components', lowerName);

        if (fs.existsSync(compDir)) {
            console.error(`❌ Error: Component '${lowerName}' already exists.`);
            return;
        }

        fs.mkdirSync(compDir, { recursive: true });

        const jsTemplate = this.readTemplate('component', 'component.js.template');
        const cssTemplate = this.readTemplate('component', 'component.css.template');

        fs.writeFileSync(
            path.join(compDir, `${lowerName}.component.js`),
            jsTemplate.replace('{{ name }}', capitalizedName)
        );
        fs.writeFileSync(
            path.join(compDir, `${lowerName}.component.css`),
            cssTemplate
        );

        console.log(`✅ Component '${lowerName}' generated at src/components/${lowerName}/`);
        this.registerInMainApp(capitalizedName, lowerName);
    }

    /**
     * Automatically adds import and registration for a component in src/main.app.js.
     */
    registerInMainApp(className, folderName) {
        const mainPath = path.join(this.baseDir, 'src/main.app.js');
        if (!fs.existsSync(mainPath)) return;

        let content = fs.readFileSync(mainPath, 'utf-8');
        const importStatement = `import ${className} from './components/${folderName}/${folderName}.component.js';`;
        const registerStatement = `app.register('${className}', ${className});`;

        const lines = content.split('\n');
        let lastImportIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('import ')) lastImportIndex = i;
        }

        if (lastImportIndex !== -1) {
            lines.splice(lastImportIndex + 1, 0, importStatement);
        } else {
            lines.unshift(importStatement);
        }

        let lastRegisterIndex = -1;
        let appInstanceIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('app.register(')) lastRegisterIndex = i;
            if (lines[i].includes('new AvenxApp')) appInstanceIndex = i;
        }

        if (lastRegisterIndex !== -1) {
            lines.splice(lastRegisterIndex + 1, 0, registerStatement);
        } else if (appInstanceIndex !== -1) {
            lines.splice(appInstanceIndex + 1, 0, '', registerStatement);
        } else {
            lines.push('', registerStatement);
        }

        const hasMount = lines.some(line => line.includes('app.mount('));
        if (!hasMount) {
            lines.push(`\napp.mount('${className}');`);
        } else {
            lines.push(`// app.mount('${className}'); // Uncomment to mount this component`);
        }

        fs.writeFileSync(mainPath, lines.join('\n'));
        console.log(`✅ Component '${className}' registered in src/main.app.js`);
    }

    /**
     * Runs the compiler build.
     */
    buildProject() {
        new AvenxCompiler().build();
    }

    checkProject(args = []) {
        const originalWarn = console.warn;
        let warningCount = 0;

        console.warn = (...messages) => {
            warningCount++;
            originalWarn(...messages);
        };

        const compiler = new AvenxCompiler();

        compiler.processComponents();
        compiler.processPages();

        console.warn = originalWarn;

        if (warningCount > 0) {
            console.error(
                `\nFound ${warningCount} validation warning(s).`
            );
            process.exit(1);
        }

        console.log(
            '✓ No template validation issues found.'
        );

        process.exit(0);
    }

    /**
     * Starts a local development server and watches for changes.
     */
    serveProject(port) {
        this.liveReloadClients = [];
        this.buildProject();
        this.watchProject();

        const server = http.createServer((req, res) => {
            if (req.url === '/__avenx_live_reload__') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
                res.write('data: connected\n\n');

                this.liveReloadClients.push(res);

                req.on('close', () => {
                    this.liveReloadClients = this.liveReloadClients.filter(client => client !== res);
                });
                return;
            }

            let filePath = path.join(this.baseDir, req.url === '/' ? 'index.html' : req.url);

            if (!fs.existsSync(filePath) && !path.extname(filePath)) {
                filePath = path.join(this.baseDir, 'index.html');
            }

            const extname = String(path.extname(filePath)).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
            };

            const contentType = mimeTypes[extname] || 'application/octet-stream';

            fs.readFile(filePath, (error, content) => {
                if (error) {
                    if (error.code === 'ENOENT') {
                        res.writeHead(404);
                        res.end('File not found');
                    } else {
                        res.writeHead(500);
                        res.end('Server error: ' + error.code);
                    }
                } else {
                    let responseContent = content;
                    if (contentType === 'text/html') {
                        const script = `
<script>
    if ('EventSource' in window) {
        const source = new EventSource('/__avenx_live_reload__');
        source.onmessage = (e) => {
            if (e.data === 'reload') {
                window.location.reload();
            }
        };
    }
</script>
`;
                        const contentStr = content.toString('utf-8');
                        if (contentStr.includes('</body>')) {
                            responseContent = contentStr.replace('</body>', `${script}</body>`);
                        } else {
                            responseContent = contentStr + script;
                        }
                    }

                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(responseContent, 'utf-8');
                }
            });
        });

        server.listen(port, () => {
            const url = `http://localhost:${port}`;
            console.log(`\n🚀 Dev-Server running at ${url}`);
            console.log(`👀 Watching for changes in src/...\n`);
            this.openBrowser(url);
        });
    }

    /**
     * Watches the src directory for changes and triggers a rebuild.
     */
    watchProject() {
        let timeout;
        const srcPath = path.join(this.baseDir, 'src');

        if (!fs.existsSync(srcPath)) return;

        fs.watch(srcPath, { recursive: true }, (eventType, filename) => {
            if (filename) {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    console.log(`\n📄 Change detected: ${filename}. Rebuilding...`);
                    this.buildProject();

                    if (this.liveReloadClients) {
                        this.liveReloadClients.forEach(client => {
                            client.write('data: reload\n\n');
                        });
                    }
                }, 100);
            }
        });
    }

    /**
     * Opens the browser to the specified URL.
     */
    openBrowser(url) {
        const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${start} ${url}`);
    }

    /**
     * Generates the default index.html template content.
     * 
     * @returns {string} The initial HTML template string.
     */
    getInitialHtml() {
        return `<!DOCTYPE html>
<html>
<head>
    <title>My Avenx App</title>
    <link rel="stylesheet" href="dist/bundle.css">
</head>
<body>
    <div id="app"></div>
    <script src="dist/bundle.js"></script>
</body>
</html>`;
    }

    /**
     * Prints the help message with available commands to the console.
     */
printHelp() {
    console.log(`
Avenx-JS CLI
Usage: avenx <command> [type] [name]

Commands:
  init                      Initialize a new Avenx project structure
  generate component <name> Generate a new component (alias: g)
  generate page <name>      Generate a new page (alias: g p)
  generate bridge <name>    Generate a new shared reactive bridge
  generate guard <name>     Generate a new route guard
  build (b)                 Build the project into dist/bundle.js
  check (lint)              Validate templates without building
  serve [port]              Start dev server with hot-reload (default: 3000)
  help                      Show this help message
    `);
  }

}  



const cli = new AvenxCLI();
cli.run(command, args);
