/**
 * @file cliHelpOptions.test.js
 * @description `avenx help` and the CLI reference document every flag the CLI parses.
 *
 * The Options block listed only `--trace` under `serve`, while `bin/cli.js`
 * also reads `--port`/`-p`, `--host`/`-h`, `--open`/`-o` and
 * `--no-live-reload` (issue #1351). The README already documented them.
 *
 * The same gap reopened for `--code-splitting`/`--split`, `--strict`, `--yes`,
 * `--interactive` and `--roots=<n>` (issue #1691). The second half of this file
 * therefore derives the flag list from the source under `bin/` instead of
 * naming flags: a flag the CLI starts to parse fails here until it is listed
 * in `avenx help` and in `docs/src/content/docs/cli-reference/commands.md`.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(__dirname, '../../bin');
const BIN_PATH = path.join(BIN_DIR, 'avenx.js');
const HELP_SOURCE = path.join(BIN_DIR, 'commands/help.js');
const REFERENCE = path.join(__dirname, '../../docs/src/content/docs/cli-reference/commands.md');

console.log('🧪 Testing that `avenx help` lists the serve flags...');

const res = spawnSync(process.execPath, [BIN_PATH, 'help'], {
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
});
assert.strictEqual(res.status, 0, '`avenx help` should exit 0');

const help = res.stdout || '';
const options = help.split('Options:')[1] || '';
assert.ok(options, 'help output should have an Options section');

for (const flag of ['--port, -p <port>', '--host, -h <host>', '--open, -o', '--no-live-reload', '--trace']) {
  assert.ok(options.includes(flag), `Options should list "${flag}". Got:\n${options}`);
}
console.log('  ✅ every serve flag parsed in bin/cli.js is listed');

assert.ok(/--json, -j.*explain/.test(options), 'the --json row should mention explain');
console.log('  ✅ the --json row mentions explain');

const trailing = help.split('\n').filter((line) => /\S\s+$/.test(line));
assert.deepStrictEqual(trailing, [], 'no help line should end in trailing whitespace');
console.log('  ✅ no trailing whitespace after text');

console.log('🧪 Testing that every flag parsed under bin/ is in `avenx help` and the CLI reference...');

/**
 * Flag-shaped strings under bin/ that are not avenx flags, with the reason.
 * @type {Set<string>}
 */
const NOT_AVENX_FLAGS = new Set([
  // Arguments `avenx format` passes through to Prettier (bin/commands/format.js).
  '--plugin',
  '--no-error-on-unmatched-pattern',
  '--list-different',
  '--write',
]);

/**
 * Spellings the CLI accepts for a flag that is listed under another name. The
 * listed name is the one the help text and the reference are checked for.
 * @type {Record<string, string>}
 */
const LISTED_AS = {
  '--development': '--dev',
  '--production': '--prod',
  '--no-colors': '--no-color',
};

/**
 * Every quoted flag literal: `'--dry-run'`, `"-d"`, and the value-taking form `'--port='`.
 */
const FLAG_LITERAL = /(['"])(--?[a-zA-Z][a-zA-Z0-9-]*)=?\1/g;

/**
 * Lists the JavaScript files under a directory, except the help text itself.
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') && full !== HELP_SOURCE ? [full] : [];
  });
}

/**
 * Whether a text names a flag as a whole word: `--strict` is not found in
 * `--strict-a11y`, and `-d` is not found in `--dry-run` or `pre-defined`.
 * @param {string} text - Help output or reference markdown.
 * @param {string} flag - The flag, without any `=<value>` suffix.
 * @returns {boolean} True when the flag is mentioned.
 */
function mentions(text, flag) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${escaped}(?![\\w-])`, 'm').test(text);
}

/** @type {Map<string, Set<string>>} flag -> files under bin/ that parse it */
const parsedFlags = new Map();
for (const file of sourceFiles(BIN_DIR)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(FLAG_LITERAL)) {
    const flag = match[2];
    if (NOT_AVENX_FLAGS.has(flag)) continue;
    const listed = LISTED_AS[flag] || flag;
    if (!parsedFlags.has(listed)) parsedFlags.set(listed, new Set());
    parsedFlags.get(listed).add(path.relative(BIN_DIR, file));
  }
}
assert.ok(
  parsedFlags.has('--dev') && parsedFlags.has('--code-splitting') && parsedFlags.has('-d'),
  'the flag scan should find the flags bin/cli.js parses',
);

const reference = fs.readFileSync(REFERENCE, 'utf8');
const missingFromHelp = [];
const missingFromReference = [];
for (const flag of [...parsedFlags.keys()].sort()) {
  const where = `${flag} (parsed in ${[...parsedFlags.get(flag)].join(', ')})`;
  if (!mentions(help, flag)) missingFromHelp.push(where);
  if (!mentions(reference, flag)) missingFromReference.push(where);
}

assert.deepStrictEqual(missingFromHelp, [], 'every flag the CLI parses should be listed in `avenx help`');
console.log(`  ✅ all ${parsedFlags.size} flags parsed under bin/ are listed in \`avenx help\``);

assert.deepStrictEqual(
  missingFromReference,
  [],
  `every flag the CLI parses should be in ${path.relative(path.join(__dirname, '../..'), REFERENCE)}`,
);
console.log('  ✅ all of them are in the CLI reference');
