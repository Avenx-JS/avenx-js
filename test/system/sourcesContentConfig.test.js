import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

// A project with a stylesheet, so the build writes a CSS source map next to
// the JavaScript one.
function writeProject(root) {
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'button.component.css'),
    `<@global>
@def primary #ff0000;
</@global>

<@css>
button {
  background: @primary;
}
</@css>
`,
  );
  fs.writeFileSync(
    path.join(root, 'src', 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
`,
  );
}

function build(root) {
  const result = spawnSync(process.execPath, [cliPath, 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

function readMap(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'dist', name), 'utf8'));
}

function writeConfig(root, config) {
  fs.writeFileSync(path.join(root, 'avenx.config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-sources-content-'));

try {
  const init = spawnSync(process.execPath, [cliPath, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, `${init.stdout}${init.stderr}`);
  writeProject(root);

  // The default embeds the original source in both maps.
  writeConfig(root, { sourceMap: true });
  build(root);

  const jsMap = readMap(root, 'bundle.js.map');
  assert.ok(
    Array.isArray(jsMap.sourcesContent) && jsMap.sourcesContent.length > 0,
    'the JavaScript map embeds the original source by default',
  );

  const cssMap = readMap(root, 'bundle.css.map');
  assert.ok(Array.isArray(cssMap.sourcesContent), 'the CSS map carries a sourcesContent array by default');

  // `sourcesContent: false` leaves the original source out of both maps.
  writeConfig(root, { sourceMap: true, sourcesContent: false });
  build(root);

  assert.equal(
    readMap(root, 'bundle.js.map').sourcesContent,
    undefined,
    'the JavaScript map leaves the original source out',
  );
  assert.equal(readMap(root, 'bundle.css.map').sourcesContent, undefined, 'the CSS map leaves the original source out');

  console.log('  ✅ the sourcesContent option reaches both source maps');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
