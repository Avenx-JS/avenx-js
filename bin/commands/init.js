import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readTemplate } from '../utils.js';
import { runWizard } from '../wizard.js';
import { getInitialHtml } from './serve.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

/**
 * Initializes a new Avenx project structure.
 * @param {object} cli - AvenxCLI instance.
 * @param {string[]} [args] - CLI arguments.
 */
export async function initProject(cli, args = []) {
  const { stylePreprocessor, layoutTemplate, isInteractive } = await runWizard(args);

  console.log(`🚀 Initializing new Avenx-JS project (Style: ${stylePreprocessor}, Layout: ${layoutTemplate})...`);

  // Write avenx.config.json if preprocessor option is configured
  const configPath = path.join(cli.baseDir, 'avenx.config.json');
  if (!fs.existsSync(configPath)) {
    const userConfig = {
      style: {
        preprocessor: stylePreprocessor,
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2) + '\n');
    console.log('  Created: avenx.config.json');
    cli.config = { ...cli.config, ...userConfig };
  }

  const dirs = [
    `${cli.config.srcDir}/components`,
    `${cli.config.srcDir}/pages`,
    `${cli.config.srcDir}/global`,
    `${cli.config.srcDir}/guards`,
    cli.config.distDir,
    '.vscode',
  ];

  dirs.forEach((dir) => {
    const fullPath = path.join(cli.baseDir, dir);
    const created = fs.mkdirSync(fullPath, { recursive: true });
    if (created) {
      console.log(`  Created: ${dir}`);
    }
  });

  // Create initial .vscode files
  const jsConfigPath = path.join(cli.baseDir, '.vscode/jsconfig.json');
  if (!fs.existsSync(jsConfigPath)) {
    const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'vscode', 'jsconfig.json.template');
    fs.writeFileSync(jsConfigPath, template);
    console.log('  Created: .vscode/jsconfig.json');
  }

  const settingsPath = path.join(cli.baseDir, '.vscode/settings.json');
  if (!fs.existsSync(settingsPath)) {
    const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'vscode', 'settings.json.template');
    fs.writeFileSync(settingsPath, template);
    console.log('  Created: .vscode/settings.json');
  }

  // Create initial index.html
  const indexHtmlPath = path.join(cli.baseDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    fs.writeFileSync(indexHtmlPath, getInitialHtml(cli));
    console.log('  Created: index.html');
  }

  // Create initial main.app.js
  const mainAppPath = path.join(cli.baseDir, cli.config.srcDir, 'main.app.js');
  if (!fs.existsSync(mainAppPath)) {
    if (layoutTemplate === 'routing') {
      fs.writeFileSync(
        mainAppPath,
        "import { AvenxApp } from 'avenx-core/runtime';\n" +
          "import Navbar from './components/navbar/navbar.component.js';\n\n" +
          "const app = new AvenxApp({ target: '#app' });\n\n" +
          "app.register('Navbar', Navbar);\n\n" +
          'app.initRouter({\n' +
          "  '': 'Home',\n" +
          "  '#/': 'Home',\n" +
          "  '#/about': 'About',\n" +
          '});\n',
      );
    } else {
      fs.writeFileSync(
        mainAppPath,
        "import { AvenxApp } from 'avenx-core/runtime';\n\nconst app = new AvenxApp({ target: '#app' });\n",
      );
    }
    console.log(`  Created: ${cli.config.srcDir}/main.app.js`);
  }

  if (layoutTemplate === 'routing') {
    const homePageJsPath = path.join(cli.baseDir, cli.config.srcDir, 'pages', 'home.page.js');
    const homePageCssPath = path.join(cli.baseDir, cli.config.srcDir, 'pages', 'home.page.css');
    const aboutPageJsPath = path.join(cli.baseDir, cli.config.srcDir, 'pages', 'about.page.js');
    const aboutPageCssPath = path.join(cli.baseDir, cli.config.srcDir, 'pages', 'about.page.css');

    const navbarDir = path.join(cli.baseDir, cli.config.srcDir, 'components', 'navbar');
    if (!fs.existsSync(navbarDir)) {
      fs.mkdirSync(navbarDir, { recursive: true });
    }
    const navbarJsPath = path.join(navbarDir, 'navbar.component.js');
    const navbarCssPath = path.join(navbarDir, 'navbar.component.css');

    // Write Home page
    if (!fs.existsSync(homePageJsPath)) {
      fs.writeFileSync(
        homePageJsPath,
        '<state title="Home" />\n\n' +
          '<Navbar />\n\n' +
          '<div class="page-container">\n' +
          '    <h1>Home Page</h1>\n' +
          '    <p>Welcome to the home page of your new Avenx application!</p>\n' +
          '    <p>This layout template demonstrates hash-based routing using AvenxRouter.</p>\n' +
          '</div>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/home.page.js`);
    }
    if (!fs.existsSync(homePageCssPath)) {
      fs.writeFileSync(
        homePageCssPath,
        '<@css>\n' +
          '.page-container {\n' +
          '    padding: 20px;\n' +
          '    font-family: sans-serif;\n' +
          '    max-width: 800px;\n' +
          '    margin: 0 auto;\n' +
          '}\n' +
          '</ @css>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/home.page.css`);
    }

    // Write About page
    if (!fs.existsSync(aboutPageJsPath)) {
      fs.writeFileSync(
        aboutPageJsPath,
        '<state title="About" />\n\n' +
          '<Navbar />\n\n' +
          '<div class="page-container">\n' +
          '    <h1>About Page</h1>\n' +
          '    <p>Welcome to the about page.</p>\n' +
          '</div>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/about.page.js`);
    }
    if (!fs.existsSync(aboutPageCssPath)) {
      fs.writeFileSync(
        aboutPageCssPath,
        '<@css>\n' +
          '.page-container {\n' +
          '    padding: 20px;\n' +
          '    font-family: sans-serif;\n' +
          '    max-width: 800px;\n' +
          '    margin: 0 auto;\n' +
          '}\n' +
          '</ @css>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/about.page.css`);
    }

    // Write Navbar component
    if (!fs.existsSync(navbarJsPath)) {
      fs.writeFileSync(
        navbarJsPath,
        '<state activeRoute="" />\n\n' +
          '<nav>\n' +
          '    <@css container />\n' +
          '    <a @css link href="#/">Home</a>\n' +
          '    <a @css link href="#/about">About</a>\n' +
          '</nav>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/components/navbar/navbar.component.js`);
    }
    if (!fs.existsSync(navbarCssPath)) {
      fs.writeFileSync(
        navbarCssPath,
        '<@global>\n' +
          '    @def primary #6366f1;\n' +
          '    @def dark #1e1b4b;\n' +
          '    @def gray #e2e8f0;\n' +
          '</ @global>\n\n' +
          '<@css>\n' +
          '    container {\n' +
          '        display: flex;\n' +
          '        gap: 1.5rem;\n' +
          '        padding: 1rem 2rem;\n' +
          '        background: @dark;\n' +
          '        border-bottom: 2px solid @primary;\n' +
          '    }\n\n' +
          '    link {\n' +
          '        color: white;\n' +
          '        text-decoration: none;\n' +
          '        font-weight: 500;\n' +
          '        font-family: sans-serif;\n' +
          '    }\n\n' +
          '    link:hover {\n' +
          '        color: @primary;\n' +
          '    }\n' +
          '</ @css>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/components/navbar/navbar.component.css`);
    }
  }

  // Create initial package.json
  const packageJsonPath = path.join(cli.baseDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    const projectName =
      path
        .basename(cli.baseDir)
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
  const gitignorePath = path.join(cli.baseDir, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `node_modules/\n${cli.config.distDir}/\n.DS_Store\n`);
    console.log('  Created: .gitignore');
  }
  console.log('✅ Project initialized successfully!');
  if (isInteractive) {
    process.stdin.pause();
  }
}
