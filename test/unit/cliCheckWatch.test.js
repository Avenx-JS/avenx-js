import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkProject } from '../../bin/commands/build.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, 'fixtures-check-watch');

(async () => {
  try {
    console.log('🧪 Testing avenx check --watch functionality...');

    if (fs.existsSync(FIXTURE_DIR)) {
      fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(FIXTURE_DIR, 'src', 'components'), { recursive: true });

    const mockCli = {
      baseDir: FIXTURE_DIR,
      rootDir: FIXTURE_DIR,
      config: {
        rootDir: FIXTURE_DIR,
        srcDir: 'src',
        distDir: 'dist',
        style: {},
      },
      _noExit: true,
    };

    // Capture console output
    let logs = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => {
      logs.push(args.join(' '));
      origLog(...args);
    };
    console.error = (...args) => {
      logs.push(args.join(' '));
      origError(...args);
    };

    // 1. Test starting checkProject with --watch
    console.log('  Testing checkProject with --watch flag startup...');
    const watcher = checkProject(mockCli, ['--watch']);
    assert.ok(watcher, 'checkProject in watch mode should return FSWatcher instance');
    assert.ok(mockCli._watcher, 'cli._watcher should be assigned');
    assert.ok(logs.some((l) => l.includes('Watching for template changes')), 'Should log watch startup message');
    assert.ok(logs.some((l) => l.includes('No template validation issues found')), 'Should log initial check result');

    // 2. Modify component file to trigger watch re-check
    logs = [];
    const testCompPath = path.join(FIXTURE_DIR, 'src', 'components', 'card.component.js');
    fs.writeFileSync(
      testCompPath,
      '<div>{{ invalidVar }}</div>'
    );

    // Wait for watch debounce timeout (100ms)
    await new Promise((res) => setTimeout(res, 300));

    assert.ok(logs.some((l) => l.includes('Change detected in')), 'Should log change detection event');
    assert.ok(logs.some((l) => l.includes('validation issue')), 'Should report validation issue on invalid template');

    // 3. Fix component file to verify recovery
    logs = [];
    fs.writeFileSync(
      testCompPath,
      `<state validVar="OK" />
<div>{{ validVar }}</div>`
    );



    await new Promise((res) => setTimeout(res, 300));

    assert.ok(logs.some((l) => l.includes('Change detected in')), 'Should log second change event');
    assert.ok(logs.some((l) => l.includes('No template validation issues found')), 'Should report zero issues on fixed template');

    // Clean up watcher
    watcher.close();

    // 4. Test short flag -w
    logs = [];
    const watcherShort = checkProject(mockCli, ['-w']);
    assert.ok(watcherShort, 'checkProject with -w should return FSWatcher');
    watcherShort.close();

    // Restore console
    console.log = origLog;
    console.error = origError;

    // Clean up fixture directory
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });

    console.log('✅ All avenx check --watch unit tests passed successfully!');
    process.exit(0);
  } catch (error) {
    if (fs.existsSync(FIXTURE_DIR)) {
      fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
    console.error('❌ avenx check --watch unit tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
