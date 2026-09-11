import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Registry tracking used snapshots per test file to detect obsolete entries
const fileSnapshotRegistry = new Map();

/**
 * Normalizes and formats DOM nodes or raw HTML strings into stable, deterministic markup.
 * Sorts attributes alphabetically, trims whitespace, and applies mask rules for volatile data.
 *
 * @param {Element|string|any} input
 * @param {object} [options={}]
 * @param {Array<{match: RegExp|string, replace: string}>} [options.masks=[]]
 * @returns {string}
 */
export function serializeSnapshot(input, options = {}) {
  const { masks = [] } = options;

  // If input is an element node directly, format it directly
  if (input && typeof input === 'object' && input.nodeType === 1) {
    let formatted = formatNode(input, 0);
    const defaultMasks = [
      { match: /\bax-[a-f0-9]{6,}\b/g, replace: 'ax-[hash]' },
      { match: /data-ax-[a-f0-9]{6,}/g, replace: 'data-ax-[hash]' },
    ];
    for (const { match, replace } of [...defaultMasks, ...masks]) {
      formatted = formatted.replace(match, replace);
    }
    return formatted;
  }

  let raw = '';
  if (typeof input === 'string') {
    raw = input.trim();
  } else if (input && typeof input.outerHTML === 'string') {
    raw = input.outerHTML.trim();
  } else if (input && typeof input.innerHTML === 'string') {
    raw = input.innerHTML.trim();
  } else {
    raw = String(input ?? '');
  }

  let formatted = '';
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    try {
      const template = document.createElement('template');
      template.innerHTML = raw;
      const rootNodes = template.content?.childNodes || template.childNodes || [];
      formatted = Array.from(rootNodes)
        .map((node) => formatNode(node, 0))
        .filter(Boolean)
        .join('\n');
    } catch {
      formatted = formatHtmlStringFallback(raw);
    }
  }

  if (!formatted) {
    formatted = formatHtmlStringFallback(raw);
  }

  const defaultMasks = [
    { match: /\bax-[a-f0-9]{6,}\b/g, replace: 'ax-[hash]' },
    { match: /data-ax-[a-f0-9]{6,}/g, replace: 'data-ax-[hash]' },
  ];

  let masked = formatted;
  for (const { match, replace } of [...defaultMasks, ...masks]) {
    masked = masked.replace(match, replace);
  }

  return masked;
}

function formatNode(node, depth) {
  const indent = '  '.repeat(depth);

  if (node.nodeType === 3) {
    // Text node
    const text = (node.textContent || '').trim();
    return text ? `${indent}${text}` : '';
  }

  if (node.nodeType === 8) {
    // Comment
    const comment = (node.textContent || '').trim();
    return `${indent}<!-- ${comment} -->`;
  }

  if (node.nodeType === 1) {
    // Element
    const tag = node.tagName.toLowerCase();
    const attrs = Array.from(node.attributes || [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((attr) => {
        if (attr.value === '' || attr.value === null) return attr.name;
        return `${attr.name}="${attr.value}"`;
      });

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    const children = Array.from(node.childNodes)
      .map((child) => formatNode(child, depth + 1))
      .filter(Boolean);

    const selfClosingTags = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);

    if (children.length === 0) {
      if (selfClosingTags.has(tag)) {
        return `${indent}<${tag}${attrStr} />`;
      }
      return `${indent}<${tag}${attrStr}></${tag}>`;
    }

    if (children.length === 1 && !children[0].includes('\n') && !children[0].startsWith('  '.repeat(depth + 1) + '<')) {
      const inlineText = children[0].trim();
      return `${indent}<${tag}${attrStr}>${inlineText}</${tag}>`;
    }

    return `${indent}<${tag}${attrStr}>\n${children.join('\n')}\n${indent}</${tag}>`;
  }

  return '';
}

function formatHtmlStringFallback(html) {
  return html
    .replace(/>\s*</g, '><')
    .replace(/(<[a-zA-Z0-9-]+)(\s+[^>]+)?(\/?>)/g, (_, open, attrs, close) => {
      if (!attrs) return `${open}${close}`;
      const sortedAttrs = attrs
        .trim()
        .split(/\s+(?=[a-zA-Z_:@-])/)
        .sort((a, b) => a.localeCompare(b))
        .join(' ');
      return `${open} ${sortedAttrs}${close}`;
    });
}

/**
 * Computes a readable line-by-line diff between expected and received strings.
 */
export function generateDiff(expected, received) {
  const expLines = (expected || '').split('\n');
  const recLines = (received || '').split('\n');

  const lines = ['Snapshot difference:'];
  const max = Math.max(expLines.length, recLines.length);

  for (let i = 0; i < max; i++) {
    const exp = expLines[i];
    const rec = recLines[i];

    if (exp === rec) {
      lines.push(`  ${exp ?? ''}`);
    } else {
      if (exp !== undefined) lines.push(`- ${exp}`);
      if (rec !== undefined) lines.push(`+ ${rec}`);
    }
  }

  return lines.join('\n');
}

/**
 * Resolves the caller test file path using stack traces.
 */
function resolveCallingTestFile() {
  const originalPrepare = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = err.stack;

    if (Array.isArray(stack)) {
      for (const frame of stack) {
        let filename = frame.getFileName();
        if (!filename) continue;
        if (filename.startsWith('file://')) {
          filename = fileURLToPath(filename);
        }
        if (filename.includes('.test.js') || filename.includes('.spec.js')) {
          return filename;
        }
      }
    }
  } finally {
    Error.prepareStackTrace = originalPrepare;
  }
  return null;
}

