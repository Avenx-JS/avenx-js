import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { bold, cyan, green, yellow, red, gray } from '../colors.js';
import { CONFIG_SCHEMA } from '../../lib/config.js';

const MIN_NODE_VERSION = [18, 0, 0];

// One schema, owned by lib/config.js. Doctor used to keep its own copy and
// drifted, warning that valid options such as server.headers were unknown.
const ALLOWED_TOP_LEVEL = CONFIG_SCHEMA.topLevel;
const ALLOWED_SERVER = CONFIG_SCHEMA.server;
const ALLOWED_STYLE = CONFIG_SCHEMA.style;
const ALLOWED_DEBUG = CONFIG_SCHEMA.debug;
const ALLOWED_LOGGING = CONFIG_SCHEMA.logging;

/**
 * @param {number[]} current
 * @param {number[]} required
 * @returns {boolean}
 */
function compareVersions(current, required) {
  for (let i = 0; i < required.length; i++) {
    if ((current[i] || 0) > required[i]) return true;
    if ((current[i] || 0) < required[i]) return false;
  }
  return true;
}

/**
 * @param {'pass'|'warn'|'fail'} status
 * @param {string} message
 * @param {string} [hint]
 */
function printCheck(status, message, hint) {
  const icons = { pass: green('✔'), warn: yellow('⚠'), fail: red('✖') };
  console.log(`  ${icons[status]} ${message}`);
  if (hint) {
    console.log(`    ${gray(`→ ${hint}`)}`);
  }
}

/**
 * @param {object} obj
 * @param {string[]} allowed
 * @param {string} prefix
 * @returns {string[]}
 */
function collectUnknownKeys(obj, allowed, prefix = '') {
  const unknown = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return unknown;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      unknown.push(prefix ? `${prefix}.${key}` : key);
    }
  }
  return unknown;
}

/**
 * Prefer an explicit app/framework root over findProjectRoot skipping avenx-core.
 * @param {object} cli
 * @returns {string}
 */
function resolveDoctorRoot(cli) {
  const cwd = process.cwd();
  const cwdPkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(cwdPkgPath)) {
    return cwd;
  }
  return cli.baseDir;
}

/**
 * Runs environment and project health diagnostics.
 * @param {object} cli
 */
