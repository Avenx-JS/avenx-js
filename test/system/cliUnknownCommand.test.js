/**
 * @file cliUnknownCommand.test.js
 * @description What the CLI does with a command it does not recognise.
 *
 * `default: printHelp(); break;` handled both "no command" and "a command I
 * have never heard of", so `avenx buidl` printed the help text and exited 0.
 * In a deploy script that reads `avenx buidl && deploy`, the typo deploys
 * whatever was already in dist/ -- the same failure mode as the declined
 * working-tree prompt, reached by a different route.
 *
 * Bare `avenx` and `avenx help` are requests for help and must keep exiting 0.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { KNOWN_COMMANDS } from '../../bin/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const cwd = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-unknown-cmd-'));

/**
 * Runs the CLI and captures both streams.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, stdout: string, stderr: string, output: string}} The result.
 */
function runCli(args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { status: res.status, stdout, stderr, output: stdout + stderr };
}

try {
  console.log('🧪 Testing unknown command handling...');

  // --- an unrecognised command fails -------------------------------------
  {
    const { status, output } = runCli(['totallybogus']);
    assert.strictEqual(
      status,
      1,
      'an unrecognised command must exit non-zero, or "avenx buidl && deploy" ' +
        'deploys a stale bundle',
    );
    assert.ok(/Unknown command/i.test(output), 'the failure should say what went wrong');
    assert.ok(/totallybogus/.test(output), 'and name the command as typed');
    console.log('  ✅ an unrecognised command exits non-zero and says so');
  }

  // --- the error goes to stderr ------------------------------------------
  {
    const { stderr } = runCli(['totallybogus']);
    assert.ok(
      /Unknown command/i.test(stderr),
      'the error belongs on stderr, so `avenx x > out.txt` still shows it',
    );
    console.log('  ✅ the error is written to stderr');
  }

  // --- a near miss suggests the real command -----------------------------
  {
    for (const [typo, expected] of [['buidl', 'build'], ['serv', 'serve'], ['gnerate', 'generate']]) {
      const { output } = runCli([typo]);
      assert.ok(
        new RegExp(`avenx ${expected}`).test(output),
        `"${typo}" should suggest "avenx ${expected}". Got:\n${output}`,
      );
    }
    console.log('  ✅ a near miss suggests the intended command');
  }

  // --- a command nothing resembles just fails ----------------------------
  {
    const { status, output } = runCli(['zzzzzzzzzzzz']);
    assert.strictEqual(status, 1, 'it still fails');
    assert.ok(!/Did you mean/.test(output), 'no suggestion is offered when nothing is close');
    console.log('  ✅ no suggestion is invented when nothing is close');
  }

  // --- help is still help -------------------------------------------------
  {
    for (const args of [[], ['help']]) {
      const { status, stdout } = runCli(args);
      assert.strictEqual(status, 0, `"avenx ${args.join(' ')}" must still exit 0`);
      assert.ok(/Usage: avenx/.test(stdout), 'and still print the usage text');
    }
    const version = runCli(['--version']);
    assert.strictEqual(version.status, 0, '--version must still exit 0');
    console.log('  ✅ no command, "help" and --version still exit 0');
  }

  // --- every documented command is recognised ----------------------------
  {
    // A command listed in the help text but missing from the dispatcher would
    // now fail outright rather than quietly printing help, so the two lists are
    // checked against each other. Compared statically: running each one would
    // start `serve` and `watch`, which do not return.
    const help = runCli(['help']).stdout;
    const documented = new Set(
      [...help.matchAll(/^ {2}([a-z][\w-]*)/gm)].map((match) => match[1]),
    );
    assert.ok(documented.size > 10, `expected commands in the help text, found ${documented.size}`);

    const missing = [...documented].filter((name) => !KNOWN_COMMANDS.includes(name));
    assert.deepStrictEqual(
      missing,
      [],
      `these commands are listed in the help text but the dispatcher does not ` +
        `know them, so typing one now fails: ${missing.join(', ')}`,
    );
    console.log(`  ✅ all ${documented.size} commands in the help text are dispatched`);
  }

  console.log('✅ Unknown command tests passed!');
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
