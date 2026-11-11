/**
 * Establishes the invariant the resolver previously lacked:
 *
 *   the documented `alias` config participates in module resolution
 *
 * The original failure: `resolvePathAlias()` existed in lib/config.js and had
 * a passing unit test, but the bundler's resolver knew nothing about aliases.
 * An aliased import fell through to the bare-specifier branch, failed to find
 * a package, and the build died with AVX_C17 — exactly as documented in
 * issue #1712. The unit test stayed green because it called the function
 * directly and never ran a build.
 *
 * This suite drives the real CLI against real projects on disk, so the alias
 * is exercised where it failed: inside module resolution.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing path alias resolution...');

/**
 * Runs the Avenx CLI in a directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, output: string}} The result.
 */
function avenx(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

const projects = [];

process.on('exit', () => {
  for (const dir of projects) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

/**
 * Writes a project from a file map and links avenx-core into it.
 * @param {object<string, string>} files - Relative path to contents.
 * @returns {string} The project root.
 */
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-alias-'));
  projects.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  const nodeModulesDir = path.join(root, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  fs.symlinkSync(repoRoot, path.join(nodeModulesDir, 'avenx-core'), process.platform === 'win32' ? 'junction' : 'dir');
  return root;
}

/**
 * A project whose component, page, guard, bridge and main.app.js all import
 * through aliases — the prefix form and the named form, as the configuration
 * reference documents them.
 * @returns {string} The project root.
 */
function makeAliasProject() {
  return project({
    'avenx.config.json': JSON.stringify({ alias: { '@': 'src', '@components': 'src/components' } }),
    'src/lib/util.js': "export const greeting = 'aliased-ok';\n",
    'src/components/navbar/navbar.component.js':
      'import { greeting } from \'@/lib/util.js\';\n\n<div><p id="g">{{ greeting }}</p></div>\n',
    'src/pages/home.page.js':
      'import Nav from \'@components/navbar/navbar.component.js\';\n\n<state title="Home" />\n<div><Nav /></div>\n',
    'src/bridges/session.bridge.js':
      "import { bridge } from 'avenx-core/runtime';\nimport { greeting } from '@/lib/util.js';\n\nexport default bridge({\n  state: { message: greeting },\n});\n",
    'src/guards/auth.guard.js':
      "import { AvenxGuard } from 'avenx-core/runtime';\nimport { greeting } from '@/lib/util.js';\n\nexport default class AuthGuard extends AvenxGuard {\n  canActivate(to, from) {\n    return greeting === 'aliased-ok';\n  }\n}\n",
    'src/main.app.js':
      "import { AvenxApp } from 'avenx-core/runtime';\nimport AuthGuard from '@/guards/auth.guard.js';\n\nconst app = new AvenxApp({ target: '#app' });\napp.initRouter({ '': { page: 'Home', guards: [AuthGuard] } });\n",
  });
}

/* ---------------------------------------------------------------------------
 * An application importing through aliases builds, and the aliased modules
 * land in the bundle.
 * ------------------------------------------------------------------------ */
{
  const root = makeAliasProject();
  const result = avenx(['build'], root);
  assert.strictEqual(result.status, 0, `an aliased project must build, got:\n${result.output}`);
  const bundle = fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf-8');
  assert.ok(bundle.includes('aliased-ok'), 'the aliased lib module must be in the bundle');
  console.log('  ✅ Component, page, bridge, guard and main.app.js build through aliases.');
}

/* ---------------------------------------------------------------------------
 * A specifier that matches an alias key only partially stays a bare
 * specifier — the documented rule — and therefore still fails resolution.
 * ------------------------------------------------------------------------ */
{
  const root = makeAliasProject();
  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'partial.page.js'),
    'import { x } from \'@componentsButton.js\';\n\n<state title="Partial" />\n<div>{{ x }}</div>\n',
  );
  const result = avenx(['build'], root);
  assert.notStrictEqual(result.status, 0, 'a partial alias match is a bare specifier and must fail');
  assert.ok(result.output.includes('AVX_C17'), 'the failure is the bare-specifier resolution error');
  assert.ok(!result.output.includes('the alias'), 'a partial match must not be reported as an alias');
  console.log('  ✅ A partial key match stays a bare specifier.');
}

/* ---------------------------------------------------------------------------
 * An alias whose target does not exist fails with a message naming the alias
 * and the path it resolved to — not a bare "cannot resolve".
 * ------------------------------------------------------------------------ */
{
  const root = makeAliasProject();
  fs.writeFileSync(
    path.join(root, 'src', 'main.app.js'),
    "import { AvenxApp } from 'avenx-core/runtime';\nimport { nope } from '@/lib/missing.js';\n\nconst app = new AvenxApp({ target: '#app' });\n",
  );
  const result = avenx(['build'], root);
  assert.notStrictEqual(result.status, 0, 'a missing alias target must fail the build');
  assert.ok(result.output.includes('the alias "@"'), 'the error names the alias that matched');
  assert.ok(
    result.output.includes(path.join('src', 'lib', 'missing.js')),
    'the error names the path the alias resolved to',
  );
  console.log('  ✅ A missing alias target names the alias and the resolved path.');
}

console.log('🧪 Path alias resolution tests complete.');
