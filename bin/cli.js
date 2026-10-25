import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig, { getClosestKey } from '../lib/config.js';
import { loadEnv } from '../lib/env.js';
import { checkGitStatus, validateComponentName } from './utils.js';
import { createSeverityFormatter, cyan, gray, red } from './colors.js';
import { initProject } from './commands/init.js';
import { generateComponent, generatePage, generateBridge, generateGuard } from './commands/generate.js';
import { destroyComponent, destroyPage, destroyBridge, destroyGuard } from './commands/destroy.js';
import { buildProject, cleanProject, checkProject } from './commands/build.js';
import { runFormat } from './commands/format.js';
import { serveProject, watchProject } from './commands/serve.js';
import { printHelp } from './commands/help.js';
import { runDoctor } from './commands/doctor.js';
import { runInspect } from './commands/inspect.js';
import { runStats } from './commands/stats.js';
import { runEnv } from './commands/env.js';
import { explainDiagnostic } from './commands/explain.js';
import { runTrace } from './commands/trace.js';
import { runAtlas, runQuery } from './commands/atlas.js';

/**
 * The scaffold kinds `generate` and `destroy` accept as their first argument.
 * @type {string[]}
 */
const SCAFFOLD_TYPES = ['component', 'c', 'page', 'p', 'bridge', 'guard'];

/**
 * Refuses a scaffold command whose type is not one this CLI knows.
 *
 * `avenx g <name>` is the documented shorthand for generating a component, so
 * an unrecognised first argument is normally a name. It cannot be a name when a
 * second positional argument follows it: `avenx g pge home` can only have meant
 * `avenx g page home`, and reading it as the shorthand created a component
 * called "pge", registered it in `src/main.app.js`, discarded "home" and exited
 * 0.
 * @param {string} command - The command being run, for the message.
 * @param {string} type - The first positional argument.
 * @param {string|undefined} name - The second positional argument, if any.
 * @returns {boolean} True when the command should not proceed.
 */
function refuseUnknownScaffoldType(command, type, name) {
  if (!name || SCAFFOLD_TYPES.includes(type)) return false;

  const verb = command === 'd' || command === 'destroy' ? 'remove' : 'scaffold';
  const closest = getClosestKey(type, SCAFFOLD_TYPES);

  console.error(red(`❌ Error: Unknown type "${type}".`));
  console.error(gray('   Expected one of: component, page, bridge, guard.'));
  if (closest) {
    console.error(gray(`   Did you mean "avenx ${command} ${closest} ${name}"?`));
  }
  console.error(
    gray(`   To ${verb} a component called "${type}", run "avenx ${command} ${type}" with no second argument.`),
  );
  process.exitCode = 1;
  return true;
}
/**
 * Refuses a scaffold command whose name is invalid, contains whitespace,
 * starts with a digit, or attempts directory traversal.
 * @param {string} command The command being run ('g' or 'd').
 * @param {string} name The component/item name to validate.
 * @returns {boolean} True when the command should not proceed.
 */
