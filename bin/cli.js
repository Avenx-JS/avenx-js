import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from '../lib/config.js';
import { loadEnv } from '../lib/env.js';
import { checkGitStatus } from './utils.js';
import { createSeverityFormatter, cyan, gray } from './colors.js';
import { initProject } from './commands/init.js';
import { generateComponent, generatePage, generateBridge, generateGuard } from './commands/generate.js';
import { destroyComponent, destroyPage, destroyBridge, destroyGuard } from './commands/destroy.js';
import { buildProject, cleanProject, checkProject } from './commands/build.js';
import { serveProject, watchProject } from './commands/serve.js';
import { printHelp } from './commands/help.js';
import { runDoctor } from './commands/doctor.js';
import { runInspect } from './commands/inspect.js';
import { runStats } from './commands/stats.js';
import { runEnv } from './commands/env.js';
import { explainDiagnostic } from './commands/explain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const findProjectRoot = loadConfig.findProjectRoot;

/**
 * Avenx CLI - Command Line Interface router for Avenx-JS.
 */
export class AvenxCLI {
  /**
   * Creates an instance of AvenxCLI.
   * Initializes the base directory and framework directory paths.
   * @param {object} [options]
   */
  constructor(options = {}) {
    this.baseDir = options.baseDir || findProjectRoot(process.cwd());
    loadEnv(this.baseDir);
    this.frameworkDir = path.join(__dirname, '..');
    this.config = { ...loadConfig(this.baseDir), ...options };
    // Tint compiler warnings yellow and errors red for every command that compiles
    // (build, check, watch, serve). Stays inert when colors are unsupported.
    this.config.logging = { ...this.config.logging, formatter: createSeverityFormatter() };
  }

  /**
   * Serves the project on specified port and host.
   * @param {number} port
   * @param {string} host
   * @param {boolean} [open] - Whether to open the browser automatically.
   */
  serveProject(port, host, open) {
    return serveProject(this, port, host, open);
  }

  /**
   * Executes a given CLI command with provided arguments.
   * @param {string} command - The command to run (e.g., 'init', 'generate', 'build', 'serve', 'help').
   * @param {string[]} args - Additional arguments for the command.
   */
  async run(command, args = []) {
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const force = args.includes('--force') || args.includes('-f');
    const withTest = args.includes('--with-test');
    const noTest = args.includes('--no-test');

    // `avenx build` is production by default; `--dev` opts out. `--prod` is
    // accepted so a script can state the intent it relies on. `serve` and
    // `watch` are development unless the flag says otherwise.
    const explicitDev = args.includes('--dev') || args.includes('--development');
    const explicitProd = args.includes('--prod') || args.includes('--production');
    if (explicitDev) {
      this.config.mode = 'development';
    } else if (explicitProd) {
      this.config.mode = 'production';
    } else if (command === 'serve' || command === 'watch' || command === 'w') {
      this.config.mode = 'development';
    }

    let templateName = null;
    const templateIndex = args.findIndex((arg) => arg === '--template' || arg === '-t');
    if (templateIndex !== -1 && templateIndex + 1 < args.length) {
      templateName = args[templateIndex + 1];
    } else {
      const templateInline = args.find((arg) => arg.startsWith('--template=') || arg.startsWith('-t='));
      if (templateInline) {
        templateName = templateInline.split('=').slice(1).join('=');
      }
    }

    const filteredArgs = args.filter(
      (arg, idx) =>
        arg !== '--dry-run' &&
        arg !== '-d' &&
        arg !== '--force' &&
        arg !== '-f' &&
        arg !== '--no-color' &&
        arg !== '--no-colors' &&
        arg !== '--dev' &&
        arg !== '--development' &&
        arg !== '--prod' &&
        arg !== '--production' &&
        arg !== '--template' &&
        arg !== '-t' &&
        !(templateIndex !== -1 && idx === templateIndex + 1) &&
        !arg.startsWith('--template=') &&
        !arg.startsWith('-t=') &&
        arg !== '--with-test' &&
        arg !== '--no-test',
    );
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
        await initProject(this, args);
        process.exit(0);
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
          generateBridge(this, name, dryRun, force, templateName);
        } else if (type === 'guard') {
          generateGuard(this, name, dryRun, force, templateName);
        } else if (type === 'page' || type === 'p') {
          generatePage(this, name, dryRun, force, templateName);
        } else if (type === 'component' || type === 'c') {
          generateComponent(this, name, dryRun, force, templateName, withTest, noTest);
        } else {
          // Default to component if type is not specified (e.g., `avenx g MyButton`)
          generateComponent(this, type, dryRun, force, templateName, withTest, noTest);
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
          destroyBridge(this, name, dryRun);
        } else if (type === 'guard') {
          destroyGuard(this, name, dryRun);
        } else if (type === 'page' || type === 'p') {
          destroyPage(this, name, dryRun);
        } else if (type === 'component' || type === 'c') {
          destroyComponent(this, name, dryRun);
        } else {
          // Default to component if only one arg or type is 'component'
          destroyComponent(this, name || type, dryRun);
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
        buildProject(this);
        break;
      case 'clean':
        cleanProject(this);
        break;
      case 'check':
      case 'lint':
        checkProject(this, args);
        break;
      case 'doctor':
        runDoctor(this);
        break;
      case 'env':
        runEnv(this);
        break;
      case 'inspect':
      case 'i':
        runInspect(this);
        break;
      case 'stats':
      case 's':
        runStats(this, args);
        break;
      case 'serve': {
        const portIdx = args.findIndex((a) => a === '--port' || a === '-p' || a.startsWith('--port=') || a.startsWith('-p='));
        const hostIdx = args.findIndex((a) => a === '--host' || a === '-h' || a.startsWith('--host=') || a.startsWith('-h='));
        const open = args.includes('--open') || args.includes('-o');

        if (args.includes('--no-live-reload') || args.includes('--live-reload=false')) {
          this.config.server.liveReload = false;
        }

        const rawPortVal = portIdx !== -1
          ? (args[portIdx].includes('=') ? args[portIdx].split('=').slice(1).join('=') : args[portIdx + 1])
          : (!args[0]?.startsWith('-') ? args[0] : null);
        const rawPort = rawPortVal?.replace(/[^0-9]/g, '');
        const port = rawPort
          ? parseInt(rawPort, 10)
          : (process.env.PORT ? parseInt(String(process.env.PORT).replace(/[^0-9]/g, ''), 10) : null) || this.config.server?.port || 3000;

        const rawHostVal = hostIdx !== -1
          ? (args[hostIdx].includes('=') ? args[hostIdx].split('=').slice(1).join('=') : args[hostIdx + 1])
          : null;
        const host = rawHostVal ? rawHostVal.trim().replace(/\/+$/g, '') : 'localhost';

        this.serveProject(port, host, open);
        break;
      }
      case 'watch':
      case 'w':
        console.log(cyan(`👀 Watching for changes in ${this.config.srcDir}/...\n`));
        buildProject(this);
        watchProject(this);
        process.on('SIGINT', () => {
          console.log(`\n${gray('Stopping watch...')}`);
          process.exit(0);
        });
        break;
      case 'explain': {
        const asJson = args.includes('--json');
        const codeArg = args.find((a) => !a.startsWith('-'));
        explainDiagnostic(this, codeArg, asJson);
        break;
      }
      case 'help':
      default:
        printHelp();
        break;
    }
  }
}
