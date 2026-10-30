/**
 * Every literal `data-ax-*` name the framework uses must be in
 * RESERVED_DIRECTIVE_NAMES.
 *
 * Both render paths treat any other `data-ax-*` name as a custom directive, so
 * a marker added to `lib/` without being listed there would be taken for one:
 * the compiler would turn it into a CUSTOM op and the string renderer would
 * look it up as a directive.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RESERVED_DIRECTIVE_NAMES } from '../../lib/core/renderer/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scanned = ['lib', 'plugins'].map((dir) => path.join(root, dir));

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function testEveryFrameworkNameIsReserved() {
  console.log('🧪 Testing every data-ax-* name in lib/ and plugins/ is reserved...');

  const unlisted = new Set();
  for (const file of scanned.flatMap(jsFiles)) {
    for (const [, name] of fs.readFileSync(file, 'utf8').matchAll(/data-ax-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      if (!RESERVED_DIRECTIVE_NAMES.has(name)) unlisted.add(`${name} (${path.relative(root, file)})`);
    }
  }

  assert.deepStrictEqual([...unlisted], [], 'add these to RESERVED_DIRECTIVE_NAMES in lib/core/renderer/constants.js');
}

testEveryFrameworkNameIsReserved();
console.log('✅ Reserved directive name tests passed');
