/**
 * The compiler half of string guards.
 *
 * A route may name its guard by string (`guards: ['AuthGuard']`) instead of
 * passing the class. The compiler resolves the name to the guard file, imports
 * it and registers it on the app, so the router resolves the name instead of
 * silently passing it -- and a name with no guard file is warned about at
 * build time and denied at run time, never registered from nothing.
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

console.log('🧪 Testing string guard registration...');

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
 * Scaffolds a project whose route names its guard by string, without
 * importing the guard class in main.app.js.
 * @returns {string} The project root.
 */
function scaffold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-string-guard-'));
  dirs.push(dir);
  avenx(['init'], dir);

  fs.mkdirSync(path.join(dir, 'src', 'bridges'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'bridges', 'session.bridge.js'),
    `import { bridge } from 'avenx-core/runtime';\n\nexport default bridge({\n  state: { signedIn: true },\n});\n`,
  );

  fs.mkdirSync(path.join(dir, 'src', 'guards'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'guards', 'auth.guard.js'),
    `import { AvenxGuard } from 'avenx-core/runtime';\nimport session from '../bridges/session.bridge.js';\n\nexport default class AuthGuard extends AvenxGuard {\n  /**\n   * @returns {boolean|string} The decision.\n   */\n  canActivate() {\n    return session.signedIn ? true : '#/login';\n  }\n}\n`,
  );

  // The guard is named, not imported: no import line for it here. Before the
  // fix the build emitted no registration for it, the router silently passed
  // the string, and the protected route was open.
  fs.writeFileSync(
    path.join(dir, 'src', 'main.app.js'),
    `import { AvenxApp } from 'avenx-core/runtime';\nconst app = new AvenxApp({ target: '#app' });\n\napp.initRouter({\n  '#/admin': { page: 'Admin', guards: ['AuthGuard'] },\n});\n`,
  );

  return dir;
}

try {
  /* -----------------------------------------------------------------------
   * A string guard is imported and registered by the compiler.
   * -------------------------------------------------------------------- */
  {
    const dir = scaffold();
    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `the project builds:\n${build.output}`);

    const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');
    new vm.Script(bundle, { filename: 'bundle.js' });
    assert.ok(bundle.includes('AuthGuard'), 'the guard class is emitted');
    assert.ok(
      /registerGuard\("AuthGuard"/.test(bundle),
      'the guard is registered on the app by name',
    );
    assert.ok(bundle.includes('session.signedIn'), 'and the guard can still read its bridge');
    console.log('  ✅ A string guard is imported and registered by the compiler.');
  }

  /* -----------------------------------------------------------------------
   * A name with no guard file is warned about, not registered from nothing.
   * -------------------------------------------------------------------- */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-string-guard-missing-'));
    dirs.push(dir);
    avenx(['init'], dir);
    fs.writeFileSync(
      path.join(dir, 'src', 'main.app.js'),
      `import { AvenxApp } from 'avenx-core/runtime';\nconst app = new AvenxApp({ target: '#app' });\n\napp.initRouter({\n  '#/admin': { page: 'Admin', guards: ['NoSuchGuard'] },\n});\n`,
    );

    const build = avenx(['build'], dir);
    assert.strictEqual(build.status, 0, `the project still builds:\n${build.output}`);
    assert.ok(
      build.output.includes('NoSuchGuard'),
      `the build warns about the unresolvable name:\n${build.output}`,
    );

    const bundle = fs.readFileSync(path.join(dir, 'dist', 'bundle.js'), 'utf-8');
    assert.ok(
      !bundle.includes('registerGuard("NoSuchGuard"'),
      'no registration is invented for a guard with no file',
    );
    console.log('  ✅ A name with no guard file is warned about, not registered.');
  }
} finally {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('🎉 All string guard system tests passed!');
