import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '../..');
const BIN = path.join(rootDir, 'bin', 'avenx.js');

/**
 * A component that compiles cleanly.
 * @type {string}
 */
const VALID_COMPONENT = `<state message="Hello" />

<div><h1>{{ message }}</h1></div>`;

/**
 * Creates a project on disk.
 * @param {Record<string, string>} files - Relative path to contents.
 * @returns {string} The project root.
 */
function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-exit-'));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/**
 * A project that builds successfully.
 * @param {Record<string, string>} [extra] - Additional or overriding files.
 * @returns {string} The project root.
 */
function makeValidProject(extra = {}) {
  return makeProject({
    'avenx.config.json': '{}',
    'src/components/hello/hello.component.js': VALID_COMPONENT,
    'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import Hello from './components/hello/hello.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Hello', Hello);
app.mount('Hello');`,
    ...extra,
  });
}

/**
 * Runs the real CLI as a child process, the way CI does.
 * @param {string} cwd - Working directory.
 * @param {string[]} [args] - Arguments after the command.
 * @returns {{status: number, stdout: string, stderr: string, output: string}} The result.
 */
function runBuild(cwd, args = []) {
  const result = spawnSync(process.execPath, [BIN, 'build', '--force', ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

/**
 * Runs `avenx build && <marker>` through a real shell, which is the situation
 * this whole test file exists for.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, output: string, deployRan: boolean}} The result.
 */
function runBuildAndDeploy(cwd) {
  const marker = '__AVENX_DEPLOY_RAN__';
  const result = spawnSync(
    `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} build --force && echo ${marker}`,
    { cwd, encoding: 'utf8', shell: true },
  );
  const output = (result.stdout || '') + (result.stderr || '');
  return { status: result.status, output, deployRan: output.includes(marker) };
}

/**
 * Asserts that a build failed properly: non-zero exit, no success claim.
 * @param {object} result - The result of runBuild.
 * @param {string} label - Description for assertion messages.
 */
function assertFailed(result, label) {
  assert.notStrictEqual(result.status, 0, `${label}: must not exit 0`);
  assert.ok(
    !/Build successful/i.test(result.output),
    `${label}: must not claim the build succeeded`,
  );
}

/**
 * A valid application builds and exits 0.
 */
function testSuccessExitsZero() {
  console.log('🧪 Testing that a valid build exits 0...');
  const root = makeValidProject();
  try {
    const result = runBuild(root);
    assert.strictEqual(result.status, 0, `a valid build must exit 0, got ${result.status}`);
    assert.ok(/Build successful/i.test(result.output), 'a valid build reports success');
    assert.ok(fs.existsSync(path.join(root, 'dist', 'bundle.js')), 'a valid build writes the bundle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('  ✅ Valid build exits 0 and writes output.');
}

/**
 * Every fatal compiler error exits non-zero.
 *
 * Each case is a different route out of the compiler: an early guard, a throw
 * from component compilation, a warning escalated to an error by config, and a
 * throw from bridge analysis. They failed differently before, so they are
 * covered separately rather than as one representative case.
 */
function testFatalErrorsExitNonZero() {
  console.log('🧪 Testing that fatal compiler errors exit non-zero...');

  const cases = [
    {
      label: 'AVX_C02 missing src directory',
      code: 'AVX_C02',
      files: { 'avenx.config.json': '{}' },
      valid: false,
    },
    {
      label: 'AVX_C03 duplicate component names',
      code: 'AVX_C03',
      files: { 'src/components/other/hello.component.js': VALID_COMPONENT },
      valid: true,
    },
    {
      label: 'AVX_W03 escalated to error',
      code: 'AVX_W03',
      files: {
        'avenx.config.json': '{ "warnings": { "AVX_W03": "error" } }',
        'src/components/hello/hello.component.js': '<div>{{ doesNotExist }}</div>',
      },
      valid: true,
    },
    {
      label: 'AVX_C12 invalid bridge module',
      code: 'AVX_C12',
      files: { 'src/bridges/broken.bridge.js': 'export default class Broken {}' },
      valid: true,
    },
  ];

  for (const entry of cases) {
    const root = entry.valid ? makeValidProject(entry.files) : makeProject(entry.files);
    try {
      const result = runBuild(root);
      assertFailed(result, entry.label);
      assert.ok(
        result.output.includes(entry.code),
        `${entry.label}: the output should name ${entry.code}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  console.log(`  ✅ All ${cases.length} fatal error paths exit non-zero.`);
}

/**
 * A failing build stops a chained deployment step.
 */
function testDeploymentChaining() {
  console.log('🧪 Testing that a failed build blocks a chained deploy...');

  const ok = makeValidProject();
  try {
    const result = runBuildAndDeploy(ok);
    assert.ok(result.deployRan, 'a successful build must let the next command run');
  } finally {
    fs.rmSync(ok, { recursive: true, force: true });
  }

  const broken = makeValidProject({ 'src/components/other/hello.component.js': VALID_COMPONENT });
  try {
    const result = runBuildAndDeploy(broken);
    assert.ok(!result.deployRan, 'a failed build must stop the chained deploy');
    assert.notStrictEqual(result.status, 0, 'the shell reports the failure');
  } finally {
    fs.rmSync(broken, { recursive: true, force: true });
  }

  console.log('  ✅ `avenx build && deploy` only deploys on success.');
}

/**
 * A failed build cannot pass off a previous bundle as a fresh one.
 *
 * This is the production hazard: dist/ still holds the last good bundle, the
 * build fails, and a pipeline that trusts the exit code publishes stale code.
 */
function testStaleArtifactCannotBeDeployed() {
  console.log('🧪 Testing that a failed build cannot deploy a stale bundle...');

  const root = makeValidProject();
  try {
    assert.strictEqual(runBuild(root).status, 0, 'the first build succeeds');

    const bundlePath = path.join(root, 'dist', 'bundle.js');
    const firstBuild = fs.readFileSync(bundlePath, 'utf-8');

    // Break the project, then rebuild.
    fs.writeFileSync(path.join(root, 'src', 'components', 'hello', 'hello.component.js'), VALID_COMPONENT);
    fs.mkdirSync(path.join(root, 'src', 'components', 'clash'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'components', 'clash', 'hello.component.js'), VALID_COMPONENT);

    const failed = runBuildAndDeploy(root);
    assert.ok(!failed.deployRan, 'the stale bundle is never handed to a deploy step');
    assert.notStrictEqual(failed.status, 0, 'the failed rebuild exits non-zero');

    // The previous artifact is left intact on purpose: the exit code is what
    // stops the deployment, and deleting a good bundle would break anything
    // still serving it. What must not happen is a torn mix of old and new.
    assert.ok(fs.existsSync(bundlePath), 'the previous bundle is not destroyed');
    assert.strictEqual(
      fs.readFileSync(bundlePath, 'utf-8'),
      firstBuild,
      'the previous bundle is byte-identical: a failed build writes nothing',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('  ✅ Failed rebuilds leave the previous bundle untouched and unpublishable.');
}

/**
 * Failures raised outside the compiler still fail the build.
 *
 * A prebuild hook runs as a child process; a postbuild hook runs after the
 * compiler has already reported success. Both must fail the command.
 */
function testHookFailures() {
  console.log('🧪 Testing that lifecycle hook failures fail the build...');

  const pre = makeValidProject({ 'avenx.config.json': '{ "hooks": { "prebuild": "exit 3" } }' });
  try {
    const result = runBuild(pre);
    assertFailed(result, 'failing prebuild hook');
    assert.ok(!fs.existsSync(path.join(pre, 'dist', 'bundle.js')), 'a failed prebuild hook builds nothing');
  } finally {
    fs.rmSync(pre, { recursive: true, force: true });
  }

  const post = makeValidProject({ 'avenx.config.json': '{ "hooks": { "postbuild": "exit 4" } }' });
  try {
    const result = runBuild(post);
    assert.notStrictEqual(result.status, 0, 'failing postbuild hook: must not exit 0');
  } finally {
    fs.rmSync(post, { recursive: true, force: true });
  }

  console.log('  ✅ Prebuild and postbuild failures both fail the command.');
}

/**
 * An unexpected fatal error is not swallowed.
 *
 * The runtime bundle is a build input. Pointing the compiler at a project is
 * not enough to make one appear, so a missing runtime stands in for the class
 * of unexpected failure that happens after the command starts.
 */
function testUnexpectedErrorExitsNonZero() {
  console.log('🧪 Testing that unexpected fatal errors exit non-zero...');

  const root = makeValidProject({
    // distDir pointing at a file rather than a directory: writing output cannot
    // succeed, and the failure surfaces mid-build rather than up front.
    'avenx.config.json': '{ "distDir": "occupied" }',
    occupied: 'this is a file, not a directory',
  });

  try {
    const result = runBuild(root);
    assertFailed(result, 'unwritable output directory');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('  ✅ Unexpected fatal errors exit non-zero.');
}


/**
 * A failed build leaves no staging directory behind.
 *
 * Output is written to a staging directory inside distDir and renamed into
 * place only on success. If cleanup ever regressed, distDir would accumulate
 * partial builds that a deploy step would happily upload.
 */
function testNoStagingLeftovers() {
  console.log('🧪 Testing that failed builds leave no staging directory...');

  const root = makeValidProject({ 'src/components/other/hello.component.js': VALID_COMPONENT });
  try {
    assert.notStrictEqual(runBuild(root).status, 0, 'the build fails');

    const distDir = path.join(root, 'dist');
    const leftovers = fs.existsSync(distDir)
      ? fs.readdirSync(distDir).filter((entry) => entry.includes('staging'))
      : [];
    assert.deepStrictEqual(leftovers, [], 'no staging directory survives a failed build');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('  ✅ Staging directories are always cleaned up.');
}

/**
 * A failure raised after the artifacts are staged still promotes nothing.
 *
 * Escalating AVX_W01 makes the bundle-size check throw, which happens after
 * staging is written and before promotion. It is the closest thing to a
 * failure "in the middle of writing", and the previous output must survive it
 * whole rather than being half replaced.
 */
function testFailureAfterStagingDoesNotPromote() {
  console.log('🧪 Testing that a late failure promotes nothing...');

  const root = makeValidProject();
  try {
    assert.strictEqual(runBuild(root).status, 0, 'the first build succeeds');

    const bundlePath = path.join(root, 'dist', 'bundle.js');
    const cssPath = path.join(root, 'dist', 'bundle.css');
    const beforeJs = fs.readFileSync(bundlePath, 'utf-8');
    const beforeCss = fs.readFileSync(cssPath, 'utf-8');

    fs.writeFileSync(path.join(root, 'avenx.config.json'), '{ "warnings": { "AVX_W01": "error" } }');

    const result = runBuild(root);
    assertFailed(result, 'AVX_W01 escalated to an error');
    assert.ok(result.output.includes('AVX_W01'), 'the size violation is reported');

    assert.strictEqual(fs.readFileSync(bundlePath, 'utf-8'), beforeJs, 'the previous script is untouched');
    assert.strictEqual(fs.readFileSync(cssPath, 'utf-8'), beforeCss, 'the previous stylesheet is untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('  ✅ A failure after staging leaves the previous build whole.');
}

/**
 * Failures are rendered as diagnoses, not stack traces.
 *
 * A compiler error that prints an internal stack trace tells a developer
 * nothing and buries the message that would.
 */
function testFailureOutputIsUseful() {
  console.log('🧪 Testing the failure output...');

  const root = makeValidProject({ 'src/components/other/hello.component.js': VALID_COMPONENT });
  try {
    const result = runBuild(root);

    assert.ok(/Build failed/i.test(result.output), 'the output says the build failed');
    assert.ok(result.output.includes('AVX_C03'), 'the output carries the error code');
    assert.ok(
      /non-zero status/i.test(result.output),
      'the output states that the command failed',
    );
    assert.ok(
      !result.output.includes('at AvenxCompiler.'),
      'a diagnosed error prints no internal stack frames',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('  ✅ Failures print a diagnosis, not a stack trace.');
}

/**
 * Errors raised asynchronously reach the exit code.
 *
 * The original bug was structural: bin/avenx.js called an async run() without
 * awaiting it, so a rejection resolved into nothing. This drives the CLI
 * through a command whose failure is raised after the async entry point has
 * returned, which is exactly the shape that used to be lost.
 */
function testAsyncFailurePropagates() {
  console.log('🧪 Testing that async failures propagate...');

  // The git-status prompt makes run() genuinely await before building, so the
  // failure is raised from a later microtask rather than synchronously.
  const root = makeValidProject({ 'src/components/other/hello.component.js': VALID_COMPONENT });
  try {
    const result = spawnSync(process.execPath, [BIN, 'build'], {
      cwd: root,
      encoding: 'utf8',
      input: '',
    });
    const output = (result.stdout || '') + (result.stderr || '');
    assert.notStrictEqual(result.status, 0, 'an async failure must not exit 0');
    assert.ok(!/Build successful/i.test(output), 'and must not claim success');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('  ✅ Async failures reach the exit code.');
}

/**
 * Runs the suite.
 */
function run() {
  testSuccessExitsZero();
  testFatalErrorsExitNonZero();
  testDeploymentChaining();
  testStaleArtifactCannotBeDeployed();
  testHookFailures();
  testUnexpectedErrorExitsNonZero();
  testNoStagingLeftovers();
  testFailureAfterStagingDoesNotPromote();
  testFailureOutputIsUseful();
  testAsyncFailurePropagates();
  console.log('\n✅ All build exit-code tests passed!');
}

try {
  run();
} catch (error) {
  console.error('❌ Build exit-code tests failed:', error);
  process.exit(1);
}
