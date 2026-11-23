import fs from 'fs';
import path from 'path';
import { scanTags } from '../../lib/compiler/parser/tokenizer.js';

/**
 * Writes only a checked local file, or checks the same plan without writing.
 * @param {string} root
 * @param {string} name
 * @param {string|null} before - Null means the file must not exist.
 * @param {string} after
 * @param {boolean} dryRun
 * @returns {void}
 */
export function writeRepair(root, name, before, after, dryRun) {
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Repair must stay inside the project.');
  for (let current = target; current !== path.resolve(root); current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked path is preserved: ${name}`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  if (before !== null && fs.readFileSync(target, 'utf8') !== before) throw new Error(`${name} changed; rerun doctor.`);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, after, { flag: before === null ? 'wx' : 'w' });
}

/**
 * Plans edits to known scaffold URLs without serializing the HTML document.
 * Unknown/ambiguous entry points are left for the author to identify.
 * @param {string} html
 * @param {string} dist
 * @param {string} outputName
 * @returns {{html: string, referenced: boolean, ambiguous: boolean}} Replacement and diagnostic state.
 */
export function repairBundleReferences(html, dist, outputName) {
  dist = dist.replace(/\\/g, '/');
  const candidates = { js: [], css: [] };
  let referenced = false;
  for (const tag of scanTags(html, new Set(['script', 'link']))) {
    const attrs = Object.fromEntries(Object.entries(tag.attrs).map(([name, value]) => [name.toLowerCase(), value]));
    const ext = tag.lowerName === 'script' ? 'js' : 'css';
    if (ext === 'css' && attrs.rel?.toLowerCase() !== 'stylesheet') continue;
    const attr = Object.keys(tag.attrs).find((name) => name.toLowerCase() === (ext === 'js' ? 'src' : 'href'));
    if (!attr || tag.unterminated) continue;
    const value = tag.attrs[attr];
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) continue;
    const [, prefix, file, suffix] = value.match(/^(\.\/|\/)?([^?#]*)(.*)$/);
    const normalized = path.posix.normalize(file);
    const expected = path.posix.join(dist, `${outputName}.${ext}`);
    if (normalized === expected) referenced = true;
    const known = new Set([
      expected,
      `dist/bundle.${ext}`,
      path.posix.join(dist, `bundle.${ext}`),
      `dist/${outputName}.${ext}`,
    ]);
    if (known.has(normalized)) {
      candidates[ext].push({
        start: tag.attrOffsets[attr].valueStart,
        value,
        replacement: `${prefix || ''}${expected}${suffix}`,
      });
    }
  }
  const ambiguous = Object.values(candidates).some(
    (items) => items.length > 1 && items.some((item) => item.value !== item.replacement),
  );
  if (ambiguous) return { html, referenced, ambiguous };
  const edits = Object.values(candidates)
    .flat()
    .filter((item) => item.value !== item.replacement);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, edit.start) + edit.replacement + html.slice(edit.start + edit.value.length);
  }
  return { html, referenced: referenced || edits.length > 0, ambiguous };
}
