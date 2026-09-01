#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AvenxCLI } from './cli.js';
import { red } from './colors.js';
import { reportFatal } from './fatal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

const [, , command, ...args] = process.argv;

const MIN_NODE_VERSION = [18, 0, 0];
const current = process.versions.node.split('.').map(Number);

function compareVersions(current, required) {
  for (let i = 0; i < required.length; i++) {
    if (current[i] > required[i]) return true;
    if (current[i] < required[i]) return false;
  }
  return true;
}

if (!compareVersions(current, MIN_NODE_VERSION)) {
  console.error(
    red(
      `Avenx requires Node.js ${MIN_NODE_VERSION.join('.')} or later.\n` + `Current version: ${process.versions.node}`,
    ),
  );
  process.exit(1);
}

/**
 * Human-readable label for the command being run, used in failure headlines.
 * @param {string} name - The command name.
 * @returns {string} The label.
 */
function actionLabel(name) {
  const labels = { build: 'Build', b: 'Build', watch: 'Build', w: 'Build', serve: 'Dev server' };
  return labels[name] || `avenx ${name || ''}`.trim();
}

// Nothing may fail silently. An error thrown from a callback or a promise that
// nobody awaited would otherwise print a bare trace, or in some Node versions
// not fail the process at all — which is the whole class of bug this guards.
process.on('unhandledRejection', (reason) => {
  reportFatal(reason, actionLabel(command));
});

process.on('uncaughtException', (error) => {
  reportFatal(error, actionLabel(command));
});

if (command === '-v' || command === '--version') {
  console.log('Avenx-JS v' + packageJson.version);
  process.exit(0);
} else {
  const options = {};
  if (command === 'init') {
    options.baseDir = process.cwd();
  }
  const cli = new AvenxCLI(options);

  // run() is async. Awaiting it is what lets a compiler failure reach the exit
  // code instead of resolving into nothing after the process has moved on.
  cli.run(command, args).catch((error) => {
    reportFatal(error, actionLabel(command));
  });
}
