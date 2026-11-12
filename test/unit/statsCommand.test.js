import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { analyzeStats, runStats, formatBytes } from '../../bin/commands/stats.js';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-stats-unit-'));

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

console.log('🧪 Testing bin/commands/stats.js unit logic...');

try {
  setup();

  // 1. Test formatBytes helper
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(1536), '1.50 KB');
  assert.strictEqual(formatBytes(2097152), '2.00 MB');

  const srcDir = path.join(TEST_DIR, 'src');
  fs.mkdirSync(path.join(srcDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'components', 'card'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'bridges'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'guards'), { recursive: true });

  // Create component file
  fs.writeFileSync(
    path.join(srcDir, 'components', 'card', 'card.component.js'),
    `<state count="0" title="Card" />
<action name="increment">
  count++;
</action>
<div class="card">
  <@css container />
  <h1>{{ title }}</h1>
  <p>{{ count }}</p>
</div>
export class CardComponent {}
`,
  );

  // Create page file
  fs.writeFileSync(
    path.join(srcDir, 'pages', 'home.page.js'),
    `<state user="Alice" />
<div>
  <h1>Welcome {{ user }}</h1>
</div>
export class HomePage {}
`,
  );

  // Create bridge file
  fs.writeFileSync(
    path.join(srcDir, 'bridges', 'auth.bridge.js'),
    `export class AuthBridge {
  constructor() {
    this.state = { isLoggedIn: true };
  }
}
`,
  );

  // Create guard file
  fs.writeFileSync(
    path.join(srcDir, 'guards', 'auth.guard.js'),
    `export class AuthGuard {
  canActivate() { return true; }
}
`,
  );

  const fakeCli = {
    baseDir: TEST_DIR,
    config: { srcDir: 'src' },
  };

  // 2. Test analyzeStats
  const data = analyzeStats(fakeCli);
  assert.strictEqual(data.summary.totalFiles, 4, 'Should detect 4 total files');
  assert.strictEqual(data.summary.totalComponents, 1, 'Should detect 1 component');
  assert.strictEqual(data.summary.totalPages, 1, 'Should detect 1 page');
  assert.strictEqual(data.summary.totalBridges, 1, 'Should detect 1 bridge');
  assert.strictEqual(data.summary.totalGuards, 1, 'Should detect 1 guard');
  assert.ok(data.summary.totalStateProps >= 2, 'State props should be aggregated');
  assert.ok(data.summary.totalFileSizeBytes > 0, 'Total file size should be positive');

  // 3. Test runStats with --json flag
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  runStats(fakeCli, ['--json']);
  console.log = origLog;

  const jsonOutput = logs.join('\n');
  const parsedJson = JSON.parse(jsonOutput);
  assert.strictEqual(parsedJson.summary.totalFiles, 4, 'JSON output should match summary');
  assert.strictEqual(parsedJson.items.length, 4, 'JSON items array should contain 4 items');

  // 4. Test runStats default console output
  logs.length = 0;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  runStats(fakeCli, []);
  console.log = origLog;

  const textOutput = logs.join('\n');
  assert.ok(textOutput.includes('📊 Avenx Component & Bundle Footprint Metrics'), 'Header should be present');
  assert.ok(textOutput.includes('CardComponent'), 'Component name should be in output table');
  assert.ok(textOutput.includes('HomePage'), 'Page name should be in output table');
  assert.ok(textOutput.includes('AuthBridge'), 'Bridge name should be in output table');
  assert.ok(textOutput.includes('Summary Totals:'), 'Summary totals section should be present');

  console.log('✅ Unit test for bin/commands/stats.js passed successfully!');
} catch (err) {
  console.error('❌ Unit test failed:', err);
  process.exit(1);
} finally {
  cleanup();
}