function refuseInvalidScaffoldName(command, name) {
  if (!name) return false;

  const result = validateComponentName(name);
  if (!result.valid) {
    console.error(red(`❌ Error: Invalid name "${name}".`));
    console.error(gray(`   ${result.reason}`));
    process.exitCode = 1;
    return true;
  }

  return false;
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const findProjectRoot = loadConfig.findProjectRoot;

/**
 * Every command name and alias the CLI dispatches on.
 *
 * Used only to suggest a correction for a mistyped command, so an entry missing
 * here costs a suggestion rather than a command.
 * @type {string[]}
 */
export const KNOWN_COMMANDS = [
  'init',
  'generate',
  'g',
  'destroy',
  'd',
  'build',
  'b',
  'clean',
  'check',
  'lint',
  'doctor',
  'env',
  'explain',
  'inspect',
  'i',
  'stats',
  's',
  'atlas',
  'impact',
  'why',
  'trace',
  'serve',
  'watch',
  'w',
  'format',
  'help',
];

/**
 * Reports a command the CLI does not recognise, with a correction when one is near.
 * @param {string} command - The command as typed.
 * @returns {void}
 */
function reportUnknownCommand(command) {
  const closest = getClosestKey(command, KNOWN_COMMANDS);
  console.error(red(`Unknown command: "${command}"`));
  if (closest) {
    console.error(gray(`Did you mean "avenx ${closest}"?`));
  }
  console.error('');
}

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

    // `--csp-strict` is additive to the mode rather than a mode of its own. A
    // CSP-strict development build is the case that makes the flag worth
    // having: `avenx serve` is where the interpreter -- and with it the last
    // `new Function` -- used to be unavoidable, and a developer whose target
    // deployment forbids 'unsafe-eval' wants to find out at their desk rather
    // than in a staging security review.
    if (args.includes('--csp-strict')) {
      this.config.csp = { ...(this.config.csp || {}), strict: true };
    }
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
        arg !== '--csp-strict' &&
        arg !== '--no-test',
    );
    const type = filteredArgs[0];
    const name = filteredArgs[1];

    switch (command) {
      case 'init':
        if (!force) {
          const proceed = await checkGitStatus(this.baseDir);
          if (!proceed) {
            // Declining is a refusal to run, not a successful no-op. Exiting 0
            // here made `avenx build && deploy` deploy whatever was already in
            // dist/, which contradicts the documented contract that build exits
            // 0 only on a successful build.
            process.exit(1);
          }
        }
        await initProject(this, args);
        process.exit(0);
        break;
      case 'generate':
      case 'g': {
        if (!force) {
          const proceed = await checkGitStatus(this.baseDir);
          if (!proceed) {
            process.exit(1);
          }
        }
        if (refuseUnknownScaffoldType('g', type, name)) {
          break;
        }

        const targetName = SCAFFOLD_TYPES.includes(type) ? name : type;
        if (refuseInvalidScaffoldName('g', targetName)) {
          break;
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
          generateComponent(this, type, dryRun, force, templateName, withTest, noTest);
        }
        break;
      }
      case 'destroy':
      case 'd': {
        if (!force) {
          const proceed = await checkGitStatus(this.baseDir);
          if (!proceed) {
            process.exit(1);
          }
        }
        if (refuseUnknownScaffoldType('d', type, name)) {
          break;
        }

        const targetDestroyName = SCAFFOLD_TYPES.includes(type) ? name : (name || type);
        if (refuseInvalidScaffoldName('d', targetDestroyName)) {
          break;
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
          destroyComponent(this, name || type, dryRun);
        }
        break;
      }
      case 'build':
      case 'b':
        if (!force) {
          const proceed = await checkGitStatus(this.baseDir);
          if (!proceed) {
            // Declining is a refusal to run, not a successful no-op. Exiting 0
            // here made `avenx build && deploy` deploy whatever was already in
            // dist/, which contradicts the documented contract that build exits
            // 0 only on a successful build.
            process.exit(1);
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
        // Recording is opt-in and development-only. It is read here rather
        // than from config alone so that turning it on is always a visible,
        // deliberate act at the command line.
        this.traceEnabled = args.includes('--trace');
        const portIdx = args.findIndex(
          (a) => a === '--port' || a === '-p' || a.startsWith('--port=') || a.startsWith('-p='),
        );
        const hostIdx = args.findIndex(
          (a) => a === '--host' || a === '-h' || a.startsWith('--host=') || a.startsWith('-h='),
        );
        const open = args.includes('--open') || args.includes('-o');

        if (args.includes('--no-live-reload') || args.includes('--live-reload=false')) {
          this.config.server.liveReload = false;
        }

        // The positional port is the first bare argument that is not itself the
        // value of a flag. Only args[0] used to be considered, so any leading
        // flag — `serve --trace 8080`, `serve --open 8080` — silently fell back
        // to the default port.
        const flagValueIndexes = new Set();
        for (const idx of [portIdx, hostIdx]) {
          if (idx !== -1 && !args[idx].includes('=')) {
            flagValueIndexes.add(idx + 1);
          }
        }
        const positionalPort = args.find(
          (arg, idx) => !arg.startsWith('-') && !flagValueIndexes.has(idx) && /^\d+$/.test(arg.trim()),
        );

        const rawPortVal =
          portIdx !== -1
            ? args[portIdx].includes('=')
              ? args[portIdx].split('=').slice(1).join('=')
              : args[portIdx + 1]
            : (positionalPort ?? null);
        const rawPort = rawPortVal?.replace(/[^0-9]/g, '');
        const port = rawPort
          ? parseInt(rawPort, 10)
          : (process.env.PORT ? parseInt(String(process.env.PORT).replace(/[^0-9]/g, ''), 10) : null) ||
            this.config.server?.port ||
            3000;

        const rawHostVal =
          hostIdx !== -1
            ? args[hostIdx].includes('=')
              ? args[hostIdx].split('=').slice(1).join('=')
              : args[hostIdx + 1]
            : null;
        const host = rawHostVal ? rawHostVal.trim().replace(/\/+$/g, '') : 'localhost';

        this.serveProject(port, host, open);
        break;
      }
      case 'watch':
      case 'w':
        console.log(cyan(`👀 Watching for changes in ${this.config.srcDir}/...\n`));
        buildProject(this, { watch: true });
        watchProject(this);
        process.on('SIGINT', () => {
          console.log(`\n${gray('Stopping watch...')}`);
          process.exit(0);
        });
        break;
      case 'format':
        runFormat(this);
        break;
      case 'trace':
        runTrace(this, args);
        break;
      case 'atlas':
        runAtlas(this, args);
        break;
      case 'impact':
        runQuery(this, args, 'in');
        break;
      case 'why':
        runQuery(this, args, 'out');
        break;
      case 'explain': {
        const asJson = args.includes('--json');
        const codeArg = args.find((a) => !a.startsWith('-'));
        explainDiagnostic(this, codeArg, asJson);
        break;
      }
      case 'help':
        printHelp();
        break;
      default:
        // No command at all is a request for help, and exits 0. An
        // *unrecognised* command is a mistake, and used to do the same thing --
        // so `avenx buidl` printed the help text and exited 0, which meant
        // `avenx buidl && deploy` deployed whatever was already in dist/. A
        // mistyped command now says so and exits non-zero.
        if (!command || command.startsWith('-')) {
          printHelp();
          break;
        }
        reportUnknownCommand(command);
        printHelp();
        process.exit(1);
    }
  }
}