export function runDoctor(cli) {
  const root = resolveDoctorRoot(cli);
  const results = { pass: 0, warn: 0, fail: 0 };
  /**
   * @param {'pass'|'warn'|'fail'} status
   * @param {string} message
   * @param {string} [hint]
   */
  const record = (status, message, hint) => {
    results[status] += 1;
    printCheck(status, message, hint);
  };

  console.log(bold(cyan('Avenx Doctor')));
  console.log(`${gray(`Project root: ${root}`)}\n`);

  // --- Node.js ---
  console.log(bold('Node.js'));
  const current = process.versions.node.split('.').map(Number);
  if (compareVersions(current, MIN_NODE_VERSION)) {
    record('pass', `Node.js ${process.versions.node} (>= ${MIN_NODE_VERSION.join('.')})`);
  } else {
    record(
      'fail',
      `Node.js ${process.versions.node} is below the required ${MIN_NODE_VERSION.join('.')}`,
      'Upgrade Node.js to version 18 or later.',
    );
  }

  // --- package.json ---
  console.log(`\n${bold('Project files')}`);
  const pkgPath = path.join(root, 'package.json');
  let isFrameworkRepo = false;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === 'avenx-core') {
        isFrameworkRepo = true;
        record(
          'warn',
          'Running inside the avenx-core framework repository',
          'Doctor is intended for application projects created with `avenx init`.',
        );
      } else {
        record('pass', `package.json found (name: ${pkg.name || 'unnamed'})`);
      }
    } catch (err) {
      record('fail', 'package.json exists but is not valid JSON', err.message);
    }
  } else {
    record('fail', 'package.json not found', 'Run doctor from an Avenx project root, or create one with `avenx init`.');
  }

  // --- avenx.config.json ---
  const configPath = path.join(root, 'avenx.config.json');
  let userConfig = null;
  if (!fs.existsSync(configPath)) {
    record(
      'warn',
      'avenx.config.json not found (defaults will be used)',
      'Run `avenx init` or add an avenx.config.json at the project root.',
    );
  } else {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!userConfig || typeof userConfig !== 'object' || Array.isArray(userConfig)) {
        record('fail', 'avenx.config.json must be a JSON object');
      } else {
        record('pass', 'avenx.config.json parsed successfully');
        const unknown = collectUnknownKeys(userConfig, ALLOWED_TOP_LEVEL);
        for (const key of unknown) {
          record('warn', `Unrecognized config field "${key}"`, `Supported top-level options: ${ALLOWED_TOP_LEVEL.join(', ')}`);
        }
        if (userConfig.server) {
          for (const key of collectUnknownKeys(userConfig.server, ALLOWED_SERVER, 'server')) {
            record('warn', `Unrecognized config field "${key}"`);
          }
        }
        if (userConfig.style) {
          for (const key of collectUnknownKeys(userConfig.style, ALLOWED_STYLE, 'style')) {
            record('warn', `Unrecognized config field "${key}"`);
          }
        }
        if (userConfig.debug) {
          for (const key of collectUnknownKeys(userConfig.debug, ALLOWED_DEBUG, 'debug')) {
            record('warn', `Unrecognized config field "${key}"`);
          }
        }
        if (userConfig.logging) {
          for (const key of collectUnknownKeys(userConfig.logging, ALLOWED_LOGGING, 'logging')) {
            record('warn', `Unrecognized config field "${key}"`);
          }
        }
      }
    } catch (err) {
      record('fail', 'avenx.config.json contains malformed JSON', err.message);
    }
  }

  // --- Directories ---
  console.log(`\n${bold('Project structure')}`);
  const srcRel = (userConfig && userConfig.srcDir) || cli.config.srcDir || 'src';
  const distRel = (userConfig && userConfig.distDir) || cli.config.distDir || 'dist';
  const srcDir = path.join(root, srcRel);
  const distDir = path.join(root, distRel);
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    record('pass', `Source directory present (${srcRel})`);
  } else if (isFrameworkRepo) {
    record(
      'warn',
      `App source directory "${srcRel}" not found (expected for framework checkout)`,
      'Application projects use src/; the framework sources live under lib/.',
    );
  } else {
    record('fail', `Missing source directory "${srcRel}"`, 'Create it or set srcDir in avenx.config.json.');
  }

  if (fs.existsSync(distDir) && fs.statSync(distDir).isDirectory()) {
    record('pass', `Build output directory present (${distRel})`);
  } else {
    record(
      'warn',
      `Build output directory "${distRel}" not found`,
      'This is normal before the first `avenx build`.',
    );
  }

  const expectedSrcChildren = ['components', 'pages', 'global'];
  for (const child of expectedSrcChildren) {
    const childPath = path.join(srcDir, child);
    if (fs.existsSync(childPath) && fs.statSync(childPath).isDirectory()) {
      record('pass', `src/${child} directory present`);
    } else {
      record('warn', `src/${child} directory missing`, 'Optional but recommended for standard Avenx layouts.');
    }
  }

  const jsconfigPath = path.join(root, '.vscode', 'jsconfig.json');
  if (fs.existsSync(jsconfigPath)) {
    record('pass', '.vscode/jsconfig.json present');
  } else {
    record('warn', '.vscode/jsconfig.json missing', 'Created by `avenx init` for editor path aliases.');
  }

  const indexHtml = path.join(root, 'index.html');
  if (fs.existsSync(indexHtml)) {
    record('pass', 'index.html present');
  } else {
    record('warn', 'index.html missing at project root');
  }

  // --- Git ---
  console.log(`\n${bold('Git')}`);
  try {
    const output = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (output.trim()) {
      record('warn', 'Working tree has uncommitted changes', 'Commit or stash before scaffolding if you want a clean tree.');
    } else {
      record('pass', 'Working tree is clean');
    }
  } catch {
    record('warn', 'Not a git repository (or git is unavailable)');
  }

  // --- Summary ---
  console.log(`\n${bold('Summary')}`);
  console.log(
    `  ${green(`${results.pass} passed`)} · ${yellow(`${results.warn} warnings`)} · ${red(`${results.fail} failed`)}`,
  );
  if (results.fail > 0) {
    console.log(`\n${red('Doctor found issues that should be fixed.')}\n`);
    process.exitCode = 1;
  } else {
    console.log(`\n${green('Environment looks healthy.')}\n`);
  }
}
