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
 * Routes the guards a project declares, so something imports them.
 *
 * A guard reaches the bundle when the application references it, which is what
 * a route does. The old pipeline concatenated every `.guard.js` in the project
 * whether or not a route named one, so these fixtures never had to say.
 * @param {string} dir - Project root.
 * @param {Array<{file: string, className: string}>} guards - The guards written.
 */
function routeGuards(dir, guards) {
  const imports = guards.map((guard) => `import ${guard.className} from './guards/${guard.file}';`).join('\n');
  const list = guards.map((guard) => guard.className).join(', ');
  fs.writeFileSync(
    path.join(dir, 'src', 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';
${imports}

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '#/admin': { page: 'Admin', guards: [${list}] },
});
`,
  );
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
    routeGuards(dir, [
      { file: 'auth.guard.js', className: 'AuthGuard' },
      { file: 'role.guard.js', className: 'RoleGuard' },
    ]);

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
    routeGuards(
      dir,
      ['a', 'b', 'c', 'd', 'e'].map((name) => ({ file: `${name}.guard.js`, className: `${name.toUpperCase()}Guard` })),
    );

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
   * The collision this file was written for is now structurally impossible.
   *
   * Two guards exporting the same class name used to emit that name twice into
   * one scope, which is what made the bundle a SyntaxError. Every module is its
   * own function scope now, so the same two files coexist -- and the invariant
   * the collision violated is still the one being checked: the emitted
   * JavaScript parses.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    writeGuard(dir, 'first.guard.js', 'SameName');
    writeGuard(dir, 'second.guard.js', 'SameName');
    // Only one of them can be imported under that name, which is exactly how
    // two same-named modules coexist in any module system.
    fs.writeFileSync(
      path.join(dir, 'src', 'main.app.js'),
      `import { AvenxApp } from 'avenx-core/runtime';
import First from './guards/first.guard.js';
import Second from './guards/second.guard.js';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '#/admin': { page: 'Admin', guards: [First, Second] },
});
`,
    );

    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `two guards exporting the same name now coexist:\n${build.stdout}${build.stderr}`);
    const result = parses(path.join(dir, 'dist', 'bundle.js'));
    assert.ok(result.ok, `and the bundle parses (got: ${result.message})`);
    console.log('  ✅ Same-named exports in different modules no longer collide at all.');
  }

  /* ---------------------------------------------------------------------
   * A build that cannot link fails, and says what it could not resolve.
   * ------------------------------------------------------------------ */
  {
    const dir = scaffold();
    created.push(dir);
    avenx(['g', 'counter'], dir);
    const componentPath = path.join(dir, 'src', 'components', 'counter', 'counter.component.js');
    fs.writeFileSync(
      componentPath,
      `import { formatDistance } from 'not-installed-anywhere';\n\n${fs.readFileSync(componentPath, 'utf-8')}`,
    );

    const build = avenx(['build'], dir);
    assert.notStrictEqual(build.status, 0, 'an unresolvable import fails the build');
    const output = build.stdout + build.stderr;
    assert.ok(output.includes('AVX_C17'), `reported as AVX_C17:\n${output}`);
    assert.ok(output.includes('not-installed-anywhere'), 'and names the specifier');
    console.log('  ✅ An unresolvable import fails the build with a located diagnostic.');
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

    // Introduce an unresolvable import, then confirm the previous output survived.
    const componentPath = path.join(dir, 'src', 'components', 'counter', 'counter.component.js');
    fs.writeFileSync(
      componentPath,
      `import missing from './does-not-exist.js';\n\n${fs.readFileSync(componentPath, 'utf-8')}`,
    );
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
