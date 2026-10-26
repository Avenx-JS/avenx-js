import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-class-renderer-'));

try {
  const init = spawnSync(process.execPath, [cliPath, 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, `${init.stdout}${init.stderr}`);
  fs.writeFileSync(path.join(root, 'src', 'badge.js'), `
import { AvenxComponent } from 'avenx-core/runtime';
export class Badge extends AvenxComponent {
  constructor(bridges, props) {
    super({}, {}, bridges, '<span class="badge">NEU</span>', {}, props);
  }
}
`);
  fs.writeFileSync(path.join(root, 'src', 'main.app.js'), `
import { AvenxApp } from 'avenx-core/runtime';
import { Badge } from './badge.js';
const app = new AvenxApp({ target: '#app' });
app.register('Badge', Badge);
`);
  const build = spawnSync(process.execPath, [cliPath, 'build', '--dev'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
  const bundle = fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf8');
  assert.ok(
    /installStringRenderer\s*\(\s*\{/.test(bundle),
    'Expected bundle to include installStringRenderer({',
  );

  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'components', 'base.js'), `
import { AvenxComponent as ComponentBase } from 'avenx-core/runtime';
export class Intermediate extends ComponentBase {}
`);
  fs.writeFileSync(path.join(root, 'src', 'components', 'badge.js'), `
import { Intermediate as Parent } from './base.js';
export default class Badge extends Parent {}
`);
  fs.writeFileSync(path.join(root, 'src', 'components', 'index.js'), `export { default as Badge } from './badge.js';`);
  fs.writeFileSync(path.join(root, 'src', 'main.app.js'), `
import { AvenxApp } from 'avenx-core/runtime';
import { Badge as RegisteredBadge } from './components';
const app = new AvenxApp({ target: '#app' });
app.register('Badge', RegisteredBadge);
`);
  const aliasedBuild = spawnSync(process.execPath, [cliPath, 'build', '--dev'], { cwd: root, encoding: 'utf8' });
  assert.equal(aliasedBuild.status, 0, `${aliasedBuild.stdout}${aliasedBuild.stderr}`);
  const aliasedBundle = fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf8');
  assert.match(aliasedBundle, /installStringRenderer\s*\(\s*\{/, 'Directory imports and class inheritance must be detected');

  fs.writeFileSync(path.join(root, 'src', 'main.app.js'), `
import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
class PlainRegistration {}
app.register('PlainRegistration', PlainRegistration);
`);
  const unrelatedBuild = spawnSync(process.execPath, [cliPath, 'build', '--dev'], { cwd: root, encoding: 'utf8' });
  assert.equal(unrelatedBuild.status, 0, `${unrelatedBuild.stdout}${unrelatedBuild.stderr}`);
  const unrelatedBundle = fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf8');
  assert.doesNotMatch(
    unrelatedBundle,
    /installStringRenderer\s*\(\s*\{/,
    'An unrelated app.register() call must not include the string renderer',
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
