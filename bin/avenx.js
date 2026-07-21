#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import http from 'http';
import { exec, execSync } from 'child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'url';
import AvenxCompiler from '../lib/compiler.js';
import loadConfig from '../lib/config.js';
import { loadEnv } from '../lib/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const findProjectRoot = loadConfig.findProjectRoot;

const [, , command, ...args] = process.argv;

const MIN_NODE_VERSION = [18, 0, 0];
const current = process.versions.node.split('.').map(Number);

function compareVersions(current, required) {
  for (let i = 0; i < required.length; i++) {
    if (current[i] > required[i]) return true;
    if (current[i] < required[i]) return false;
  }
  return true;
}

if (!compareVersions(current, MIN_NODE_VERSION)) {
  console.error(
    `Avenx requires Node.js ${MIN_NODE_VERSION.join('.')} or later.\n` + `Current version: ${process.versions.node}`,
  );
  process.exit(1);
}

/**
 * Helper to parse input names into PascalCase and kebab-case.
 * Supports camelCase, kebab-case, snake_case, and PascalCase.
 * @param {string} inputName - The input name from CLI.
 * @returns {{capitalizedName: string, folderFileName: string}}
 */
function parseName(inputName) {
  let processedName = inputName;
  if (inputName === inputName.toUpperCase() && inputName !== inputName.toLowerCase()) {
    processedName = inputName.toLowerCase();
  }
  const parts = processedName.split(/(?<=[a-z0-9])(?=[A-Z])|[-_]/).filter(Boolean);
  const capitalizedName = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const folderFileName = parts.map((part) => part.toLowerCase()).join('-');
  return { capitalizedName, folderFileName };
}

function checkGitStatus() {
  try {
    const output = execSync('git status --porcelain', {
      encoding: 'utf8',
    });

    if (!output.trim()) {
      return true;
    }

    console.warn('⚠️ You have unstaged changes in your repository.');

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return true;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('Do you want to proceed? (y/N) ', (answer) => {
        rl.close();

        if (answer.trim().toLowerCase() === 'y') {
          resolve(true);
        } else {
          console.log('Operation cancelled.');
          resolve(false);
        }
      });
    });
  } catch {
    return true;
  }
}

/**
 * Avenx CLI - Command Line Interface for Avenx-JS.
 */
class AvenxCLI {
  /**
   * Creates an instance of AvenxCLI.
   * Initializes the base directory and framework directory paths.
   */
  constructor(options = {}) {
    this.baseDir = options.baseDir || findProjectRoot(process.cwd());
    loadEnv(this.baseDir);
    this.frameworkDir = path.join(__dirname, '..');
    this.config = { ...loadConfig(this.baseDir), ...options };
  }
  /**
   * Reads a template, checking the local .avenxtemplates/ folder first.
   * Checks for:
   * 1. Structured path: <project_root>/.avenxtemplates/<subfolder>/<filename>
   * 2. Flat path: <project_root>/.avenxtemplates/<filename>
   * 3. Global path: <framework_dir>/templates/<subfolder>/<filename>
   * @param {string} subfolder - The template subfolder (e.g., 'component', 'page', 'vscode')
   * @param {string} filename - The template filename (e.g., 'component.js.template')
   * @returns {string} The template file content
   */
  readTemplate(subfolder, filename) {
    const localStructuredPath = path.join(this.baseDir, this.config.templatesDir, subfolder, filename);
    if (fs.existsSync(localStructuredPath)) {
      return fs.readFileSync(localStructuredPath, 'utf-8');
    }

    const localFlatPath = path.join(this.baseDir, this.config.templatesDir, filename);
    if (fs.existsSync(localFlatPath)) {
      return fs.readFileSync(localFlatPath, 'utf-8');
    }

    const globalPath = path.join(this.frameworkDir, 'templates', subfolder, filename);
    return fs.readFileSync(globalPath, 'utf-8');
  }

  /**
   * Reports a CLI error and marks the process as failed.
   * @param {string} message
   */
  fail(message) {
    console.error(`\x1b[31m❌ Error: ${message}\x1b[0m`);
    process.exitCode = 1;
  }

  /**
   * Stops generation if any target path already exists.
   * @param {string} type
   * @param {string} name
   * @param {string[]} targetPaths
   * @returns {boolean}
   */
  abortIfGeneratedPathExists(type, name, targetPaths) {
    const existingPath = targetPaths.find((targetPath) => fs.existsSync(targetPath));
    if (!existingPath) {
      return false;
    }

    this.fail(
      `${type} '${name}' already exists at ${path.relative(this.baseDir, existingPath)}. ` +
        'Remove the existing file or choose a different name.',
    );
    return true;
  }

  /**
   * Executes a given CLI command with provided arguments.
   * @param {string} command - The command to run (e.g., 'init', 'generate', 'build', 'serve', 'help').
   * @param {string[]} args - Additional arguments for the command.
   */
  async run(command, args) {
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const force = args.includes('--force') || args.includes('-f');
    const filteredArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '-d');
    const type = filteredArgs[0];
    const name = filteredArgs[1];

