const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

// Determine which folder to run based on command line arguments
// e.g. "node test/run-tests.js unit" or "node test/run-tests.js" for all
const filter = process.argv[2] || '';
const baseDir = path.join(__dirname, filter);

/**
 *
 * @param dir
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
 *
 * @param file
 */
async function runTestFile(file) {
  const relativePath = path.relative(path.join(__dirname, '..'), file);
  console.log(`\n🏃 Running: ${relativePath}`);
  return new Promise((resolve) => {
    const child = fork(file, [], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ file: relativePath, success: true });
      } else {
        resolve({ file: relativePath, success: false, code });
      }
    });
  });
}

(async () => {
  try {
    if (!fs.existsSync(baseDir)) {
      console.error(`Error: Directory does not exist: ${baseDir}`);
      process.exit(1);
    }

    const files = findTestFiles(baseDir);

    // Exclude the runner itself if it was matched (it shouldn't be as it's not .test.js)
    const testFiles = files.filter((f) => f !== __filename);

    if (testFiles.length === 0) {
      console.log('No tests found.');
      process.exit(0);
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

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test runner failed unexpectedly:', err);
    process.exit(1);
  }
})();
