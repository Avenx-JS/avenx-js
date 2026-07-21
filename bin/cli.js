import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from '../lib/config.js';
import { loadEnv } from '../lib/env.js';
import { checkGitStatus } from './utils.js';
import { initProject } from './commands/init.js';
import { generateComponent, generatePage, generateBridge, generateGuard } from './commands/generate.js';
import { destroyComponent, destroyPage, destroyBridge, destroyGuard } from './commands/destroy.js';
import { buildProject, cleanProject, checkProject } from './commands/build.js';
import { serveProject, watchProject } from './commands/serve.js';
import { printHelp } from './commands/help.js';

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
  }

  /**
   * Executes a given CLI command with provided arguments.
   * @param {string} command - The command to run (e.g., 'init', 'generate', 'build', 'serve', 'help').
   * @param {string[]} args - Additional arguments for the command.
   */
  async run(command, args = []) {
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
          generateBridge(this, name, dryRun);
        } else if (type === 'guard') {
          generateGuard(this, name, dryRun);
        } else if (type === 'page' || type === 'p') {
          generatePage(this, name, dryRun);
        } else {
          // Default to component if only one arg or type is 'component'
          generateComponent(this, name || type, dryRun);
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
        checkProject(this);
        break;
      case 'serve': {
        const portIdx = args.findIndex((a) => a === '--port' || a === '-p');
        const hostIdx = args.findIndex((a) => a === '--host' || a === '-h');

        const port =
          portIdx !== -1 && args[portIdx + 1]
            ? parseInt(args[portIdx + 1], 10)
            : (!args[0]?.startsWith('-') && args[0]) || process.env.PORT || this.config.server.port || 3000;

        const host = hostIdx !== -1 && args[hostIdx + 1] ? args[hostIdx + 1] : 'localhost';

        serveProject(this, port, host);
        break;
      }
      case 'watch':
      case 'w':
        console.log(`👀 Watching for changes in ${this.config.srcDir}/...\n`);
        buildProject(this);
        watchProject(this);
        process.on('SIGINT', () => {
          console.log('\nStopping watch...');
          process.exit(0);
        });
        break;
      case 'help':
      default:
        printHelp();
        break;
    }
  }
}
