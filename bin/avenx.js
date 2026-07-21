#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AvenxCLI } from './cli.js';

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
    `Avenx requires Node.js ${MIN_NODE_VERSION.join('.')} or later.\n` + `Current version: ${process.versions.node}`,
  );
  process.exit(1);
}

if (command === '-v' || command === '--version') {
  console.log('Avenx-JS v' + packageJson.version);
  process.exit(0);
} else {
  const cli = new AvenxCLI();
  cli.run(command, args);
}
