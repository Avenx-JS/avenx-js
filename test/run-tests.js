import fs from 'fs';
import os from 'os';
import path from 'path';
import { fork, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Calculate default concurrency: bounded worker pool defaulting to os.cpus().length - 1
const availableCPUs = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const envConcurrency = process.env.AVENX_TEST_CONCURRENCY ? parseInt(process.env.AVENX_TEST_CONCURRENCY, 10) : null;
const defaultConcurrency =
  envConcurrency && envConcurrency > 0
    ? envConcurrency
    : Math.max(1, Math.min(availableCPUs > 2 ? availableCPUs - 1 : availableCPUs, 8));

// Timeout per test file to prevent hung children from stalling the worker pool
const TEST_TIMEOUT_MS =
  parseInt(process.env.TEST_TIMEOUT_MS || process.env.AVENX_TEST_TIMEOUT || '60000', 10) || 60000;

// Parse command line arguments: watch, update-snapshots, concurrency, and path filter
const args = process.argv.slice(2);
let isWatchMode = false;
let isUpdateSnapshots = false;
let concurrency = defaultConcurrency;
const filterArgs = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--watch' || arg === '-w') {
    isWatchMode = true;
  } else if (arg === '--update-snapshots' || arg === '-u') {
    isUpdateSnapshots = true;
  } else if (arg === '--concurrency' || arg === '-c') {
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val) && val > 0) {
        concurrency = val;
      }
    }
  } else if (arg.startsWith('--concurrency=')) {
    const val = parseInt(arg.split('=')[1], 10);
    if (!isNaN(val) && val > 0) {
      concurrency = val;
    }
  } else if (arg.startsWith('-c=')) {
    const val = parseInt(arg.split('=')[1], 10);
    if (!isNaN(val) && val > 0) {
      concurrency = val;
    }
  } else {
    filterArgs.push(arg);
  }
}

if (isUpdateSnapshots) {
  process.env.AVENX_UPDATE_SNAPSHOTS = '1';
}
const filter = filterArgs[0] || '';

if (filter === 'e2e' || filter === 'test/e2e') {
  console.log('🎭 Delegating E2E testing to Playwright...\n');
  const res = spawnSync('npx', ['playwright', 'test'], { stdio: 'inherit', shell: true });
  process.exit(res.status ?? 0);
}

let isRunning = false;
let isPendingRerun = false;
let debounceTimeout = null;

/**
 * Finds all test files recursively under a directory.
 * @param {string} dir
 * @param {boolean} [skipFuzz] - Whether to exclude fuzz tests from root test runs.
 * @returns {string[]}
 */
function findTestFiles(dir, skipFuzz = false) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    return dir.endsWith('.test.js') ? [dir] : [];
  }
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const s = fs.statSync(filePath);
    if (s && s.isDirectory()) {
      // Recurse, but avoid traversing test-project, node_modules, or fuzz (on default runs)
      if (file !== 'test-project' && file !== 'node_modules' && !(skipFuzz && file === 'fuzz')) {
        results = results.concat(findTestFiles(filePath, skipFuzz));
      }
    } else if (file.endsWith('.test.js')) {
      results.push(filePath);
    }
  });
  return results;
}

/**
 * Resolves matching test files given a filter path or substring.
 * @param {string} filterPath
 * @returns {string[]}
 */
function resolveTestFiles(filterPath) {
  if (!filterPath) {
    return findTestFiles(__dirname, true);
  }

  // Check direct file/dir existence from various base paths
  const candidates = [
    path.resolve(process.cwd(), filterPath),
    path.resolve(__dirname, filterPath),
    path.resolve(__dirname, filterPath.replace(/^(\.\/)?test\/?/, '')),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate.endsWith('.test.js') ? [candidate] : [];
      }
      if (stat.isDirectory()) {
        return findTestFiles(candidate, false);
      }
    }
  }

  // Substring match across all discovered test files
  const allFiles = findTestFiles(__dirname, false);
  return allFiles.filter((f) => f.includes(filterPath));
}

/**
 * The marker a test file writes to run without the development runtime.
 *
 * A string rather than a filename convention, so the declaration sits in the
 * file it governs and a reader of that file can see why it behaves differently
 * from its neighbours.
 * @type {string}
 */
const NO_DEV_RUNTIME = '@avenx-no-dev-runtime';

/**
 * Whether a test file asked to run without the interpreter and string renderer.
 * @param {string} file - Absolute path to the test file.
 * @returns {boolean} True when the file declares the marker.
 */
function optsOutOfDevRuntime(file) {
  try {
    return fs.readFileSync(file, 'utf-8').includes(NO_DEV_RUNTIME);
  } catch {
    return false;
  }
}

/**
 * The marker a test file declares to require serial execution.
 *
 * A string rather than a filename convention, so the declaration sits in the
 * file it governs and a reader of that file can see why it behaves differently
 * from its neighbours. Tests declaring this marker are held back and run in a
 * serial worker after parallel pool execution completes.
 * @type {string}
 */
