/**
 * The compiler half of guard state access.
 *
 * `rewriteRuntimeImports` deletes every non-runtime import, so a guard that
 * wrote `import session from '../bridges/session.bridge.js'` was left with
 * `session` undefined and reported AVX_R07 on every navigation through it.
 *
 * Two things were wrong. The import was never rewired to the bridge's
 * bundle-scope binding the way a component's is; and guard modules were not
 * counted as bridge consumers, so a bridge imported only by a guard looked
 * unreachable, was tree-shaken out of the bundle, and left the alias pointing
 * at an identifier that did not exist -- a ReferenceError at load time that
 * stopped the whole application booting.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing guard bridge resolution...');

/**
 * Runs the Avenx CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, output: string}} Status and combined output.
 */
function avenx(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

const dirs = [];

/**
 * Scaffolds a project with a session bridge and a guard that reads it.
 * @param {object} [options] - Fixture options.
 * @param {boolean} [options.secondGuard] - Also emit a guard with no bridge.
 * @returns {string} The project root.
 */
function scaffold({ secondGuard = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-guard-bridge-'));
  dirs.push(dir);
  avenx(['init'], dir);

  fs.mkdirSync(path.join(dir, 'src', 'bridges'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'bridges', 'session.bridge.js'),
    `import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { signedIn: true },
});
`,
  );

  fs.mkdirSync(path.join(dir, 'src', 'guards'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'guards', 'auth.guard.js'),
    `import { AvenxGuard } from 'avenx-core/runtime';
import session from '../bridges/session.bridge.js';

export default class AuthGuard extends AvenxGuard {
  /**
   * @returns {boolean|string} The decision.
   */
  canActivate() {
    return session.signedIn ? true : '#/login';
  }
}
`,
  );

  // Guards reach the bundle the way everything else does: something imports
  // them. A route naming a guard class is that import, and is what a real
  // project writes -- the old pipeline concatenated every .guard.js in the
  // project whether a route used it or not.
  fs.writeFileSync(
    path.join(dir, 'src', 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';
import AuthGuard from './guards/auth.guard.js';
${secondGuard ? "import RoleGuard from './guards/role.guard.js';\n" : ''}
const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '#/admin': { page: 'Admin', guards: [AuthGuard${secondGuard ? ', RoleGuard' : ''}] },
});
`,
  );

  if (secondGuard) {
    fs.writeFileSync(
      path.join(dir, 'src', 'guards', 'role.guard.js'),
      `import { AvenxGuard } from 'avenx-core/runtime';

export default class RoleGuard extends AvenxGuard {
  /**
   * @returns {boolean} The decision.
   */
  canActivate() {
    return true;
  }
}
`,
    );
  }

  return dir;
}

try {
  /* ---------------------------------------------------------------------
   * A guard's bridge import is rewired, and the bridge survives shaking.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `the project builds:\n${build.output}`);

    const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');

    // The bundle must parse, and the guard's local name must be bound inside
    // the guard's own module scope. It is an ordinary resolved import now
    // rather than a compiler-written alias, which is what made a guard's bridge
    // import resolve to `undefined` and report AVX_R07 on every navigation.
    new vm.Script(bundle, { filename: 'bundle.js' });
    assert.ok(/var session = __avx\d+\.default;/.test(bundle), "the guard's bridge import is bound in its own scope");
    assert.ok(bundle.includes('signedIn'), 'and the bridge itself is in the bundle, not tree-shaken away');
    assert.ok(bundle.includes('session.signedIn'), 'so the guard can actually read it');
    console.log('  ✅ A guard reads its bridge through a resolved import.');
  }

  /* ---------------------------------------------------------------------
   * The tree-shaking half: a bridge imported only by a guard must ship.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    // Nothing else in the project touches the bridge, so if guards are not
    // counted as consumers the bridge is dropped and the alias dangles.
    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `the project builds:\n${build.output}`);

    const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');
    const bindingMatch = bundle.match(/var session = (__avx\d+)\.default;/);
    assert.ok(bindingMatch, 'the guard binds the bridge');
    const binding = bindingMatch[1];
    assert.ok(
      new RegExp(`var ${binding}\\s*=`).test(bundle),
      `the bridge module ${binding} is in the bundle rather than dangling`,
    );
    console.log('  ✅ A bridge imported only by a guard is not tree-shaken.');
  }

  /* ---------------------------------------------------------------------
   * Several guards, one of which reads a bridge -- the original fixture.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold({ secondGuard: true });
    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `two guards, one reading a bridge, build:\n${build.output}`);

    const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');
    new vm.Script(bundle, { filename: 'bundle.js' });
    assert.ok(bundle.includes('AuthGuard'), 'the bridge-reading guard is emitted');
    assert.ok(bundle.includes('RoleGuard'), 'and so is the plain one');
    console.log('  ✅ A bridge-reading guard coexists with a plain guard.');
  }

  /* ---------------------------------------------------------------------
   * An unresolvable bridge import fails the build rather than emitting a
   * dangling reference.
   * ------------------------------------------------------------------ */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-guard-missing-'));
    dirs.push(dir);
    avenx(['init'], dir);
    fs.mkdirSync(path.join(dir, 'src', 'guards'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'guards', 'auth.guard.js'),
      `import { AvenxGuard } from 'avenx-core/runtime';
import missing from '../bridges/nope.bridge.js';

export default class AuthGuard extends AvenxGuard {
  /**
   * @returns {boolean} The decision.
   */
  canActivate() {
    return Boolean(missing);
  }
}
`,
    );

    const build = avenx(['build'], dir);
    assert.notStrictEqual(build.status, 0, 'an unresolvable bridge import fails the build');
    assert.ok(build.output.includes('AVX_C07'), `reported as AVX_C07:\n${build.output}`);
    console.log('  ✅ An unresolvable guard bridge import fails the build.');
  }

  console.log('✅ Guard bridge resolution tests passed!');
} finally {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
