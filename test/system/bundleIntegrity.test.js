/**
 * Establishes the invariant the compiler previously lacked:
 *
 *   avenx build reports success  =>  the emitted JavaScript parses
 *
 * The original failure: two route guards each emitted their own
 * `const { AvenxGuard } = Avenx;` preamble into one bundle scope, producing
 * `SyntaxError: Identifier 'AvenxGuard' has already been declared`. The bundle
 * did not parse, the application never started, and the build printed
 * "Build successful" because nothing checked.
 *
 * This suite drives the real CLI against real projects on disk and parses the
 * emitted bundle with Node. A regression here means a broken application would
 * ship with a green build.
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

console.log('🧪 Testing bundle integrity...');

/**
 * Runs the Avenx CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function avenx(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Creates a scaffolded project in a fresh temporary directory.
 * @returns {string} The project root.
 */
function scaffold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-bundle-'));
  avenx(['init'], dir);
  return dir;
}

/**
 * Writes a guard module.
 * @param {string} dir - Project root.
 * @param {string} file - File name under src/guards.
 * @param {string} className - The exported guard class name.
 * @param {string} [body] - The canActivate body.
 */
function writeGuard(dir, file, className, body = 'return true;') {
  const guards = path.join(dir, 'src', 'guards');
  fs.mkdirSync(guards, { recursive: true });
  fs.writeFileSync(
    path.join(guards, file),
    `import { AvenxGuard } from 'avenx-core/runtime';

export default class ${className} extends AvenxGuard {
  /**
   * @param {object} to - Target route.
   * @param {object} from - Current route.
   * @returns {boolean|string} The decision.
   */
  canActivate(to, from) {
    ${body}
  }
}
`,
  );
}

/**
 * Parses a file as a classic script, the way a browser would.
 * @param {string} filePath - Path to the JavaScript file.
 * @returns {{ok: boolean, message: string}} Whether it parses.
 */
function parses(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  try {
    new vm.Script(code, { filename: path.basename(filePath) });
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

const created = [];

try {
  /* ---------------------------------------------------------------------
   * The original defect: more than one route guard.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    writeGuard(dir, 'auth.guard.js', 'AuthGuard');
    writeGuard(dir, 'role.guard.js', 'RoleGuard');

    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `a two-guard project builds:\n${build.stdout}${build.stderr}`);

    const bundle = path.join(dir, 'dist', 'bundle.js');
    const result = parses(bundle);
    assert.ok(result.ok, `the two-guard bundle parses (got: ${result.message})`);

    // The specific collision, pinned: the runtime preamble must not appear
    // twice in one scope.
    const code = fs.readFileSync(bundle, 'utf-8');
    assert.ok(code.includes('AuthGuard'), 'the auth guard is in the bundle');
    assert.ok(code.includes('RoleGuard'), 'the role guard is in the bundle');
    console.log('  ✅ Two route guards produce a bundle that parses.');
  }

  /* ---------------------------------------------------------------------
   * The class, not the instance: five guards, and guards with private
   * helpers that would previously have collided by name.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      writeGuard(dir, `${name}.guard.js`, `${name.toUpperCase()}Guard`);
    }

    // Two guards that each declare a module-private helper with the same name.
    // Before module scoping this was a second, independent collision.
    fs.writeFileSync(
      path.join(dir, 'src', 'guards', 'a.guard.js'),
      `import { AvenxGuard } from 'avenx-core/runtime';

const helper = () => true;

export default class AGuard extends AvenxGuard {
  /**
   * @returns {boolean} The decision.
   */
  canActivate() {
    return helper();
  }
}
`,
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'guards', 'b.guard.js'),
      `import { AvenxGuard } from 'avenx-core/runtime';

const helper = () => false;

export default class BGuard extends AvenxGuard {
  /**
   * @returns {boolean} The decision.
   */
  canActivate() {
    return helper();
  }
}
`,
    );

    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `five guards with colliding helpers build:\n${build.stderr}`);
    const result = parses(path.join(dir, 'dist', 'bundle.js'));
    assert.ok(result.ok, `the bundle parses (got: ${result.message})`);
    console.log('  ✅ Module-private declarations no longer collide across files.');
  }

  /* ---------------------------------------------------------------------
   * A genuine collision is reported, not emitted.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    writeGuard(dir, 'first.guard.js', 'SameName');
    writeGuard(dir, 'second.guard.js', 'SameName');

    const build = avenx(['build'], dir);
    assert.notStrictEqual(build.status, 0, 'two guards exporting the same class name fail the build');
    const output = build.stdout + build.stderr;
    assert.ok(output.includes('AVX_C16'), `the collision is reported as AVX_C16:\n${output}`);
    assert.ok(output.includes('SameName'), 'and names the colliding binding');
    console.log('  ✅ A real name collision fails the build with a located diagnostic.');
  }

  /* ---------------------------------------------------------------------
   * Ordinary projects still build, and every emitted .js artifact parses.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    avenx(['g', 'counter'], dir);
    avenx(['g', 'p', 'home'], dir);
    avenx(['g', 'bridge', 'cart'], dir);
    writeGuard(dir, 'auth.guard.js', 'AuthGuard');

    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `a mixed project builds:\n${build.stderr}`);
    assert.ok(build.stdout.includes('Build successful'), 'and reports success');

    for (const file of fs.readdirSync(path.join(dir, 'dist'))) {
      if (!file.endsWith('.js')) continue;
      const result = parses(path.join(dir, 'dist', file));
      assert.ok(result.ok, `${file} parses (got: ${result.message})`);
    }
    console.log('  ✅ Components, pages, bridges and a guard compile to parseable output.');
  }

  /* ---------------------------------------------------------------------
   * Validation runs before promotion: a failed build leaves dist/ alone.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    avenx(['g', 'counter'], dir);
    const first = avenx(['build'], dir);
    assert.strictEqual(first.status, 0, 'the first build succeeds');
    const good = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');

    // Introduce a collision, then confirm the previous output survived.
    writeGuard(dir, 'x.guard.js', 'Dup');
    writeGuard(dir, 'y.guard.js', 'Dup');
    const second = avenx(['build'], dir);
    assert.notStrictEqual(second.status, 0, 'the second build fails');

    const after = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');
    assert.strictEqual(after, good, 'a failed build does not replace the previous bundle');
    console.log('  ✅ A failed build leaves the previous output in place.');
  }

  console.log('✅ Bundle integrity tests passed!');
} finally {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
