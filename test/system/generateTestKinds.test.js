// @avenx-serial

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const binPath = path.join(repoRoot, 'bin/avenx.js');
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-test-kinds-'));
const env = { ...process.env, NO_COLOR: '1', GIT_CEILING_DIRECTORIES: path.dirname(root) };

/**
 * @typedef {object} ScaffoldCase
 * @property {string} kind Scaffold kind.
 * @property {string} name Name passed to generation.
 * @property {string} alias Alternate spelling passed to test resolution.
 * @property {string} stem Expected source path without the final extension.
 */
/** @type {ScaffoldCase[]} */
const cases = [
  { kind: 'component', name: 'Badge', alias: 'badge', stem: 'src/components/badge/badge.component' },
  { kind: 'page', name: 'UserProfile', alias: 'user_profile', stem: 'src/pages/user-profile.page' },
  { kind: 'bridge', name: 'SessionState', alias: 'sessionState', stem: 'src/global/session-state.bridge' },
  { kind: 'guard', name: 'AccessControl', alias: 'access-control', stem: 'src/guards/access-control.guard' },
];

/**
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  return value.replace(/\\/g, '/');
}

/**
 * @param {string[]} args
 * @param {number} [status]
 * @returns {{stdout: string, stderr: string}}
 */
function run(args, status = 0) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {string} relative
 * @param {string} content
 */
function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * @param {string} relative
 * @returns {string}
 */
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/**
 * Includes directories and timestamps to catch even identical-content rewrites.
 * @param {string} [relative]
 * @returns {Array<[string, number, string]>}
 */
function snapshot(relative = '') {
  const target = path.join(root, relative);
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    return [
      [normalize(relative), stat.mtimeMs, 'directory'],
      ...fs
        .readdirSync(target)
        .sort()
        .flatMap((name) => snapshot(path.join(relative, name))),
    ];
  }
  assert.ok(stat.isFile(), `unexpected fixture entry: ${target}`);
  return [[normalize(relative), stat.mtimeMs, fs.readFileSync(target).toString('hex')]];
}

/**
 * @param {string[]} args
 * @param {number} [status]
 * @returns {{stdout: string, stderr: string}}
 */
function unchanged(args, status = 0) {
  const before = snapshot();
  const result = run(args, status);
  assert.deepEqual(snapshot(), before, `${args.join(' ')} changed the filesystem`);
  return result;
}

/**
 * @typedef {object} VitestReport
 * @property {boolean} success Whether the entire run passed.
 * @property {number} numTotalTests Total discovered test cases.
 * @property {number} numPassedTests Successfully executed test cases.
 * @property {number} numPendingTests Skipped test cases.
 * @property {Array<{name: string, status: string, assertionResults: Array<{status: string}>}>} testResults Per-file execution results.
 */

/**
 * @param {string} config
 * @param {string[]} files
 * @param {number} count
 */
function runVitest(config, files, count) {
  const reportPath = path.join(root, `${config}.results.json`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      config,
      '--reporter=default',
      '--reporter=json',
      '--outputFile',
      reportPath,
      ...files,
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 120000 },
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.ifError(result.error);
  assert.equal(result.status, 0, `generated tests must execute successfully:\n${output}`);
  assert.ok(fs.existsSync(reportPath), `Vitest did not produce its execution report:\n${output}`);
  /** @type {VitestReport} */
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.success, true, output);
  assert.equal(report.testResults.length, files.length, output);
  assert.deepEqual(
    report.testResults.map((file) => normalize(path.relative(root, file.name))).sort(),
    [...files].sort(),
  );
  assert.equal(report.numTotalTests, count, output);
  assert.equal(report.numPassedTests, count, output);
  assert.equal(report.numPendingTests, 0, output);
  for (const file of report.testResults) {
    assert.equal(file.status, 'passed', file.name);
    assert.ok(file.assertionResults.length > 0, `${file.name} ran no tests`);
    for (const assertion of file.assertionResults) assert.equal(assertion.status, 'passed', file.name);
  }
  assert.doesNotMatch(output, /AVX_R(08|33|34)/, output);
  console.log(`Vitest ${config}: files=${files.length}, passed=${count}, skipped=0`);
}

