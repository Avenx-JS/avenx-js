import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateComponentName } from '../utils.js';
import loadConfig from '../../lib/config.js';
import { runWizard } from '../wizard.js';
import { readScaffoldFile } from './scaffoldFiles.js';
import { bold, cyan, green, red, gray } from '../colors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

/**
 * Reads the optional project name from the arguments of `avenx init`.
 *
 * `avenx init` scaffolds into the current directory; `avenx init my-app`
 * creates `./my-app` and scaffolds into it, as other scaffolders do. Any
 * further word is refused rather than discarded: `init` used to accept and
 * ignore extra words, which scattered a project across the current directory
 * and exited 0.
 * @param {string[]} args - The arguments passed after `init`.
 * @returns {string|null} The project name, or null to use the current directory.
 * @throws {never} Exits the process with code 1 when more than one name is given.
 */
function projectNameFrom(args) {
  const flagsWithValues = ['--layout', '--style'];
  const names = [];

  for (let i = 0; i < (args || []).length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      // If it is a flag that takes a value in the next argument, skip the next argument.
      if (flagsWithValues.includes(arg)) {
        i++;
      }
    } else {
      names.push(arg);
    }
  }

  if (names.length > 1) {
    console.error(red(`avenx init takes at most one project name (got "${names.join('", "')}").`));
    process.exit(1);
  }

  return names[0] || null;
}

/**
 * Checks the directory `avenx init <name>` will create before anything is
 * written: the name must follow the rules of the other scaffold commands, and
 * an existing directory must be empty unless `--force` is given.
 * @param {string} name - The project name.
 * @param {boolean} force - Whether `--force` was given.
 * @returns {string} The absolute path of the project directory.
 * @throws {never} Exits the process with code 1 when the name or the target is refused.
 */
function projectDirectoryFor(name, force) {
  const result = validateComponentName(name);
  if (!result.valid) {
    console.error(red(`❌ Error: Invalid project name "${name}".`));
    console.error(gray(`   ${result.reason}`));
    process.exit(1);
  }

  const target = path.resolve(process.cwd(), name);
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) {
      console.error(red(`❌ Error: "${name}" already exists and is not a directory.`));
      process.exit(1);
    }
    if (!force && fs.readdirSync(target).length > 0) {
      console.error(red(`❌ Error: "${name}" already exists and is not empty.`));
      console.error(gray('   Pass --force to scaffold into it anyway.'));
      process.exit(1);
    }
  }
  return target;
}

/**
 * Initializes a new Avenx project structure.
 * @param {object} cli - AvenxCLI instance.
 * @param {string[]} [args] - CLI arguments.
 */
