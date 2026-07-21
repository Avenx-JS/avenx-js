import fs from 'fs';
import path from 'path';
import { fork, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments to detect watch flag and isolate the filter
const args = process.argv.slice(2);
const isWatchMode = args.includes('--watch') || args.includes('-w');
const filterArgs = args.filter((arg) => arg !== '--watch' && arg !== '-w');
const filter = filterArgs[0] || '';
const baseDir = path.join(__dirname, filter);

if (filter === 'e2e') {
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
 * @returns {string[]}
 */
function findTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      // Recurse, but avoid traversing test-project if it wasn't cleaned up
      if (file !== 'test-project') {
        results = results.concat(findTestFiles(filePath));
      }
    } else if (file.endsWith('.test.js')) {
      results.push(filePath);
    }
  });
  return results;
}

/**
 * Runs a single test file by forking a child process.
 * @param {string} file
 * @returns {Promise<{file: string, success: boolean, code?: number}>}
 */
async function runTestFile(file) {
  const relativePath = path.relative(path.join(__dirname, '..'), file);
  console.log(`\n🏃 Running: ${relativePath}`);

  const execArgv = [...process.execArgv];
  const isUnitTest = file.includes(path.join('test', 'unit')) || file.includes('test/unit');
  if (isUnitTest) {
    const registratorPath = path.resolve(__dirname, 'helpers/register-happy-dom.js');
    execArgv.push('--import', pathToFileURL(registratorPath).href);
  }

  return new Promise((resolve) => {
    const child = fork(file, [], { stdio: 'inherit', execArgv });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ file: relativePath, success: true });
      } else {
        resolve({ file: relativePath, success: false, code });
      }
    });
  });
}

/**
 * Rebuilds the Avenx runtime.
 * @returns {Promise<void>}
 */
function rebuild() {
  return new Promise((resolve, reject) => {
    const buildPath = path.resolve(__dirname, '../scripts/build.js');
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
  const files = findTestFiles(baseDir);

  // Exclude the runner itself if it was matched (it shouldn't be as it's not .test.js)
  const testFiles = files.filter((f) => f !== __filename);

  if (testFiles.length === 0) {
    console.log('No tests found.');
    return { success: true, count: 0 };
  }

  console.log(`Found ${testFiles.length} test files to run.`);

  const results = [];
  for (const file of testFiles) {
    const result = await runTestFile(file);
    results.push(result);
  }

  console.log('\n======================================');
  console.log('📊 Test Run Summary');
  console.log('======================================');

  let passed = 0;
  let failed = 0;

  results.forEach((r) => {
    if (r.success) {
      console.log(`  ✅ PASSED: ${r.file}`);
      passed++;
    } else {
      console.log(`  ❌ FAILED: ${r.file} (Exit code: ${r.code})`);
      failed++;
    }
  });

  console.log('--------------------------------------');
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('======================================');

  return { success: failed === 0, count: results.length };
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
    if (!fs.existsSync(baseDir)) {
      console.error(`Error: Directory does not exist: ${baseDir}`);
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
