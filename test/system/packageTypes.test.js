import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

console.log('🧪 Testing that every exports subpath declares its types...');

for (const [subpath, target] of Object.entries(pkg.exports)) {
  // ./tooling/* is a wildcard, not a single file
  if (subpath.includes('*')) continue;

  assert.ok(target.types, `${subpath} needs a "types" condition in package.json`);
  assert.ok(fs.existsSync(path.join(rootDir, target.types)), `${target.types} does not exist`);
}

console.log('  ✅ Every exports subpath has a declaration file');
