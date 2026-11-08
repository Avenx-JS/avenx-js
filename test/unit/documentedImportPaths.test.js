
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Ensures all documented avenx-core import paths
 * resolve through the package's public exports.
 *
 * Regression test for GitHub issue #1682.
 * 
 */

const require = createRequire(import.meta.url);

const root = fileURLToPath(
  new URL('../../', import.meta.url)
);

const docsDir = path.join(
  root,
  'docs/src/content/docs'
);

// Find all Markdown documentation files.
function findMarkdownFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(md|mdx)$/.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

// Match static imports, re-exports, dynamic imports,
// require calls and side-effect imports.
const importPatterns = [
  /\bfrom\s*(['"])(avenx-core(?:\/[^'"\s`]+)?)\1/g,
  /\b(?:import|require)\s*\(\s*(['"])(avenx-core(?:\/[^'"\s`]+)?)\1/g,
  /\bimport\s*(['"])(avenx-core(?:\/[^'"\s`]+)?)\1/g,
];

const found = new Map();

function scanFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const relativeFile = path.relative(root, file);

  lines.forEach((line, index) => {
    for (const pattern of importPatterns) {
      pattern.lastIndex = 0;

      let match;

      while ((match = pattern.exec(line)) !== null) {
        const specifier = match[2];
        const location = `${relativeFile}:${index + 1}`;

        if (!found.has(specifier)) {
          found.set(specifier, new Set());
        }

        found.get(specifier).add(location);
      }
    }
  });
}

// Scan the documentation and root README.
assert.ok(
  fs.existsSync(docsDir),
  `Documentation directory missing: ${docsDir}`
);

const files = findMarkdownFiles(docsDir);
const readme = path.join(root, 'README.md');

if (fs.existsSync(readme)) {
  files.push(readme);
}

for (const file of files) {
  scanFile(file);
}

assert.ok(
  found.size > 0,
  'No avenx-core imports found in documentation'
);

// Resolve every discovered specifier.
// Resolution does not execute the target module.
const errors = [];

for (const [specifier, locations] of found) {
  try {
    require.resolve(specifier);
  } catch (error) {
    const reason = error.code || error.message;

    errors.push(
      `${specifier} (${reason})\n` +
      [...locations]
        .map((location) => `  ${location}`)
        .join('\n')
    );
  }
}

assert.deepEqual(
  errors,
  [],
  `Invalid documented import paths:\n${errors.join('\n\n')}`
);

console.log(
  `All ${found.size} documented avenx-core import paths resolve.`
);