/**
 * Asserts that the received DOM node, wrapper, or HTML matches a persisted snapshot.
 *
 * @param {Element|string|object} received
 * @param {string} [name='default']
 * @param {object} [options={}]
 * @param {string} [options.testFile] Explicit test file path if stack inference is unavailable
 * @param {Array<{match: RegExp|string, replace: string}>} [options.masks=[]]
 */
export function assertSnapshot(received, name = 'default', options = {}) {
  const testFile = options.testFile || resolveCallingTestFile();

  if (!testFile) {
    throw new Error(
      'assertSnapshot: Could not infer calling test file. Pass options.testFile explicitly.'
    );
  }

  const snapshotDir = path.join(path.dirname(testFile), '__snapshots__');
  const snapshotFile = path.join(snapshotDir, `${path.basename(testFile)}.snap`);

  const serialized = serializeSnapshot(received, options);
  const isCI = Boolean(process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0');
  const isUpdate = Boolean(process.env.AVENX_UPDATE_SNAPSHOTS === '1' || process.env.UPDATE_SNAPSHOTS === '1');

  let snapshots = {};
  if (fs.existsSync(snapshotFile)) {
    try {
      snapshots = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    } catch {
      snapshots = {};
    }
  }

  if (!fileSnapshotRegistry.has(snapshotFile)) {
    fileSnapshotRegistry.set(snapshotFile, new Set());
  }
  fileSnapshotRegistry.get(snapshotFile).add(name);

  if (!(name in snapshots)) {
    if (isCI && !isUpdate) {
      throw new Error(
        `Snapshot "${name}" does not exist in CI mode for "${path.basename(testFile)}". Missing snapshot must fail in CI.`
      );
    }
    snapshots[name] = serialized;
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2) + '\n', 'utf8');
    return;
  }

  const expected = snapshots[name];
  if (expected !== serialized) {
    if (isUpdate) {
      snapshots[name] = serialized;
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2) + '\n', 'utf8');
      return;
    }

    const diff = generateDiff(expected, serialized);
    const error = new Error(`Snapshot mismatch for "${name}" in "${path.basename(testFile)}"\n\n${diff}`);
    error.expected = expected;
    error.actual = serialized;
    throw error;
  }
}

/**
 * Returns any snapshots found in the file that were not executed during the test suite.
 */
export function getObsoleteSnapshots(testFile) {
  const snapshotFile = path.join(path.dirname(testFile), '__snapshots__', `${path.basename(testFile)}.snap`);
  if (!fs.existsSync(snapshotFile)) return [];

  try {
    const snapshots = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    const used = fileSnapshotRegistry.get(snapshotFile) || new Set();
    return Object.keys(snapshots).filter((key) => !used.has(key));
  } catch {
    return [];
  }
}