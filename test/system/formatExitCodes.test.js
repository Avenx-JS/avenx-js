/**
 * @file formatExitCodes.test.js
 * @description The exit code `avenx format` promises, and what it prints.
 *
 * `avenx format` is the kind of command that ends up in a CI job or a
 * pre-commit hook, where its exit code is the whole contract: a non-zero exit
 * fails the pipeline and tells the developer something is wrong with their
 * code. The glob list names every file kind an Avenx project may contain, and
 * Prettier treats a glob that matches nothing as an error -- so until the
 * `--no-error-on-unmatched-pattern` flag was passed, a project that simply had
 * no Markdown, no components, no pages or no CSS failed `avenx format` with
 * "Formatting failed" printed over a run that had formatted everything it
 * found. A blank scaffold is exactly such a project.
 *
 * The other half of the contract matters just as much: the flag must not
 * swallow real failures. A file Prettier cannot parse still has to exit
 * non-zero, or the same CI job would pass broken code.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-format-exit-'));

/**
 * Runs a CLI command in the scaffolded project.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, output: string}} The result.
 */
function avenx(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

try {
  console.log('🧪 Testing avenx format exit codes...');

  // A blank scaffold: no components, no pages, no CSS, no Markdown. Exactly
  // the project the issue reports -- every one of those globs matches nothing.
  assert.strictEqual(avenx(['init', '-y']).status, 0, 'init should succeed');

  // --- a scaffold missing file kinds exits 0 ------------------------------
  {
    const format = avenx(['format']);
    assert.strictEqual(
      format.status,
      0,
      `a scaffold with no components, pages, CSS or Markdown must format cleanly:\n${format.output}`,
    );
    assert.ok(
      !format.output.includes('No files matching the pattern'),
      `formatting a project without a file kind must not report it as an error:\n${format.output}`,
    );
    assert.ok(
      format.output.includes('Formatting completed successfully.'),
      `a successful run must say so:\n${format.output}`,
    );
    console.log('  ✅ a scaffold with no components, pages, CSS or Markdown exits 0');
  }

  // --- the files that do exist are still formatted ------------------------
  {
    // A deliberately unformatted file: if the glob it matches were dropped
    // rather than merely tolerated when empty, this would stay untouched.
    fs.writeFileSync(path.join(root, 'src/main.app.js'), 'const  spacing  =  1;\n');

    const format = avenx(['format']);
    assert.strictEqual(format.status, 0, `formatting a real file must succeed:\n${format.output}`);

    const formatted = fs.readFileSync(path.join(root, 'src/main.app.js'), 'utf8');
    assert.strictEqual(formatted, 'const spacing = 1;\n', 'a file an existing glob matches must actually be formatted');
    console.log('  ✅ files the globs match are still formatted');
  }

  // --- --dry-run must not write ------------------------------------------
  {
    const unformatted = 'const  spacing  =  1;\n';
    fs.writeFileSync(path.join(root, 'src/main.app.js'), unformatted);

    const dry = avenx(['format', '--dry-run']);
    assert.strictEqual(dry.status, 0, `format --dry-run must exit 0 even when files would change:\n${dry.output}`);
    const afterDryRun = fs.readFileSync(path.join(root, 'src/main.app.js'), 'utf8');
    assert.strictEqual(afterDryRun, unformatted, `format --dry-run must not write any file:\n${dry.output}`);
    assert.ok(
      dry.output.includes('src/main.app.js'),
      `format --dry-run must list the files that would change:\n${dry.output}`,
    );
    console.log('  ✅ --dry-run lists unformatted files and writes nothing');
  }

  // --- --check fails on unformatted files and never writes ----------------
  {
    const unformatted = 'const  spacing  =  1;\n';
    fs.writeFileSync(path.join(root, 'src/main.app.js'), unformatted);

    const check = avenx(['format', '--check']);
    assert.notStrictEqual(
      check.status,
      0,
      `format --check must exit non-zero when a file is not formatted:\n${check.output}`,
    );
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'src/main.app.js'), 'utf8'),
      unformatted,
      `format --check must not write any file:\n${check.output}`,
    );
    assert.ok(
      check.output.includes('src/main.app.js'),
      `format --check must list the unformatted files:\n${check.output}`,
    );
    console.log('  ✅ --check lists unformatted files, exits non-zero, and writes nothing');

    // Once the project is formatted, --check passes.
    assert.strictEqual(avenx(['format']).status, 0, 'format should succeed');
    const clean = avenx(['format', '--check']);
    assert.strictEqual(clean.status, 0, `format --check must exit 0 on a formatted project:\n${clean.output}`);
    console.log('  ✅ --check exits 0 on a formatted project');
  }

  // --- unknown flags are rejected, not ignored ----------------------------
  {
    const unformatted = 'const  spacing  =  1;\n';
    fs.writeFileSync(path.join(root, 'src/main.app.js'), unformatted);

    const typo = avenx(['format', '--wirte']);
    assert.notStrictEqual(typo.status, 0, `an unknown format flag must fail:\n${typo.output}`);
    assert.strictEqual(
      fs.readFileSync(path.join(root, 'src/main.app.js'), 'utf8'),
      unformatted,
      `an unknown format flag must not format in place:\n${typo.output}`,
    );
    assert.ok(typo.output.includes('--wirte'), `the unknown flag must be named in the output:\n${typo.output}`);
    console.log('  ✅ an unknown flag is rejected and writes nothing');
    fs.writeFileSync(path.join(root, 'src/main.app.js'), 'const spacing = 1;\n');
  }

  // --- a file Prettier cannot parse still fails ---------------------------
  {
    fs.writeFileSync(path.join(root, 'broken.js'), 'const a = {');

    const format = avenx(['format']);
    assert.notStrictEqual(
      format.status,
      0,
      'a file Prettier cannot parse must fail the command -- the unmatched-pattern flag must not swallow real errors',
    );
    assert.ok(format.output.includes('Formatting failed.'), `a failed run must say so:\n${format.output}`);
    console.log('  ✅ a syntax error still exits non-zero');
  }

  console.log('✅ avenx format exit code tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