    switch (command) {
      case 'init':
        if (!force) {
          const proceed = await checkGitStatus();
          if (!proceed) {
            return;
          }
        }
        await this.initProject(args);
        break;
      case 'generate':
      case 'g':
        if (!force) {
          const proceed = await checkGitStatus();
          if (!proceed) {
            return;
          }
        }
        if (type === 'bridge') {
          this.generateBridge(name, dryRun);
        } else if (type === 'guard') {
          this.generateGuard(name, dryRun);
        } else if (type === 'page' || type === 'p') {
          this.generatePage(name, dryRun);
        } else {
          // Default to component if only one arg or type is 'component'
          this.generateComponent(name || type, dryRun);
        }
        break;
      case 'destroy':
      case 'd':
        if (!force) {
          const proceed = await checkGitStatus();
          if (!proceed) {
            return;
          }
        }
        if (type === 'bridge') {
          this.destroyBridge(name, dryRun);
        } else if (type === 'guard') {
          this.destroyGuard(name, dryRun);
        } else if (type === 'page' || type === 'p') {
          this.destroyPage(name, dryRun);
        } else if (type === 'component' || type === 'c') {
          this.destroyComponent(name, dryRun);
        } else {
          // Default to component if only one arg or type is 'component'
          this.destroyComponent(name || type, dryRun);
        }
        break;
      case 'build':
      case 'b':
        if (!force) {
          const proceed = await checkGitStatus();
          if (!proceed) {
            return;
          }
        }
        this.buildProject();
        break;
      case 'clean':
        this.cleanProject();
        break;
      case 'check':
      case 'lint':
        this.checkProject(args);
        break;
      case 'serve': {
        const portIdx = args.findIndex((a) => a === '--port' || a === '-p');
        const hostIdx = args.findIndex((a) => a === '--host' || a === '-h');

        const port =
          portIdx !== -1 && args[portIdx + 1]
            ? parseInt(args[portIdx + 1], 10)
            : (!args[0]?.startsWith('-') && args[0]) || process.env.PORT || this.config.server.port || 3000;

        const host = hostIdx !== -1 && args[hostIdx + 1] ? args[hostIdx + 1] : 'localhost';

        this.serveProject(port, host);
        break;
      }
      case 'watch':
      case 'w':
        console.log(`👀 Watching for changes in ${this.config.srcDir}/...\n`);
        this.buildProject();
        this.watchProject();
        process.on('SIGINT', () => {
          console.log('\nStopping watch...');
          process.exit(0);
        });
        break;
      case 'help':
      default:
        this.printHelp();
        break;
    }
  }

  /**
   * Prompts the user with a question on the command line.
   * @param {string} query - The question query.
   * @param {string} defaultValue - The default response.
   * @param {function(string): (boolean|string)} [validator] - Optional function validating input.
   * @returns {Promise<string>}
   */
  promptQuestion(query, defaultValue, validator = null) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const ask = () => {
        rl.question(query, (answer) => {
          let trimmed = answer.trim();
          if (trimmed === '' && defaultValue !== undefined) {
            trimmed = defaultValue;
          }
          if (validator) {
            const valid = validator(trimmed);
            if (valid === true) {
              rl.close();
              resolve(trimmed);
            } else {
              console.log(`\x1b[31m❌ ${valid}\x1b[0m`);
              ask();
            }
          } else {
            rl.close();
            resolve(trimmed);
          }
        });
      };
      ask();
    });
  }

  /**
   * Initializes a new Avenx project structure.
   * @param {string[]} [args] - CLI arguments.
   */
  async initProject(args = []) {
    const isInteractive =
      process.stdin.isTTY &&
      process.stdout.isTTY &&
      !args.includes('-y') &&
      !args.includes('--yes');

    let stylePreprocessor = 'none';
    let layoutTemplate = 'blank';

    if (isInteractive) {
      console.log('\n\x1b[36m--- Avenx-JS Project Wizard ---\x1b[0m\n');

      const preprocessorInput = await this.promptQuestion(
        'Select style preprocessor:\n' +
          '  1. None (Vanilla CSS)\n' +
          '  2. Sass (SCSS)\n' +
          '  3. Less\n' +
          '  4. PostCSS\n' +
          'Choose an option (1-4, default: 1): ',
        '1',
        (val) => (['1', '2', '3', '4'].includes(val) ? true : 'Please enter a number between 1 and 4'),
      );

      const mapping = {
        '1': 'none',
        '2': 'sass',
        '3': 'less',
        '4': 'postcss',
      };
      stylePreprocessor = mapping[preprocessorInput];

      const layoutInput = await this.promptQuestion(
        'Select layout template:\n' +
          '  1. Blank (Minimal setup)\n' +
          '  2. Routing (Basic navigation with Navbar, Home and About pages)\n' +
          'Choose an option (1-2, default: 1): ',
        '1',
        (val) => (['1', '2'].includes(val) ? true : 'Please enter 1 or 2'),
      );
      layoutTemplate = layoutInput === '2' ? 'routing' : 'blank';
    }

    console.log('🚀 Initializing new Avenx-JS project...');

    // Write avenx.config.json if preprocessor option is configured
    const configPath = path.join(this.baseDir, 'avenx.config.json');
    if (!fs.existsSync(configPath)) {
      const userConfig = {
        style: {
          preprocessor: stylePreprocessor,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2) + '\n');
      console.log('  Created: avenx.config.json');
      this.config = { ...this.config, ...userConfig };
    }
    const dirs = [
      `${this.config.srcDir}/components`,
      `${this.config.srcDir}/pages`,
      `${this.config.srcDir}/global`,
      `${this.config.srcDir}/guards`,
      this.config.distDir,
      '.vscode',
    ];

    dirs.forEach((dir) => {
      const fullPath = path.join(this.baseDir, dir);
      const created = fs.mkdirSync(fullPath, { recursive: true });
      if (created) {
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
    const mainAppPath = path.join(this.baseDir, this.config.srcDir, 'main.app.js');
    if (!fs.existsSync(mainAppPath)) {
      fs.writeFileSync(
        mainAppPath,
        "import { AvenxApp } from 'avenx-core/runtime';\n\nconst app = new AvenxApp({ target: '#app' });\n",
      );
      console.log(`  Created: ${this.config.srcDir}/main.app.js`);
    }

    // Create initial package.json
    const packageJsonPath = path.join(this.baseDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      const projectName =
        path
          .basename(this.baseDir)
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '') || 'avenx-app';
      const packageContent = {
        name: projectName,
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'avenx serve',
          build: 'avenx build',
          serve: 'avenx serve',
        },
        dependencies: {
          'avenx-core': `^${packageJson.version}`,
        },
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageContent, null, 2) + '\n');
      console.log('  Created: package.json');
    }

    // Create initial .gitignore
    const gitignorePath = path.join(this.baseDir, '.gitignore');

    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, `node_modules/\n${this.config.distDir}/\n.DS_Store\n`);
      console.log('  Created: .gitignore');
    }
    console.log('✅ Project initialized successfully!');
  }

  /**
   * Generates a new Bridge class and template file.
   * @param name
   * @param {boolean} [dryRun] - If true, logs the actions without writing any files.
   */
  generateBridge(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a bridge name (e.g., avenx g bridge auth)');
      return;
    }

    const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
    const capitalizedName = baseName + 'Bridge';

    const globalDir = path.join(this.baseDir, this.config.srcDir, 'global');
    const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);

    if (this.abortIfGeneratedPathExists('Bridge', lowerName, [bridgePath])) {
      return;
    }

    if (dryRun) {
      console.log(
        `🧪 [Dry Run] Bridge '${capitalizedName}' would be created at ${this.config.srcDir}/global/${lowerName}.bridge.js`,
      );
      console.log('🧪 [Dry Run] No files were written.');
      return;
    }

    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }

    const template = this.readTemplate('bridge', 'bridge.js.template');

    fs.writeFileSync(bridgePath, template.replace(/{{ name }}/g, capitalizedName));

    console.log(`✅ Bridge '${capitalizedName}' generated at ${this.config.srcDir}/global/${lowerName}.bridge.js`);
    console.log(`ℹ️ It will be automatically registered as '${capitalizedName}' on the next build.`);
  }

  /**
   * Generates a new Guard class and template file.
   * @param name
   * @param {boolean} [dryRun] - If true, logs the actions without writing any files.
   */
  generateGuard(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a guard name (e.g., avenx g guard auth)');
      return;
    }

    const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
    const capitalizedName = baseName + 'Guard';

    const guardDir = path.join(this.baseDir, this.config.srcDir, 'guards');
    const guardPath = path.join(guardDir, `${lowerName}.guard.js`);

    if (this.abortIfGeneratedPathExists('Guard', lowerName, [guardPath])) {
      return;
    }

    if (dryRun) {
      console.log(
        `🧪 [Dry Run] Guard '${capitalizedName}' would be created at ${this.config.srcDir}/guards/${lowerName}.guard.js`,
      );
      console.log('🧪 [Dry Run] No files were written.');
      return;
    }

    if (!fs.existsSync(guardDir)) {
      fs.mkdirSync(guardDir, { recursive: true });
    }

    const template = this.readTemplate('guard', 'guard.js.template');

    fs.writeFileSync(guardPath, template.replace(/{{ name }}/g, capitalizedName));

    console.log(`✅ Guard '${capitalizedName}' generated at ${this.config.srcDir}/guards/${lowerName}.guard.js`);
    console.log(`ℹ️ It can be used in your route configurations.`);
  }

  /**
   * Generates a new Page class and template files.
   * @param name
   * @param {boolean} [dryRun] - If true, logs the actions without writing any files.
   */
  generatePage(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a page name (e.g., avenx g page home)');
      return;
    }

    const { capitalizedName, folderFileName: lowerName } = parseName(name);

    const pageDir = path.join(this.baseDir, this.config.srcDir, 'pages');
    const jsPath = path.join(pageDir, `${lowerName}.page.js`);
    const cssPath = path.join(pageDir, `${lowerName}.page.css`);

    if (this.abortIfGeneratedPathExists('Page', lowerName, [jsPath, cssPath])) {
      return;
    }

    if (dryRun) {
      console.log(`🧪 [Dry Run] Page '${capitalizedName}' would be created at:`);
      console.log(`  ${this.config.srcDir}/pages/${lowerName}.page.js`);
      console.log(`  ${this.config.srcDir}/pages/${lowerName}.page.css`);
      console.log('🧪 [Dry Run] No files were written.');
      return;
    }

    if (!fs.existsSync(pageDir)) {
      fs.mkdirSync(pageDir, { recursive: true });
    }

    const jsTemplate = this.readTemplate('page', 'page.js.template');
    const cssTemplate = this.readTemplate('page', 'page.css.template');

    fs.writeFileSync(jsPath, jsTemplate.replace(/{{ name }}/g, capitalizedName));
    fs.writeFileSync(cssPath, cssTemplate);

    console.log(`✅ Page '${capitalizedName}' generated at ${this.config.srcDir}/pages/${lowerName}.page.js`);
    console.log(`ℹ️ It will be automatically registered and routed if you update src/main.app.js.`);
  }

  /**
   * Generates a new component folder and template files, and registers it in main.app.js.
   * @param name
   * @param {boolean} [dryRun] - If true, logs the actions without writing any files.
   */
  generateComponent(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a component name (e.g., avenx g my-component)');
      return;
    }

    const { capitalizedName, folderFileName: lowerName } = parseName(name);

    const compDir = path.join(this.baseDir, this.config.srcDir, 'components', lowerName);

    if (this.abortIfGeneratedPathExists('Component', lowerName, [compDir])) {
      return;
    }

    if (dryRun) {
      console.log(`🧪 [Dry Run] Component '${lowerName}' would be created at:`);
      console.log(`  ${this.config.srcDir}/components/${lowerName}/${lowerName}.component.js`);
      console.log(`  ${this.config.srcDir}/components/${lowerName}/${lowerName}.component.css`);
      console.log(`🧪 [Dry Run] ${this.config.srcDir}/main.app.js would be updated with:`);
      console.log(`  import ${capitalizedName} from './components/${lowerName}/${lowerName}.component.js';`);
      console.log(`  app.register('${capitalizedName}', ${capitalizedName});`);
      console.log('🧪 [Dry Run] No files were written.');
      return;
    }

    fs.mkdirSync(compDir, { recursive: true });

    const jsTemplate = this.readTemplate('component', 'component.js.template');
    const cssTemplate = this.readTemplate('component', 'component.css.template');

    fs.writeFileSync(
      path.join(compDir, `${lowerName}.component.js`),
      jsTemplate.replace('{{ name }}', capitalizedName),
    );
    fs.writeFileSync(path.join(compDir, `${lowerName}.component.css`), cssTemplate);

    console.log(`✅ Component '${lowerName}' generated at ${this.config.srcDir}/components/${lowerName}/`);
    this.registerInMainApp(capitalizedName, lowerName);
  }

  /**
   * Automatically adds import and registration for a component in src/main.app.js.
   * @param className
   * @param folderName
   */
  registerInMainApp(className, folderName) {
    const mainPath = path.join(this.baseDir, this.config.srcDir, 'main.app.js');
    if (!fs.existsSync(mainPath)) return;

    const content = fs.readFileSync(mainPath, 'utf-8');
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

    const hasMount = lines.some((line) => line.includes('app.mount('));
    if (!hasMount) {
      lines.push(`\napp.mount('${className}');`);
    } else {
      lines.push(`// app.mount('${className}'); // Uncomment to mount this component`);
    }

    fs.writeFileSync(mainPath, lines.join('\n'));
    console.log(`✅ Component '${className}' registered in ${this.config.srcDir}/main.app.js`);
  }

  /**
   * Automatically removes imports, registrations, and mount statements for a class from src/main.app.js.
   * @param {string} className
   * @param {string} folderName
   */
  unregisterFromMainApp(className, folderName) {
    const mainPath = path.join(this.baseDir, this.config.srcDir, 'main.app.js');
    if (!fs.existsSync(mainPath)) return;

    const content = fs.readFileSync(mainPath, 'utf-8');

    // Remove import statements (handle single or double quotes, and optional trailing semicolon or carriage return)
    const importRegex = new RegExp(
      `^import\\s+(?:${className}|\\{\\s*${className}\\s*\\})\\s+from\\s+['"].*?${folderName}.*?['"];?\\r?\\n?`,
      'm',
    );
    const generalImportRegex = new RegExp(
      `^import\\s+(?:${className}|\\{\\s*${className}\\s*\\})\\s+from\\s+['"].*?['"];?\\r?\\n?`,
      'm',
    );

    // Remove app.register calls
    const registerRegex = new RegExp(
      `^\\s*app\\.register\\(\\s*['"]${className}['"]\\s*,\\s*${className}\\s*\\);?\\r?\\n?`,
      'm',
    );

    // Remove app.mount calls and their commented versions
    const mountRegex = new RegExp(`^\\s*(?://\\s*)?app\\.mount\\(\\s*['"]${className}['"]\\s*\\);?\\r?\\n?`, 'm');
    const commentedMountRegex = new RegExp(
      `^\\s*(?://\\s*)?app\\.mount\\(\\s*['"]${className}['"]\\s*\\);?\\s*//\\s*Uncomment\\s+to\\s+mount\\s+this\\s+component\\r?\\n?`,
      'm',
    );

    let newContent = content
      .replace(commentedMountRegex, '')
      .replace(mountRegex, '')
      .replace(registerRegex, '')
      .replace(importRegex, '');

    // Fall back to general import regex if className is imported but path didn't match the specific folderName
    if (newContent === content) {
      newContent = content
        .replace(commentedMountRegex, '')
        .replace(mountRegex, '')
        .replace(registerRegex, '')
        .replace(generalImportRegex, '');
    } else {
      // In case the specific regex replaced it, let's also make sure we attempt to replace general just in case
      newContent = newContent.replace(generalImportRegex, '');
    }

    // Clean up extra consecutive newlines
    newContent = newContent.replace(/\n{3,}/g, '\n\n');

    if (content !== newContent) {
      fs.writeFileSync(mainPath, newContent);
      console.log(`✅ Cleaned up imports and registrations for '${className}' in ${this.config.srcDir}/main.app.js`);
    }
  }

  /**
   * Destroys a component folder and template files, and unregisters it from main.app.js.
   * @param {string} name
   * @param {boolean} [dryRun]
   */
  destroyComponent(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a component name (e.g., avenx d my-component)');
      return;
    }

    const { capitalizedName, folderFileName: lowerName } = parseName(name);
    const compDir = path.join(this.baseDir, this.config.srcDir, 'components', lowerName);

    if (dryRun) {
      console.log(`🧪 [Dry Run] Component '${lowerName}' files would be deleted:`);
      console.log(`  ${this.config.srcDir}/components/${lowerName}/${lowerName}.component.js`);
      console.log(`  ${this.config.srcDir}/components/${lowerName}/${lowerName}.component.css`);
      console.log(`  ${this.config.srcDir}/components/${lowerName}/`);
      console.log(
        `🧪 [Dry Run] ${this.config.srcDir}/main.app.js would be updated to remove registrations/imports for '${capitalizedName}'.`,
      );
      console.log('🧪 [Dry Run] No files were deleted or modified.');
      return;
    }

    if (fs.existsSync(compDir)) {
      fs.rmSync(compDir, { recursive: true, force: true });
      console.log(`✅ Component '${lowerName}' directory deleted at ${this.config.srcDir}/components/${lowerName}/`);
    } else {
      console.log(`ℹ️ Component '${lowerName}' directory was not found.`);
    }

    this.unregisterFromMainApp(capitalizedName, lowerName);
  }

  /**
   * Destroys a page class and template files, and unregisters it from main.app.js.
   * @param {string} name
   * @param {boolean} [dryRun]
   */
  destroyPage(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a page name (e.g., avenx d page home)');
      return;
    }

    const { capitalizedName, folderFileName: lowerName } = parseName(name);
    const pageDir = path.join(this.baseDir, this.config.srcDir, 'pages');
    const jsPath = path.join(pageDir, `${lowerName}.page.js`);
    const cssPath = path.join(pageDir, `${lowerName}.page.css`);

    if (dryRun) {
      console.log(`🧪 [Dry Run] Page '${lowerName}' files would be deleted:`);
      console.log(`  ${this.config.srcDir}/pages/${lowerName}.page.js`);
      console.log(`  ${this.config.srcDir}/pages/${lowerName}.page.css`);
      console.log(
        `🧪 [Dry Run] ${this.config.srcDir}/main.app.js would be updated to remove imports/registrations/routes for '${capitalizedName}'.`,
      );
      console.log('🧪 [Dry Run] No files were deleted or modified.');
      return;
    }

    let deletedAny = false;
    if (fs.existsSync(jsPath)) {
      fs.rmSync(jsPath, { force: true });
      console.log(`  Deleted: ${this.config.srcDir}/pages/${lowerName}.page.js`);
      deletedAny = true;
    }
    if (fs.existsSync(cssPath)) {
      fs.rmSync(cssPath, { force: true });
      console.log(`  Deleted: ${this.config.srcDir}/pages/${lowerName}.page.css`);
      deletedAny = true;
    }

    if (deletedAny) {
      console.log(`✅ Page '${capitalizedName}' files deleted.`);
    } else {
      console.log(`ℹ️ Page '${capitalizedName}' files were not found.`);
    }

    this.unregisterFromMainApp(capitalizedName, lowerName);
  }

  /**
   * Destroys a Bridge class file.
   * @param {string} name
   * @param {boolean} [dryRun]
   */
  destroyBridge(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a bridge name (e.g., avenx d bridge auth)');
      return;
    }

    const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
    const capitalizedName = baseName + 'Bridge';
    const globalDir = path.join(this.baseDir, this.config.srcDir, 'global');
    const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);

    if (dryRun) {
      console.log(`🧪 [Dry Run] Bridge '${capitalizedName}' file would be deleted:`);
      console.log(`  ${this.config.srcDir}/global/${lowerName}.bridge.js`);
      console.log(
        `🧪 [Dry Run] ${this.config.srcDir}/main.app.js would be updated to remove imports/registrations for '${capitalizedName}'.`,
      );
      console.log('🧪 [Dry Run] No files were deleted or modified.');
      return;
    }

    if (fs.existsSync(bridgePath)) {
      fs.rmSync(bridgePath, { force: true });
      console.log(`✅ Bridge '${capitalizedName}' file deleted at ${this.config.srcDir}/global/${lowerName}.bridge.js`);
    } else {
      console.log(`ℹ️ Bridge '${capitalizedName}' file was not found.`);
    }

    this.unregisterFromMainApp(capitalizedName, lowerName);
  }

  /**
   * Destroys a Guard class file.
   * @param {string} name
   * @param {boolean} [dryRun]
   */
  destroyGuard(name, dryRun = false) {
    if (!name) {
      this.fail('Please provide a guard name (e.g., avenx d guard auth)');
      return;
    }

    const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
    const capitalizedName = baseName + 'Guard';
    const guardDir = path.join(this.baseDir, this.config.srcDir, 'guards');
    const guardPath = path.join(guardDir, `${lowerName}.guard.js`);

    if (dryRun) {
      console.log(`🧪 [Dry Run] Guard '${capitalizedName}' file would be deleted:`);
      console.log(`  ${this.config.srcDir}/guards/${lowerName}.guard.js`);
      console.log(
        `🧪 [Dry Run] ${this.config.srcDir}/main.app.js would be updated to remove imports/registrations for '${capitalizedName}'.`,
      );
      console.log('🧪 [Dry Run] No files were deleted or modified.');
      return;
    }

    if (fs.existsSync(guardPath)) {
      fs.rmSync(guardPath, { force: true });
      console.log(`✅ Guard '${capitalizedName}' file deleted at ${this.config.srcDir}/guards/${lowerName}.guard.js`);
    } else {
      console.log(`ℹ️ Guard '${capitalizedName}' file was not found.`);
    }

    this.unregisterFromMainApp(capitalizedName, lowerName);
  }

  /**
   * Runs the compiler build.
   */
  buildProject() {
    new AvenxCompiler(this.config).build();
  }

  /**
   * Cleans the project by deleting the build output directory.
   */
  cleanProject() {
    const distDir = path.join(this.baseDir, this.config.distDir);
    if (fs.existsSync(distDir)) {
      console.log(`🧹 Cleaning build output directory: ${this.config.distDir}...`);
      fs.rmSync(distDir, { recursive: true, force: true });
      console.log('✅ Clean complete.');
    } else {
      console.log(`🧹 Build output directory ${this.config.distDir} does not exist. Nothing to clean.`);
    }
  }

  /**
   *
   * @param args
   */
  checkProject() {
    const originalWarn = console.warn;
    let warningCount = 0;

    console.warn = (...messages) => {
      warningCount++;
      originalWarn(...messages);
    };

    const compiler = new AvenxCompiler(this.config);

    compiler.processComponents();
    compiler.processPages();

    console.warn = originalWarn;

    if (warningCount > 0) {
      console.error(`\nFound ${warningCount} validation warning(s).`);
      process.exit(1);
    }

    console.log('✓ No template validation issues found.');

    process.exit(0);
  }

  /**
   * Starts a local development server and watches for changes.
   * @param port
   */
  serveProject(port, host = 'localhost') {
    this.liveReloadClients = [];
    this.buildProject();
    this.watchProject();

    const server = http.createServer((req, res) => {
      if (req.url === '/__avenx_live_reload__') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: connected\n\n');

        this.liveReloadClients.push(res);

        req.on('close', () => {
          this.liveReloadClients = this.liveReloadClients.filter((client) => client !== res);
        });
        return;
      }
      if (req.url === '/__avenx-inspect') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getInspectorHtml());
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
    window.__avenx_inspect_enabled = true;
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

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `\n❌ Port ${port} is already in use.\n` +
            `   Stop the process using that port, or start the dev server on a different one.\n`,
        );
        process.exit(1);
      }
      // Re-throw anything unexpected so it is not silently swallowed.
      throw err;
    });

    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.log(`\n🚀 Dev-Server running at ${url}`);
      console.log(`👀 Watching for changes in ${this.config.srcDir}/...\n`);
      this.openBrowser(url);
    });
  }

  /**
   * Watches the src directory for changes and triggers a rebuild.
   */
  watchProject() {
    let timeout;
    const srcPath = path.join(this.baseDir, this.config.srcDir);

    if (!fs.existsSync(srcPath)) return;

    fs.watch(srcPath, { recursive: true }, (eventType, filename) => {
      if (filename) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          console.log(`\n📄 Change detected: ${filename}. Rebuilding...`);
          this.buildProject();

          if (this.liveReloadClients) {
            this.liveReloadClients.forEach((client) => {
              client.write('data: reload\n\n');
            });
          }
        }, 100);
      }
    });
  }

  /**
   * Opens the browser to the specified URL.
   * @param url
   */
  openBrowser(url) {
    const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${start} ${url}`);
  }

  /**
   * Generates the default index.html template content.
   * @returns {string} The initial HTML template string.
   */
  getInitialHtml() {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Avenx App</title>
    <link rel="stylesheet" href="${this.config.distDir}/bundle.css">
</head>
<body>
    <div id="app"></div>
    <script src="${this.config.distDir}/bundle.js"></script>
</body>
</html>`;
  }

  /**
   * Generates the Dev Server Inspection Dashboard HTML page.
   * @returns {string} The dashboard HTML content.
   */
  getInspectorHtml() {
    const configJson = JSON.stringify(this.config);
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Avenx Inspection Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0f1015;
            --card-bg: rgba(22, 24, 33, 0.7);
            --card-border: rgba(255, 255, 255, 0.08);
            --primary-gradient: linear-gradient(135deg, #a78bfa, #6366f1);
            --text-main: #f3f4f6;
            --text-muted: #9ca3af;
            --accent-cyan: #22d3ee;
            --accent-green: #34d399;
            --accent-red: #f87171;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            overflow-x: hidden;
            background-image: 
                radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(167, 139, 250, 0.1) 0px, transparent 50%);
        }

        .dashboard-wrapper {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--card-border);
            background: rgba(15, 16, 21, 0.8);
            backdrop-filter: blur(12px);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .logo {
            font-size: 1.5rem;
            background: var(--primary-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 800;
        }

        .brand .title {
            font-size: 1.25rem;
            font-weight: 700;
            letter-spacing: -0.025em;
        }

        .badge {
            font-size: 0.8rem;
            font-weight: 600;
            padding: 0.35rem 0.75rem;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            transition: all 0.3s ease;
        }

        .badge.disconnected {
            background: rgba(248, 113, 113, 0.15);
            color: var(--accent-red);
            border: 1px solid rgba(248, 113, 113, 0.3);
        }

        .badge.connected {
            background: rgba(52, 211, 153, 0.15);
            color: var(--accent-green);
            border: 1px solid rgba(52, 211, 153, 0.3);
            box-shadow: 0 0 10px rgba(52, 211, 153, 0.2);
        }

        .dashboard-main {
            display: flex;
            flex: 1;
            padding: 2rem;
            gap: 2rem;
        }

        .sidebar {
            width: 300px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .dashboard-grid {
            flex: 1;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.5rem;
            align-content: start;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 1.5rem;
            backdrop-filter: blur(16px);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.3);
            border-color: rgba(255, 255, 255, 0.15);
        }

        .card h3 {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 1.25rem;
            color: var(--text-main);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card h4 {
            font-size: 0.95rem;
            font-weight: 600;
            margin-top: 1rem;
            margin-bottom: 0.75rem;
            color: var(--accent-cyan);
        }

        .config-item {
            font-size: 0.9rem;
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
        }

        .config-item strong {
            color: var(--text-muted);
        }

        .info-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            max-height: 400px;
            overflow-y: auto;
            padding-right: 0.25rem;
        }

        /* Custom Scrollbar */
        .info-list::-webkit-scrollbar {
            width: 6px;
        }
        .info-list::-webkit-scrollbar-track {
            background: transparent;
        }
        .info-list::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .info-item {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 0.75rem 1rem;
            font-size: 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            transition: background 0.2s;
        }

        .info-item:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .info-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
        }

        .route-path {
            font-family: monospace;
            color: var(--accent-cyan);
            font-weight: 600;
        }

        .route-page {
            color: var(--text-muted);
        }

        .route-info {
            background: rgba(34, 211, 238, 0.05);
            border: 1px solid rgba(34, 211, 238, 0.15);
            border-radius: 8px;
            padding: 0.75rem 1rem;
            font-family: monospace;
            font-size: 0.85rem;
            color: var(--accent-cyan);
        }

        .comp-name {
            font-weight: 600;
            color: #a78bfa;
        }

        .comp-details {
            padding-left: 0.75rem;
            border-left: 2px solid rgba(167, 139, 250, 0.3);
            font-size: 0.8rem;
            color: var(--text-muted);
            width: 100%;
        }

        .bridge-header {
            font-weight: 600;
            color: var(--accent-green);
        }

        .state-explorer {
            font-family: monospace;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 6px;
            padding: 0.5rem;
            margin-top: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
            white-space: pre-wrap;
            word-break: break-all;
            width: 100%;
        }

        hr {
            border: 0;
            border-top: 1px solid var(--card-border);
            margin: 1.25rem 0;
        }
    </style>
