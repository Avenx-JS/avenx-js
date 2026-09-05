import assert from 'assert';
import fs from 'fs';
import path from 'path';
import '../helpers/register-happy-dom.js';
import loadConfig from '../../lib/config.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { setDebugReactivity, isDebugReactivityEnabled } from '../../lib/core/reactive/watcher.js';

async function runTests() {
  console.log('🧪 Testing debugReactivity configuration option and reactivity trace logs...');

  // Backup original console.log
  const originalConsoleLog = console.log;

  try {
    // 1. Test loadConfig with debug.debugReactivity: true
    console.log('  Testing avenx.config.json loading of debug.debugReactivity...');
    const tmpDir = path.join(process.cwd(), '.tmp_debug_config_test');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const configJsonPath = path.join(tmpDir, 'avenx.config.json');
    fs.writeFileSync(
      configJsonPath,
      JSON.stringify({
        debug: {
          debugReactivity: true,
        },
      }),
      'utf8'
    );

    const loadedConfig = loadConfig(tmpDir);
    assert.strictEqual(loadedConfig.debug.debugReactivity, true, 'Config should parse debug.debugReactivity correctly.');
    assert.strictEqual(isDebugReactivityEnabled(), true, 'setDebugReactivity should be called when config is loaded.');

    // Cleanup temp dir
    fs.unlinkSync(configJsonPath);
    fs.rmdirSync(tmpDir);

    // 2. Test trace log output during property tracking and mutation
    console.log('  Testing reactivity trace logs during property tracking and mutation...');
    const logs = [];
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    setDebugReactivity(true);

    class ProfileCard extends AvenxComponent {
      constructor() {
        super(
          { user: { name: 'Alice', age: 25 } },
          {},
          {},
          // `{% ... %}` is not an interpolation syntax the renderer supports
          // (see createInterpolationRegex), so this template never evaluated
          // anything. The assertion below passed only because building a scope
          // used to spread the reactive state, reading every key whether an
          // expression named it or not -- the very behaviour that made
          // unrelated state changes re-render a component. With a real
          // interpolation the test now asserts genuine dependency tracking.
          `<div><span>{{ state.user.name }}</span></div>`
        );
      }
    }

    const root = document.createElement('div');
    document.body.appendChild(root);

    const profileCard = new ProfileCard();
    profileCard.mount(root);
    profileCard.update();

    // Check tracked property log during component render
    const renderTrackedLog = logs.find((l) => l.includes('[Avenx Debug] Tracked property "user"'));
    assert.ok(renderTrackedLog, 'Should emit tracked property log for user during render.');
    assert.ok(
      renderTrackedLog.includes('by Watcher "ProfileCard#render"'),
      `Tracked log should identify active rendering watcher node (got: "${renderTrackedLog}").`
    );

    // Register a named watcher to test nested path tracking (user.name)
    logs.length = 0;
    profileCard.$watch(
      () => profileCard.state.user.name,
      () => {},
      { name: 'ProfileCardWatcher' }
    );

    const nestedTrackedLog = logs.find((l) => l.includes('[Avenx Debug] Tracked property "user.name"'));
    assert.ok(nestedTrackedLog, 'Should emit tracked property log for nested property user.name.');
    assert.ok(
      nestedTrackedLog.includes('by Watcher "ProfileCardWatcher"'),
      `Nested tracked log should identify active watcher name (got: "${nestedTrackedLog}").`
    );

    // Test property mutation trigger log
    logs.length = 0;
    profileCard.state.user.name = 'Bob';

    const triggeredLog = logs.find((l) => l.includes('[Avenx Debug] Triggered property "user.name"'));
    assert.ok(triggeredLog, 'Should emit triggered property log for user.name.');
    assert.ok(
      triggeredLog.includes('(old: "Alice", new: "Bob") -> scheduling update'),
      `Triggered log should accurately format old and new values (got: "${triggeredLog}").`
    );

    // 3. Test zero overhead when debugReactivity is disabled
    setDebugReactivity(false);
    logs.length = 0;

    profileCard.state.user.name = 'Charlie';
    const noLogCount = logs.filter((l) => l.includes('[Avenx Debug]')).length;
    assert.strictEqual(noLogCount, 0, 'No debug trace logs should be emitted when debugReactivity is false.');

    console.log = originalConsoleLog;
    document.body.removeChild(root);

    console.log('  ✅ All debugReactivity unit tests passed successfully!');
  } catch (err) {
    console.log = originalConsoleLog;
    console.error('❌ debugReactivity unit tests failed!');
    console.error(err);
    process.exit(1);
  }
}

runTests();
