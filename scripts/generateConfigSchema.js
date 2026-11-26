/**
 * @file generateConfigSchema.js
 * @description Writes schema/avenx.config.schema.json from CONFIG_SCHEMA.
 *
 * `--check` builds the schema and compares it with the committed file instead
 * of writing it: exit 0 when they match, exit 1 with a summary of the drift
 * when they do not. It never writes, so CI can run it on a clean checkout.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConfigSchema } from '../lib/configSchema.js';

const REGENERATE_COMMAND = 'npm run generate:config-schema';
const directory = fileURLToPath(new URL('../schema/', import.meta.url));
const schemaPath = `${directory}avenx.config.schema.json`;
const generated = `${JSON.stringify(buildConfigSchema(), null, 2)}\n`;

/**
 * Lists the JSON paths at which two values differ.
 * @param {unknown} expected - Generator output.
 * @param {unknown} actual - Committed file contents.
 * @param {string} [at] - Path of the values being compared.
 * @returns {string[]} One line per added, removed or changed path.
 */
function diffPaths(expected, actual, at = '$') {
  const isObject = (value) => value !== null && typeof value === 'object';
  if (!isObject(expected) || !isObject(actual) || Array.isArray(expected) !== Array.isArray(actual)) {
    return JSON.stringify(expected) === JSON.stringify(actual)
      ? []
      : [`  ~ ${at}: committed ${JSON.stringify(actual)}, generated ${JSON.stringify(expected)}`];
  }
  const lines = [];
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const child = Array.isArray(expected) ? `${at}[${key}]` : `${at}.${key}`;
    if (!(key in actual)) lines.push(`  + ${child} (missing from the committed file)`);
    else if (!(key in expected)) lines.push(`  - ${child} (no longer generated)`);
    else lines.push(...diffPaths(expected[key], actual[key], child));
  }
  if (lines.length === 0 && JSON.stringify(Object.keys(expected)) !== JSON.stringify(Object.keys(actual))) {
    lines.push(`  ~ ${at}: key order differs`);
  }
  return lines;
}

/**
 * Compares the committed schema with generator output.
 * @returns {number} Process exit code.
 */
function check() {
  if (!fs.existsSync(schemaPath)) {
    console.error(`schema/avenx.config.schema.json is missing.\nRun ${REGENERATE_COMMAND}`);
    return 1;
  }
  const committed = fs.readFileSync(schemaPath, 'utf8');
  if (committed === generated) {
    console.log('schema/avenx.config.schema.json is up to date.');
    return 0;
  }
  let summary;
  try {
    summary = diffPaths(JSON.parse(generated), JSON.parse(committed));
  } catch (error) {
    summary = [`  committed file is not valid JSON: ${error.message}`];
  }
  if (summary.length === 0) summary = ['  formatting differs (whitespace or trailing newline)'];
  console.error(
    `schema/avenx.config.schema.json is out of date with CONFIG_SCHEMA:\n${summary.join('\n')}\n` +
      `Run ${REGENERATE_COMMAND}`,
  );
  return 1;
}

if (process.argv.includes('--check')) {
  process.exitCode = check();
} else {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(schemaPath, generated);
}