try {
  run(['init', '--yes']);
  const flagAliases = {
    component: [['-t', 'house']],
    page: [['--template=house']],
    bridge: [['-t=house']],
    guard: [],
  };
  for (const { kind, name, alias, stem } of cases) {
    run(['generate', kind, name]);
    const source = read(`${stem}.js`);
    const main = read('src/main.app.js');
    for (const flag of kind === 'page' ? ['--dry-run', '-d'] : ['--dry-run']) {
      const preview = unchanged(['generate', flag, 'test', alias]);
      assert.ok(normalize(preview.stdout).includes(`${stem}.test.js`));
    }
    run(['generate', 'test', alias]);
    const builtin = read(`${stem}.test.js`);
    assert.equal(read(`${stem}.js`), source);
    assert.equal(read('src/main.app.js'), main);
    for (const flag of kind === 'page' ? ['--force', '-f'] : ['--force']) {
      write(`${stem}.test.js`, '// keep this test\n');
      const refused = unchanged(['g', 'test', kind, name], 1);
      assert.match(refused.stderr, /already exists/);
      unchanged(['g', 'test', kind, flag, name, '--dry-run']);
      run(['g', 'test', kind, flag, name]);
      assert.equal(read(`${stem}.test.js`), builtin);
    }
    const override = `.avenxtemplates/${kind}/house/${kind}.test.js.template`;
    write(override, '// house {{file}}\n');
    for (const flags of [['--template', 'house'], ...flagAliases[kind]]) {
      unchanged(['g', ...flags, 'test', kind, name, '-f', '-d']);
      run(['g', 'test', kind, ...flags, name, '-f']);
      assert.match(read(`${stem}.test.js`), /^\/\/ house /);
    }
    const missing = unchanged(['g', 'test', kind, name, '-f', '--template', 'ghost'], 1);
    assert.match(missing.stderr, /No scaffold template named "ghost"/);
    if (kind === 'page') {
      const missingDry = unchanged(['g', 'test', kind, name, '-f', '-t', 'ghost', '--dry-run'], 1);
      assert.match(missingDry.stderr, /No scaffold template named "ghost"/);
    }
    run(['g', 'test', kind, name, '-f']);
    assert.equal(read(`${stem}.test.js`), builtin);
  }

  const config = read('avenx.config.json');
  write('avenx.config.json', JSON.stringify({ srcDir: 'app' }));
  for (const [kind, folder] of [
    ['page', 'pages'],
    ['bridge', 'global'],
    ['guard', 'guards'],
  ]) {
    const name = `custom-${kind}`;
    run(['g', kind, name]);
    run(['g', 'test', `custom_${kind}`]);
    assert.ok(fs.existsSync(path.join(root, `app/${folder}/${name}.${kind}.test.js`)));
    assert.equal(fs.existsSync(path.join(root, `src/${folder}/${name}.${kind}.test.js`)), false);
  }
  write('avenx.config.json', config);

  run(['g', 'component', 'home']);
  run(['g', 'page', 'home']);
  const ambiguity =
    '❌ "home" is ambiguous. Did you mean:\n' +
    '   component home  src/components/home/home.component.js\n' +
    '   page home  src/pages/home.page.js\n';
  for (const flags of [[], ['--dry-run'], ['--force'], ['-f', '-d']]) {
    assert.equal(unchanged(['g', 'test', 'home', ...flags], 1).stderr.replace(/\r\n/g, '\n'), ambiguity);
  }
  assert.equal(fs.existsSync(path.join(root, 'src/pages/home.page.test.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/components/home/home.component.test.js')), false);
  run(['g', 'test', 'page', 'home']);
  assert.ok(fs.existsSync(path.join(root, 'src/pages/home.page.test.js')));
  run(['g', 'test', 'component', 'home']);
  assert.ok(fs.existsSync(path.join(root, 'src/components/home/home.component.test.js')));
  assert.match(unchanged(['g', 'test', 'widget', 'home'], 1).stderr, /Unknown test kind "widget"/);
  assert.match(unchanged(['g', 'test', 'page', 'home', 'extra'], 1).stderr, /Too many arguments/);
  for (const args of [[], ['Missing'], ['guard', 'Missing'], ['page', '../outside']]) {
    unchanged(['g', 'test', ...args], 1);
  }

  run(['g', 'page', 'Automatic', '--with-test']);
  for (const suffix of ['js', 'css', 'test.js']) {
    assert.ok(fs.existsSync(path.join(root, `src/pages/automatic.page.${suffix}`)));
  }
  run(['g', 'page', 'OptOut', '--with-test', '--no-test']);
  assert.equal(fs.existsSync(path.join(root, 'src/pages/opt-out.page.test.js')), false);
  unchanged(['g', 'page', 'Preview', '--with-test', '--dry-run']);
  write('.avenxtemplates/page/broken/page.test.js.template', '{{PascalCaseNam}}');
  for (const flags of [[], ['--dry-run'], ['--force']]) {
    const invalid = unchanged(['g', 'page', 'Broken', '--with-test', '--template', 'broken', ...flags], 1);
    assert.match(invalid.stderr, /Unknown generator placeholder/);
  }
  console.log('Generate test kind resolution, disambiguation, flag parity and page --with-test contracts passed');

  // Link local packages, as in generateComponentTest: no registry or network dependency.
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(modules, '@avenx'), { recursive: true });
  for (const [name, target] of [
    ['avenx-core', repoRoot],
    ['@avenx/vite', path.join(repoRoot, 'plugins/avenx-vite')],
    ['vitest', path.join(repoRoot, 'node_modules/vitest')],
    ['happy-dom', path.join(repoRoot, 'node_modules/happy-dom')],
  ]) {
    assert.ok(fs.existsSync(target), `${name} must be installed to execute generated tests; run pnpm install`);
    fs.symlinkSync(target, path.join(modules, name), 'junction');
  }
  const files = cases.filter(({ kind }) => kind !== 'component').map(({ stem }) => `${stem}.test.js`);
  const originals = files.map(read);
  const configMatch = originals[0].match(/vitest\.config\.js includes:\r?\n([\s\S]*?)\r?\n \* 3\. Run:/);
  assert.ok(configMatch, 'the page test must document its executable Vitest configuration');
  write('vitest.config.js', `${configMatch[1].replace(/^ \*\s{6}/gm, '')}\n`);
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const supportsVitest = nodeMajor === 24 || nodeMajor >= 26 || (nodeMajor === 22 && nodeMinor >= 12);
  if (supportsVitest) {
    runVitest('vitest.config.js', files, 6);
    write('vitest.node.config.js', "export default { test: { environment: 'node' } };\n");
    runVitest('vitest.node.config.js', [files[1]], 1);
    assert.deepEqual(files.map(read), originals, 'Vitest must execute the generated files unchanged');
  } else {
    console.log(`Skipping the Vitest run: Vitest 5 does not support Node ${process.versions.node}`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