</head>
<body>
    <div class="dashboard-wrapper">
        <header class="app-header">
            <div class="brand">
                <span class="logo">▲</span>
                <span class="title">Avenx Inspector</span>
            </div>
            <div class="status-indicator">
                <span class="badge" id="statusBadge">Connecting...</span>
            </div>
        </header>

        <main class="dashboard-main">
            <!-- Sidebar for Config Info -->
            <aside class="sidebar">
                <div class="card config-card">
                    <h3>Dev Server Config</h3>
                    <div class="config-item"><strong>Port:</strong> <span id="confPort">-</span></div>
                    <div class="config-item"><strong>Host:</strong> <span id="confHost">-</span></div>
                    <div class="config-item"><strong>Src Dir:</strong> <span id="confSrc">-</span></div>
                    <div class="config-item"><strong>Dist Dir:</strong> <span id="confDist">-</span></div>
                </div>
            </aside>

            <!-- Dashboard Grid Content -->
            <section class="dashboard-grid">
                <!-- Routing Section -->
                <div class="card grid-card routing-card">
                    <h3>Active Routing Table</h3>
                    <div id="routingList" class="info-list"></div>
                    <hr />
                    <h4>Current Route</h4>
                    <div id="currentRouteInfo" class="route-info">-</div>
                </div>

                <!-- Components Section -->
                <div class="card grid-card components-card">
                    <h3>Active Component Tree</h3>
                    <div id="componentsList" class="info-list"></div>
                </div>

                <!-- Bridges Section -->
                <div class="card grid-card bridges-card">
                    <h3>Bridges & Reactive State</h3>
                    <div id="bridgesList" class="info-list"></div>
                </div>
            </section>
        </main>
    </div>

    <script>
        window.__avenx_config = ${configJson};
        
        const channel = new BroadcastChannel('avenx-inspector-channel');
        let lastUpdate = 0;

        function updateStatus(connected) {
            const badge = document.getElementById('statusBadge');
            if (connected) {
                badge.textContent = 'Live';
                badge.className = 'badge connected';
            } else {
                badge.textContent = 'Disconnected';
                badge.className = 'badge disconnected';
            }
        }

        channel.onmessage = (event) => {
            if (event.data && event.data.type === 'inspect-data') {
                updateStatus(true);
                lastUpdate = Date.now();
                renderDashboard(event.data.data);
            }
        };

        // Render server config immediately
        const config = window.__avenx_config || {};
        document.getElementById('confPort').textContent = config.server?.port || '3000';
        document.getElementById('confHost').textContent = config.server?.host || 'localhost';
        document.getElementById('confSrc').textContent = config.srcDir || 'src';
        document.getElementById('confDist').textContent = config.distDir || 'dist';

        // Request data periodically to establish connection
        function requestUpdate() {
            channel.postMessage('request-inspect-data');
            // If no message received for 2.5 seconds, show disconnected
            if (Date.now() - lastUpdate > 2500) {
                updateStatus(false);
            }
        }

        setInterval(requestUpdate, 1000);
        requestUpdate();

        function renderDashboard(data) {
            // 1. Render routes
            const routingList = document.getElementById('routingList');
            routingList.innerHTML = '';
            if (data.routes && Object.keys(data.routes).length > 0) {
                Object.entries(data.routes).forEach(([pattern, def]) => {
                    const pageName = typeof def === 'string' ? def : def.page;
                    const item = document.createElement('div');
                    item.className = 'info-item';
                    item.innerHTML = \`
                        <div class="info-header">
                            <span class="route-path">\${pattern}</span>
                            <span class="route-page">\${pageName}</span>
                        </div>
                    \`;
                    routingList.appendChild(item);
                });
            } else {
                routingList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No routes configured.</div>';
            }

            // 2. Render current route
            const currentRouteInfo = document.getElementById('currentRouteInfo');
            if (data.currentRoute) {
                currentRouteInfo.innerHTML = \`
                    <div style="margin-bottom:0.25rem;"><strong>Hash:</strong> <span style="color:var(--accent-cyan);">\${data.currentRoute.hash}</span></div>
                    <div style="margin-bottom:0.25rem;"><strong>Page:</strong> \${data.currentRoute.page}</div>
                    <div style="margin-top:0.5rem;"><strong>Params:</strong></div>
                    <pre class="state-explorer">\${JSON.stringify(data.currentRoute.params || {}, null, 2)}</pre>
                \`;
            } else {
                currentRouteInfo.innerHTML = '<div style="color:var(--text-muted);">None (App not routing or on initial load)</div>';
            }

            // 3. Render active components
            const componentsList = document.getElementById('componentsList');
            componentsList.innerHTML = '';
            if (data.activeComponents && data.activeComponents.length > 0) {
                data.activeComponents.forEach((comp) => {
                    const item = document.createElement('div');
                    item.className = 'info-item';
                    item.innerHTML = \`
                        <div class="info-header">
                            <span class="comp-name">\${comp.name}</span>
                        </div>
                        <div class="comp-details">
                            <div style="margin-top:0.25rem;"><strong>Props:</strong></div>
                            <pre class="state-explorer">\${JSON.stringify(comp.props, null, 2)}</pre>
                            <div style="margin-top:0.5rem;"><strong>State:</strong></div>
                            <pre class="state-explorer">\${JSON.stringify(comp.state, null, 2)}</pre>
                        </div>
                    \`;
                    componentsList.appendChild(item);
                });
            } else {
                componentsList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No active components in DOM.</div>';
            }

            // 4. Render bridges
            const bridgesList = document.getElementById('bridgesList');
            bridgesList.innerHTML = '';
            if (data.registeredBridges && Object.keys(data.registeredBridges).length > 0) {
                Object.entries(data.registeredBridges).forEach(([name, state]) => {
                    const item = document.createElement('div');
                    item.className = 'info-item';
                    item.innerHTML = \`
                        <div class="info-header">
                            <span class="bridge-header">\${name}</span>
                        </div>
                        <pre class="state-explorer">\${JSON.stringify(state, null, 2)}</pre>
                    \`;
                    bridgesList.appendChild(item);
                });
            } else {
                bridgesList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No bridges registered.</div>';
            }
        }
    </script>
</body>
</html>`;
  }

  /**
   * Prints the help message with available commands to the console.
   */
  printHelp() {
    console.log(`
\x1b[1;36mAvenx-JS CLI\x1b[0m
\x1b[1mUsage:\x1b[0m \x1b[32mavenx\x1b[0m \x1b[90m<command> [type] [name]\x1b[0m

\x1b[1;36mCommands:\x1b[0m
  \x1b[32minit\x1b[0m                      \x1b[90mInitialize a new Avenx project structure\x1b[0m
  \x1b[32mgenerate component <name>\x1b[0m \x1b[90mGenerate a new component (alias: g)\x1b[0m
  \x1b[32mgenerate page <name>\x1b[0m      \x1b[90mGenerate a new page (alias: g p)\x1b[0m
  \x1b[32mgenerate bridge <name>\x1b[0m    \x1b[90mGenerate a new shared reactive bridge\x1b[0m
  \x1b[32mgenerate guard <name>\x1b[0m     \x1b[90mGenerate a new route guard\x1b[0m
  \x1b[32mdestroy component <name>\x1b[0m  \x1b[90mDelete a component and its registrations (alias: d)\x1b[0m
  \x1b[32mdestroy page <name>\x1b[0m       \x1b[90mDelete a page (alias: d p)\x1b[0m
  \x1b[32mdestroy bridge <name>\x1b[0m     \x1b[90mDelete a shared reactive bridge\x1b[0m
  \x1b[32mdestroy guard <name>\x1b[0m      \x1b[90mDelete a route guard\x1b[0m
  \x1b[32mbuild (b)\x1b[0m                 \x1b[90mBuild the project using configured output directory\x1b[0m
  \x1b[32mclean\x1b[0m                     \x1b[90mClear build output directory\x1b[0m
  \x1b[32mcheck (lint)\x1b[0m              \x1b[90mValidate templates without building\x1b[0m
  \x1b[32mserve [port]\x1b[0m              \x1b[90mStart dev server with hot-reload (default: 3000)\x1b[0m
  \x1b[32mwatch (w)\x1b[0m                 \x1b[90mWatch for file changes and rebuild automatically\x1b[0m
  \x1b[32mhelp\x1b[0m                      \x1b[90mShow this help message\x1b[0m

\x1b[1;36mOptions:\x1b[0m
  \x1b[32m--dry-run, -d\x1b[0m             \x1b[90mPreview actions without writing or deleting any files\x1b[0m
  \x1b[32m--version, -v\x1b[0m            \x1b[90mOutput the current version\x1b[0m
    `);
  }
}

if (command === '-v' || command === '--version') {
  console.log('Avenx-JS v' + packageJson.version);
  process.exit(0);
} else {
  const cli = new AvenxCLI();
  cli.run(command, args);
}