const SERIAL_MARKER = '@avenx-serial';

/**
 * Whether a test file declared that it must run serially.
 * @param {string} file - Absolute path to the test file.
 * @returns {boolean} True when the file declares the marker.
 */
function requiresSerialExecution(file) {
  try {
    return fs.readFileSync(file, 'utf-8').includes(SERIAL_MARKER);
  } catch {
    return false;
  }
}

/**
 * Runs a single test file by forking a child process.
 * @param {string} file - Test file path.
 * @param {object} [options]
 * @param {boolean} [options.inheritStdio] - Whether to inherit stdio (for concurrency 1 serial debugging).
 * @param {number} [options.timeoutMs] - Maximum execution time before SIGKILL.
 * @returns {Promise<{file: string, success: boolean, code?: number, timedOut?: boolean}>}
 */
async function runTestFile(file, options = {}) {
  const { inheritStdio = false, timeoutMs = TEST_TIMEOUT_MS } = options;
  const relativePath = path.relative(path.join(__dirname, '..'), file);

  if (inheritStdio) {
    console.log(`\n🏃 Running: ${relativePath}`);
  }

  const execArgv = [...process.execArgv];
  const bareRuntime = optsOutOfDevRuntime(file);
  const interpreterPath = path.resolve(__dirname, 'helpers/register-interpreter.js');
  execArgv.push('--import', pathToFileURL(interpreterPath).href);

  const isUnitTest =
    file.includes(path.join('test', 'unit')) ||
    file.includes('test/unit') ||
    file.includes(path.join('test', 'fuzz')) ||
    file.includes('test/fuzz');
  if (isUnitTest) {
    const registratorPath = path.resolve(__dirname, 'helpers/register-happy-dom.js');
    execArgv.push('--import', pathToFileURL(registratorPath).href);
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutTimer = null;

    const child = fork(file, [], {
      stdio: inheritStdio ? 'inherit' : ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(bareRuntime ? { AVENX_TEST_NO_DEV_RUNTIME: '1' } : {}),
      },
    });

    if (!inheritStdio) {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });

      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          if (settled) return;
          try {
            child.kill('SIGKILL');
          } catch {
            // Already exited
          }
          finish(null, true);
        }, timeoutMs);
      }
    }

    function finish(code, timedOut = false) {
      if (settled) return;
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      if (!inheritStdio) {
        const banner = `\n🏃 Running: ${relativePath}`;
        const output = (stdout + stderr).trim();
        if (output) {
          console.log(`${banner}\n${output}`);
        } else {
          console.log(banner);
        }
      }

      if (timedOut) {
        console.error(`  ❌ TIMEOUT: ${relativePath} timed out after ${timeoutMs}ms`);
        resolve({ file: relativePath, success: false, code: -1, timedOut: true });
      } else if (code === 0) {
        resolve({ file: relativePath, success: true });
      } else {
        resolve({ file: relativePath, success: false, code: code ?? 1 });
      }
    }

    // Listen on 'close' rather than 'exit' when piping to ensure all stdio buffers have flushed
    if (inheritStdio) {
      child.on('exit', (code) => finish(code, false));
    } else {
      child.on('close', (code) => finish(code, false));
    }

    child.on('error', (err) => {
      if (!settled) {
        stderr += `\nChild process error: ${err.message}`;
        finish(1, false);
      }
    });
  });
}

/**
 * Executes tasks concurrently through a bounded worker pool.
 * @template T, R
 * @param {T[]} items
 * @param {number} poolSize
 * @param {function(T): Promise<R>} workerFn
 * @returns {Promise<R[]>}
 */
async function runWorkerPool(items, poolSize, workerFn) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await workerFn(items[index]);
    }
  }

  const workers = [];
  const workerCount = Math.min(poolSize, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Prints the formatted test summary and returns overall success.
 * Result list is sorted deterministically by relative file path.
 * @param {Array<{file: string, success: boolean, code?: number, timedOut?: boolean}>} results
 * @returns {{success: boolean, count: number}}
 */
function printSummary(results) {
  console.log('\n======================================');
  console.log('📊 Test Run Summary');
  console.log('======================================');

  let passed = 0;
  let failed = 0;

  // Ordering of the summary is deterministic (sorted by file path)
  const sortedResults = [...results].sort((a, b) => a.file.localeCompare(b.file));

  sortedResults.forEach((r) => {
    if (r.success) {
      console.log(`  ✅ PASSED: ${r.file}`);
      passed++;
    } else {
      const detail = r.timedOut ? `Timed out after ${TEST_TIMEOUT_MS}ms` : `Exit code: ${r.code}`;
      console.log(`  ❌ FAILED: ${r.file} (${detail})`);
      failed++;
    }
  });

  console.log('--------------------------------------');
  console.log(`Total: ${sortedResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('======================================');

  return { success: failed === 0, count: sortedResults.length };
}

/**
 * Rebuilds the Avenx runtime if a build script exists.
 * @returns {Promise<void>}
 */
function rebuild() {
  return new Promise((resolve, reject) => {
    const buildPath = path.resolve(__dirname, '../scripts/build.js');
    if (!fs.existsSync(buildPath)) {
      resolve();
      return;
    }
    const child = fork(buildPath, [], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with exit code ${code}`));
      }
    });
  });
}

