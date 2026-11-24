import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTemplate } from '../../bin/utils.js';

const framework = fileURLToPath(new URL('../../', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-template-files-'));
const read = (base, kind = 'component') => readTemplate(base, {}, framework, kind, `${kind}.js.template`, 'ghost');

try {
  for (const [index, unrelated] of [
    'ghost.txt', 'note.ghost.txt', 'ghost/page.js.template', 'component/ghost/README.md',
    'component/ghost.component.css.template/placeholder.txt',
  ].entries()) {
    const base = path.join(root, String(index));
    const file = path.join(base, '.avenxtemplates', unrelated);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'unrelated');
    assert.throws(() => read(base), { code: 'AVENX_TEMPLATE_NOT_FOUND' }, unrelated);
  }

  const base = path.join(root, 'empty-directory');
  fs.mkdirSync(path.join(base, '.avenxtemplates/ghost'), { recursive: true });
  assert.throws(() => read(base), { code: 'AVENX_TEMPLATE_NOT_FOUND' });

  // A real companion override is sufficient even when the requested file falls back.
  const style = path.join(base, '.avenxtemplates/ghost/component.css.template');
  fs.writeFileSync(style, '/* named stylesheet */');
  assert.equal(read(base), fs.readFileSync(path.join(framework, 'templates/component/component.js.template'), 'utf8'));
  assert.equal(readTemplate(base, {}, framework, 'component', 'component.css.template', 'ghost'), '/* named stylesheet */');
  assert.throws(() => read(base, 'page'), { code: 'AVENX_TEMPLATE_NOT_FOUND' });
  console.log('Only usable template files establish a named scaffold.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
