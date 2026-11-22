/**
 * @file destroyReferences.test.js
 * @description `avenx destroy` must report remaining references, refuse
 * without `--force`, and list them on `--dry-run` (issue #1800).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-destroy-refs-'));

function avenx(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    output: `${res.stdout || ''}${res.stderr || ''}`,
  };
}

function write(rel, contents) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

try {
  console.log('🧪 Testing destroy remaining-reference warnings...');

  assert.strictEqual(avenx(['init', '-y']).status, 0, 'init should succeed');
  assert.strictEqual(avenx(['generate', 'page', 'home']).status, 0, 'generate page home');
  assert.strictEqual(avenx(['generate', 'component', 'card']).status, 0, 'generate component card');

  const homePath = path.join(root, 'src/pages/home.page.js');
  const home = fs.readFileSync(homePath, 'utf8');
  fs.writeFileSync(homePath, home.replace('</div>', '    <Card />\n</div>'));

  const cardDir = path.join(root, 'src/components/card');
  assert.ok(fs.existsSync(cardDir), 'card component exists before destroy');

  // Dry-run lists the page reference and leaves files in place.
  const dryRun = avenx(['destroy', 'component', 'card', '--dry-run']);
  assert.strictEqual(dryRun.status, 0, `dry-run should exit 0:\n${dryRun.output}`);
  assert.ok(dryRun.output.includes('home.page.js'), `dry-run lists the page reference:\n${dryRun.output}`);
  assert.ok(dryRun.output.includes('--force') || dryRun.output.includes('would refuse'), 'dry-run mentions refusal');
  assert.ok(fs.existsSync(cardDir), 'dry-run does not delete the component');

  // Without --force, destroy refuses and keeps the files.
  const refused = avenx(['destroy', 'component', 'card']);
  assert.notStrictEqual(refused.status, 0, `destroy without --force must fail:\n${refused.output}`);
  assert.ok(refused.output.includes('home.page.js'), `refusal lists the page reference:\n${refused.output}`);
  assert.ok(refused.output.includes('--force'), 'refusal tells the user to pass --force');
  assert.ok(fs.existsSync(cardDir), 'component still exists after a refused destroy');

  // --force deletes anyway.
  const forced = avenx(['destroy', 'component', 'card', '--force']);
  assert.strictEqual(forced.status, 0, `destroy --force should succeed:\n${forced.output}`);
  assert.ok(!fs.existsSync(cardDir), 'component is deleted with --force');
  fs.writeFileSync(homePath, fs.readFileSync(homePath, 'utf8').replace(/\s*<Card \/>\s*/, '\n'));
  console.log('  ✅ destroy component reports a template usage and refuses without --force');

  // Bridge imported by a component.
  assert.strictEqual(avenx(['generate', 'bridge', 'session']).status, 0, 'generate bridge session');
  assert.strictEqual(avenx(['generate', 'component', 'reader']).status, 0, 'generate component reader');

  write(
    'src/components/reader/reader.component.js',
    "import session from '../../global/session.bridge.js';\n\n" + '<div>\n  <p>{{ session.value }}</p>\n</div>\n',
  );

  const bridgePath = path.join(root, 'src/global/session.bridge.js');
  assert.ok(fs.existsSync(bridgePath), 'session bridge exists');

  const bridgeDryRun = avenx(['destroy', 'bridge', 'session', '--dry-run']);
  assert.strictEqual(bridgeDryRun.status, 0, `bridge dry-run should exit 0:\n${bridgeDryRun.output}`);
  assert.ok(
    bridgeDryRun.output.includes('reader.component.js'),
    `bridge dry-run lists the component import:\n${bridgeDryRun.output}`,
  );
  assert.ok(fs.existsSync(bridgePath), 'bridge dry-run does not delete the file');

  const bridgeRefused = avenx(['destroy', 'bridge', 'session']);
  assert.notStrictEqual(bridgeRefused.status, 0, `destroy bridge without --force must fail:\n${bridgeRefused.output}`);
  assert.ok(
    bridgeRefused.output.includes('reader.component.js'),
    `bridge refusal lists the component import:\n${bridgeRefused.output}`,
  );
  assert.ok(fs.existsSync(bridgePath), 'bridge still exists after a refused destroy');

  const bridgeForced = avenx(['destroy', 'bridge', 'session', '--force']);
  assert.strictEqual(bridgeForced.status, 0, `destroy bridge --force should succeed:\n${bridgeForced.output}`);
  assert.ok(!fs.existsSync(bridgePath), 'bridge is deleted with --force');
  console.log('  ✅ destroy bridge reports a component import and refuses without --force');

  console.log('✅ Destroy remaining-reference tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