/**
 * Executes the entire test suite once.
 * @returns {Promise<{success: boolean, count: number}>}
 */
async function runOnce() {
  const files = resolveTestFiles(filter);

  // Exclude the runner itself if it was matched (it shouldn't be as it's not .test.js)
  const testFiles = files.filter((f) => f !== __filename);

  if (testFiles.length === 0) {
    console.log(filter ? `No tests found matching filter: "${filter}"` : 'No tests found.');
    return { success: true, count: 0 };
  }

  // When concurrency is 1, reproduce today's fully serial behaviour for debugging
  if (concurrency <= 1) {
    console.log(`Found ${testFiles.length} test files to run (serial mode).`);
    const results = [];
    for (const file of testFiles) {
      const result = await runTestFile(file, { inheritStdio: true });
      results.push(result);
    }
    return printSummary(results);
  }

  const effectiveConcurrency = Math.min(concurrency, testFiles.length);
  console.log(`Found ${testFiles.length} test files to run (concurrency: ${effectiveConcurrency}).`);

  const parallelFiles = testFiles.filter((f) => !requiresSerialExecution(f));
  const serialFiles = testFiles.filter((f) => requiresSerialExecution(f));

  // Run parallel files concurrently through the bounded worker pool
  const parallelResults = await runWorkerPool(parallelFiles, effectiveConcurrency, (file) =>
    runTestFile(file, { inheritStdio: false }),
  );

  // Run any test files that declared exclusive serial execution requirements
  const serialResults = [];
  for (const file of serialFiles) {
    const result = await runTestFile(file, { inheritStdio: false });
    serialResults.push(result);
  }

  return printSummary([...parallelResults, ...serialResults]);
}

/**
 * Triggers rebuilding assets and executing tests with deduplication.
 */
async function triggerRun() {
  if (isRunning) {
    isPendingRerun = true;
    return;
  }

  isRunning = true;
  isPendingRerun = false;

  try {
    console.clear();
    console.log('🔄 File change detected. Re-running tests...\n');

    try {
      await rebuild();
    } catch (err) {
      console.error('Build failed:', err.message);
    }

    await runOnce();
  } catch (error) {
    console.error('Execution error:', error);
  } finally {
    isRunning = false;
    console.log('\n👀 Watching for file changes in lib/ and test/...');
    if (isPendingRerun) {
      // Small timeout to prevent immediate tight loop in case of fast filesystem events
      setTimeout(() => {
        triggerRun();
      }, 50);
    }
  }
}

/**
 * Sets up filesystem watching on source and test directories.
 */
function startWatcher() {
  const libDir = path.resolve(__dirname, '../lib');
  const testDir = path.resolve(__dirname, '../test');
  const watchOptions = { recursive: true };

  const onWatchEvent = (eventType, filename) => {
    if (!filename) return;

    // Normalize path separators to forward slash
    const relativePath = filename.replace(/\\/g, '/');

    // Ignore test-project, scratch, and other temporary files/dirs
    if (
      relativePath.includes('test-project') ||
      relativePath.includes('scratch') ||
      relativePath.startsWith('.') ||
      relativePath.includes('/.') ||
      relativePath.endsWith('~')
    ) {
      return;
    }

    // Only trigger on source or test asset extensions
    const ext = path.extname(relativePath);
    if (!['.js', '.json', '.template', '.md'].includes(ext)) {
      return;
    }

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    debounceTimeout = setTimeout(() => {
      triggerRun();
    }, 100);
  };

  try {
    if (fs.existsSync(libDir)) {
      fs.watch(libDir, watchOptions, onWatchEvent);
    }
    if (fs.existsSync(testDir)) {
      fs.watch(testDir, watchOptions, onWatchEvent);
    }
  } catch (error) {
    console.error('Failed to start watcher:', error);
  }

  console.log('\n👀 Watching for file changes in lib/ and test/...');
}

(async () => {
  try {
    const matchedFiles = resolveTestFiles(filter);
    if (filter && matchedFiles.length === 0) {
      console.error(`Error: No tests found matching: ${filter}`);
      process.exit(1);
    }

    if (isWatchMode) {
      console.clear();
      console.log('🔄 Initializing watch mode...');
      try {
        await rebuild();
      } catch (err) {
        console.error('Initial build failed:', err.message);
      }
      await runOnce();
      startWatcher();
    } else {
      const { success } = await runOnce();
      process.exit(success ? 0 : 1);
    }
  } catch (err) {
    console.error('Test runner failed unexpectedly:', err);
    process.exit(1);
  }
})();
