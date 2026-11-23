import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { bold, cyan, green, yellow, red, gray } from '../colors.js';
import { CONFIG_SCHEMA } from '../../lib/config.js';
import { SCAFFOLD_FILES, readScaffoldFile } from './scaffoldFiles.js';
import { repairBundleReferences, writeRepair } from './doctorRepairs.js';

const MIN_NODE_VERSION = [18, 0, 0];

// One schema, owned by lib/config.js. Doctor used to keep its own copy and
// drifted, warning that valid options such as server.headers were unknown.
const ALLOWED_TOP_LEVEL = CONFIG_SCHEMA.topLevel;

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
 * @param {boolean} [asJson] - emit a single machine-readable JSON document instead of the human report
 * @param {object} [options] - local repairs and preview mode
 * @param {boolean} [options.fix]
 * @param {boolean} [options.dryRun]
 */
export function runDoctor(cli, asJson = false, { fix = false, dryRun = false } = {}) {
  const root = resolveDoctorRoot(cli);
  const results = { pass: 0, warn: 0, fail: 0 };
  const checks = [];
  const repairs = [];
  let area = 'General';

  // Section headings and prose are suppressed in JSON mode so stdout holds a
  // single parseable document; the checks themselves are collected below.
  const log = (...args) => {
    if (!asJson) console.log(...args);
  };

  /**
   * @param {'pass'|'warn'|'fail'} status
   * @param {string} message
   * @param {string} [hint]
   */
  const record = (status, message, hint) => {
    results[status] += 1;
    checks.push({ area, status, message, ...(hint ? { hint } : {}) });
    if (!asJson) printCheck(status, message, hint);
  };

  log(bold(cyan('Avenx Doctor')));
  log(`${gray(`Project root: ${root}`)}\n`);

  // --- Node.js ---
  area = 'Node.js';
  log(bold('Node.js'));
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
  area = 'Project files';
  log(`\n${bold('Project files')}`);
  const pkgPath = path.join(root, 'package.json');
  let isFrameworkRepo = false;
  let validPackage = false;
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
        validPackage = true;
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
  let validConfig = true;
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
        validConfig = false;
        record('fail', 'avenx.config.json must be a JSON object');
      } else {
        record('pass', 'avenx.config.json parsed successfully');
        const unknown = collectUnknownKeys(userConfig, ALLOWED_TOP_LEVEL);
        for (const key of unknown) {
          record(
            'warn',
            `Unrecognized config field "${key}"`,
            `Supported top-level options: ${ALLOWED_TOP_LEVEL.join(', ')}`,
          );
        }
        // Check every nested section CONFIG_SCHEMA defines (everything except
        // topLevel), so a section added to the schema later is covered too.
        for (const [section, allowedKeys] of Object.entries(CONFIG_SCHEMA)) {
          if (section === 'topLevel') continue;
          for (const key of collectUnknownKeys(userConfig[section], allowedKeys, section)) {
            record('warn', `Unrecognized config field "${key}"`);
          }
        }
      }
    } catch (err) {
      validConfig = false;
      record('fail', 'avenx.config.json contains malformed JSON', err.message);
    }
  }

  const canRepair = fix && validPackage && validConfig && !isFrameworkRepo;
  const scaffoldCli = { ...cli, baseDir: root, config: { ...cli.config, ...(validConfig ? userConfig : {}) } };
  if (fix && isFrameworkRepo)
    record('fail', 'Repairs require an application project', 'Run doctor in the application root.');

  /**
   * @param {string} name
   * @param {'create'|'append'|'update'} action
   * @param {string|null} before
   * @param {string} after
   * @returns {boolean} Whether the repair succeeded or was previewed.
   */
  const repair = (name, action, before, after) => {
    if (!canRepair) return false;
    const item = { path: name, action, status: dryRun ? 'planned' : 'applied' };
    repairs.push(item);
    try {
      writeRepair(root, name, before, after, dryRun);
      log(`  ${dryRun ? 'Would' : 'Did'} ${action} ${name}`);
      return true;
    } catch (err) {
      item.status = 'failed';
      item.error = err.message;
      record('fail', `Cannot ${action} ${name}`, err.message);
      return false;
    }
  };

  // --- Directories ---
  area = 'Project structure';
  log(`\n${bold('Project structure')}`);
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
    record('warn', `Build output directory "${distRel}" not found`, 'This is normal before the first `avenx build`.');
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

  for (const name of SCAFFOLD_FILES) {
    try {
      const file = path.join(root, name);
      const expected = readScaffoldFile(scaffoldCli, name);
      if (!fs.existsSync(file)) {
        const repaired = repair(name, 'create', null, expected);
        record(
          repaired && !dryRun ? 'pass' : 'warn',
          `${name} ${repaired && !dryRun ? 'created' : 'missing'}`,
          repaired ? undefined : 'Run `avenx doctor --fix` to create the scaffold file.',
        );
        continue;
      }
      const content = fs.readFileSync(file, 'utf8');
      if (name === '.gitignore') {
        const lines = new Set(content.split(/\r?\n/).map((line) => line.trim()));
        const missing = expected
          .trim()
          .split('\n')
          .filter((line) => !lines.has(line));
        if (missing.length) {
          // Keep the example trackable even when an earlier exception precedes
          // a newly appended .env.* rule.
          if (missing.includes('.env.*') && !missing.includes('!.env.example')) missing.push('!.env.example');
          const eol = content.includes('\r\n') ? '\r\n' : '\n';
          const after = content + (content && !content.endsWith('\n') ? eol : '') + missing.join(eol) + eol;
          const repaired = repair(name, 'append', content, after);
          record(
            repaired && !dryRun ? 'pass' : 'warn',
            `.gitignore ${repaired && !dryRun ? 'entries added' : 'entries missing'}: ${missing.join(', ')}`,
            repaired ? undefined : 'Run `avenx doctor --fix` to append the missing entries.',
          );
        } else record('pass', '.gitignore scaffold entries present');
      } else if (content.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
        record(
          'warn',
          `${name} differs from the scaffold; existing content preserved`,
          'Review custom settings manually if an editor integration is missing.',
        );
      } else record('pass', `${name} present`);
    } catch (err) {
      record('fail', `Cannot check ${name}`, err.message);
    }
  }

  const indexHtml = path.join(root, 'index.html');
  let html = null;
  try {
    if (fs.existsSync(indexHtml)) html = fs.readFileSync(indexHtml, 'utf8');
    else {
      const initial = readScaffoldFile(scaffoldCli, 'index.html');
      if (repair('index.html', 'create', null, initial)) html = initial;
      else record('warn', 'index.html missing at project root', 'Run `avenx doctor --fix` to create it.');
    }
  } catch (err) {
    record('fail', 'Cannot check index.html', err.message);
  }
  if (html !== null) {
    record('pass', 'index.html present');
    // The scaffolded page names the default bundle. Warn only when it names
    // neither the configured JS nor the CSS bundle, so a project that loads the
    // bundle another way is not flagged.
    const outputName = (userConfig && userConfig.outputName) || cli.config.outputName || 'bundle';
    const expectedJs = path.posix.join(distRel.replace(/\\/g, '/'), `${outputName}.js`);
    const expectedCss = path.posix.join(distRel.replace(/\\/g, '/'), `${outputName}.css`);
    const plan = fix ? repairBundleReferences(html, distRel, outputName) : null;
    if (plan && !plan.ambiguous && plan.html !== html) {
      if (repair('index.html', 'update', html, plan.html)) html = plan.html;
    }
    if (plan ? plan.ambiguous || !plan.referenced : !html.includes(expectedJs) && !html.includes(expectedCss)) {
      record(
        fix ? 'fail' : 'warn',
        `index.html does not reference the bundle (${expectedJs} or ${expectedCss})`,
        'Update the script and stylesheet paths in index.html to match outputName and distDir.',
      );
    }
  }

  // --- Git ---
  area = 'Git';
  log(`\n${bold('Git')}`);
  try {
    const output = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (output.trim()) {
      record(
        'warn',
        'Working tree has uncommitted changes',
        'Commit or stash before scaffolding if you want a clean tree.',
      );
    } else {
      record('pass', 'Working tree is clean');
    }
  } catch {
    record(
      fix ? 'fail' : 'warn',
      'Not a git repository (or git is unavailable)',
      'Initialize it with `git init` if wanted, or install Git; doctor does not make that decision.',
    );
  }

  if (asJson) {
    console.log(JSON.stringify({ root, checks, ...results, ...(fix ? { repairs, dryRun } : {}) }, null, 2));
  } else {
    // --- Summary ---
    log(`\n${bold('Summary')}`);
    log(
      `  ${green(`${results.pass} passed`)} · ${yellow(`${results.warn} warnings`)} · ${red(`${results.fail} failed`)}`,
    );
  }
  if (results.fail > 0) {
    if (!asJson) log(`\n${red('Doctor found issues that should be fixed.')}\n`);
    process.exitCode = 1;
  } else if (!asJson) {
    log(`\n${green('Environment looks healthy.')}\n`);
  }
}
