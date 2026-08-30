/**
 * Exercises Avenx Rewind through the CLI, the way a developer meets it: run
 * `avenx check`, read the warnings, run `avenx build`, look at what it wrote.
 *
 * The fixture under `test/fixtures/rewind-app` is shaped to contain one of
 * every finding — an atomic bridge action a component calls, an action with a
 * computed member write, one that emits and writes storage, and a like/unlike
 * pair — beside a caller/callee pair that must stay quiet.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');
const fixture = path.join(repoRoot, 'test/fixtures/rewind-app');

console.log('🧪 Testing Avenx Rewind through the CLI...');

/**
 * Runs the CLI in the fixture project.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function avenx(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

try {
  // ── avenx check reports every finding ────────────────────────────────────
  {
    const result = avenx(['check']);
    const output = `${result.stdout}${result.stderr}`;

    assert.ok(output.includes('[AVX_W42] cart.setField'), `AVX_W42 is reported: ${output}`);
    assert.ok(output.includes('dynamic-member "item[field]"'), 'and names the reason');
    assert.ok(output.includes('[AVX_W43] session.save'), `AVX_W43 is reported: ${output}`);
    assert.ok(output.includes('localStorage.setItem('), 'and names the storage write');
    assert.ok(output.includes("emit('saved'"), 'and the emit');
    assert.ok(
      output.includes('[AVX_W44] PostCard.like and PostCard.unlike'),
      `AVX_W44 is reported: ${output}`,
    );
    assert.ok(
      !/\[AVX_W44\][^\n]*cart\.addQty and CartItem\./.test(output),
      `AVX_W44 stays quiet on a caller and its callee: ${output}`,
    );
    console.log('  ✅ avenx check reports the Rewind findings.');
  }

  // ── and in --json, like every other diagnostic ───────────────────────────
  {
    const result = avenx(['check', '--json']);
    const report = JSON.parse(result.stdout);
    const codes = report.diagnostics.map((entry) => entry.code).filter(Boolean);

    assert.ok(codes.includes('AVX_W42'), `AVX_W42 reaches --json: ${codes.join(', ')}`);
    assert.ok(codes.includes('AVX_W43'), 'AVX_W43 reaches --json');
    assert.ok(codes.includes('AVX_W44'), 'AVX_W44 reaches --json');
    assert.strictEqual(report.errorCount, 0, 'none of them is an error by default');
    console.log('  ✅ The findings reach machine-readable output.');
  }

  // ── the build carries the declaration into the bundle and the Atlas ──────
  {
    const result = avenx(['build']);
    assert.strictEqual(result.status, 0, `the build succeeds: ${result.stderr}`);

    const bundle = fs.readFileSync(path.join(fixture, 'dist', 'bundle.js'), 'utf8');
    assert.ok(bundle.includes('atomic: {'), 'the compiled component carries its atomic descriptor');
    assert.ok(bundle.includes('"onConflict":"force"'), 'including a declared conflict policy');
    assert.ok(
      !bundle.includes('journal.configure('),
      'a project using the default rewind settings ships no configuration at all',
    );

    const atlas = JSON.parse(fs.readFileSync(path.join(fixture, 'dist', 'bundle.atlas.json'), 'utf8'));
    const addQty = atlas.nodes.find((node) => node.id === 'action:bridge:cart.addQty');
    assert.strictEqual(addQty.atomic, true, 'the Atlas artifact records the declaration');

    const decQty = atlas.nodes.find((node) => node.id === 'action:component:CartItem.decQty');
    assert.strictEqual(decQty.onConflict, 'force', 'and the policy');

    const save = atlas.nodes.find((node) => node.id === 'action:bridge:session.save');
    assert.deepStrictEqual(
      save.irreversible.map((effect) => effect.kind),
      ['storage', 'emit'],
      'and what a rewind of it will leave behind',
    );

    const plain = atlas.nodes.find((node) => node.id === 'action:component:PostCard.like');
    assert.strictEqual(plain.atomic, true, 'component actions are recorded too');
    console.log('  ✅ The build carries the declaration into the bundle and the Atlas.');
  }

  // ── a warning can be escalated to a build failure ────────────────────────
  {
    const configPath = path.join(fixture, 'avenx.config.json');
    const original = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ srcDir: 'src', distDir: 'dist', warnings: { AVX_W43: 'error' } }),
    );
    try {
      const result = avenx(['build']);
      assert.notStrictEqual(result.status, 0, 'escalating AVX_W43 fails the build');
      assert.ok(
        `${result.stdout}${result.stderr}`.includes('AVX_W43'),
        'and says which finding stopped it',
      );
    } finally {
      fs.writeFileSync(configPath, original);
    }
    console.log('  ✅ A Rewind warning can gate a build.');
  }

  // ── a non-default rewind config reaches the bundle ───────────────────────
  {
    const configPath = path.join(fixture, 'avenx.config.json');
    const original = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ srcDir: 'src', distDir: 'dist', rewind: { onConflict: 'abort', maxSnapshotItems: 500 } }),
    );
    try {
      const result = avenx(['build']);
      assert.strictEqual(result.status, 0, `the build succeeds: ${result.stderr}`);
      const bundle = fs.readFileSync(path.join(fixture, 'dist', 'bundle.js'), 'utf8');
      assert.ok(
        bundle.includes('Avenx.journal.configure({"onConflict":"abort","maxSnapshotItems":500})'),
        'the project configuration reaches the runtime',
      );
    } finally {
      fs.writeFileSync(configPath, original);
      avenx(['build']);
    }
    console.log('  ✅ Project configuration reaches the runtime, and only when it differs.');
  }

  console.log('🎉 Avenx Rewind CLI tests passed.');
} catch (error) {
  console.error('❌ Avenx Rewind CLI tests failed:', error);
  process.exit(1);
}