export async function initProject(cli, args = []) {
  const projectName = projectNameFrom(args);
  const projectDir = projectName
    ? projectDirectoryFor(projectName, args.includes('--force') || args.includes('-f'))
    : null;

  const { stylePreprocessor, layoutTemplate, isInteractive } = await runWizard(args);

  if (projectDir) {
    // Everything below writes under cli.baseDir, and the package.json name is
    // taken from its last segment, so it matches the directory.
    fs.mkdirSync(projectDir, { recursive: true });
    cli.baseDir = projectDir;
    cli.config = loadConfig(projectDir);
  }

  console.log(
    bold(cyan(`🚀 Initializing new Avenx-JS project (Style: ${stylePreprocessor}, Layout: ${layoutTemplate})...`)),
  );

  // Write avenx.config.json if preprocessor option is configured
  const configPath = path.join(cli.baseDir, 'avenx.config.json');
  let userConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      userConfig = {};
    }
  }

  userConfig.style = {
    ...userConfig.style,
    preprocessor: stylePreprocessor,
  };

  fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2) + '\n');
  if (!fs.existsSync(configPath)) {
    console.log('  Created: avenx.config.json');
  } else {
    console.log('  Updated: avenx.config.json');
  }
  cli.config = { ...cli.config, ...userConfig };

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
    const template = readScaffoldFile(cli, '.vscode/jsconfig.json');
    fs.writeFileSync(jsConfigPath, template);
    console.log('  Created: .vscode/jsconfig.json');
  }

  // Teaches the editor's HTML mode about Avenx's own tags, which is what turns
  // component files from "markup the editor does not understand" into files
  // with completion and hover documentation. Referenced by settings.json.
  const htmlDataPath = path.join(cli.baseDir, '.vscode/avenx.html-data.json');
  if (!fs.existsSync(htmlDataPath)) {
    const template = readScaffoldFile(cli, '.vscode/avenx.html-data.json');
    fs.writeFileSync(htmlDataPath, template);
    console.log('  Created: .vscode/avenx.html-data.json');
  }

  const settingsPath = path.join(cli.baseDir, '.vscode/settings.json');
  if (!fs.existsSync(settingsPath)) {
    const template = readScaffoldFile(cli, '.vscode/settings.json');
    fs.writeFileSync(settingsPath, template);
    console.log('  Created: .vscode/settings.json');
  }

  // Create initial index.html
  const indexHtmlPath = path.join(cli.baseDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    fs.writeFileSync(indexHtmlPath, readScaffoldFile(cli, 'index.html'));
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
          '<div @css pageContainer>\n' +
          '    <h1>{{ title }} Page</h1>\n' +
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
          'pageContainer {\n' +
          '    padding: 20px;\n' +
          '    font-family: sans-serif;\n' +
          '    max-width: 800px;\n' +
          '    margin: 0 auto;\n' +
          '}\n' +
          '</@css>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/home.page.css`);
    }

    // Write About page
    if (!fs.existsSync(aboutPageJsPath)) {
      fs.writeFileSync(
        aboutPageJsPath,
        '<state title="About" />\n\n' +
          '<Navbar />\n\n' +
          '<div @css pageContainer>\n' +
          '    <h1>{{ title }} Page</h1>\n' +
          '    <p>Welcome to the about page.</p>\n' +
          '</div>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/about.page.js`);
    }
    if (!fs.existsSync(aboutPageCssPath)) {
      fs.writeFileSync(
        aboutPageCssPath,
        '<@css>\n' +
          'pageContainer {\n' +
          '    padding: 20px;\n' +
          '    font-family: sans-serif;\n' +
          '    max-width: 800px;\n' +
          '    margin: 0 auto;\n' +
          '}\n' +
          '</@css>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/pages/about.page.css`);
    }

    // Write Navbar component
    if (!fs.existsSync(navbarJsPath)) {
      fs.writeFileSync(
        navbarJsPath,
        '<state activeRoute="" />\n\n' +
          '<action name="onMount">\n' +
          "    this.state.activeRoute = window.location.hash || '#/';\n" +
          '</action>\n\n' +
          '<nav>\n' +
          '    <@css container />\n' +
          "    <a @css link href=\"#/\" aria-current=\"{{ activeRoute === '#/' ? 'page' : '' }}\">Home</a>\n" +
          "    <a @css link href=\"#/about\" aria-current=\"{{ activeRoute === '#/about' ? 'page' : '' }}\">About</a>\n" +
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
          '</@global>\n\n' +
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
          '        &:hover {\n' +
          '            color: @primary;\n' +
          '        }\n' +
          '    }\n' +
          '</@css>\n',
      );
      console.log(`  Created: ${cli.config.srcDir}/components/navbar/navbar.component.css`);
    }
  }

  // Create or update package.json
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
    console.log('   Created: package.json');
  } else {
    try {
      const existingPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (existingPkg.type !== 'module') {
        existingPkg.type = 'module';
        fs.writeFileSync(packageJsonPath, JSON.stringify(existingPkg, null, 2) + '\n');
        console.log('   Updated: package.json (set type: module)');
      }
    } catch {
      // If parsing fails, leave the file as is
    }
  }

  // Create initial .gitignore
  const gitignorePath = path.join(cli.baseDir, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, readScaffoldFile(cli, '.gitignore'));
    console.log('  Created: .gitignore');
  }
  // Create initial .prettierrc
  const prettierPath = path.join(cli.baseDir, '.prettierrc');

  if (!fs.existsSync(prettierPath)) {
    const template = readScaffoldFile(cli, '.prettierrc');

    fs.writeFileSync(prettierPath, template);

    console.log('  Created: .prettierrc');
  }

  // Last, so the success line is the last thing printed. It used to be
  // followed by another "Created:" line, which reads as work continuing after
  // the command claimed to be finished.
  console.log(green('✅ Project initialized successfully!'));
  if (projectName) {
    console.log(gray(`   Next: cd ${projectName}`));
  }
  if (isInteractive) {
    process.stdin.pause();
  }
}
