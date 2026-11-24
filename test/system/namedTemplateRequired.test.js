import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-named-template-'));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});
const snapshot = (dir) => fs.readdirSync(dir).sort().flatMap((name) => {
  const target = path.join(dir, name);
  return fs.statSync(target).isDirectory()
    ? [[target, 'directory'], ...snapshot(target)]
    : [[target, fs.statSync(target).mtimeMs, fs.readFileSync(target, 'hex')]];
});
const write = (name, content) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

try {
  assert.equal(run('init', '--yes').status, 0);
  for (const kind of ['component', 'page', 'bridge', 'guard']) {
    for (const flags of [[], ['--dry-run'], ['--force']]) {
      const before = snapshot(root);
      const result = run('generate', kind, 'Example', '--template', 'ghost', ...flags);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /No scaffold template named "ghost"/);
      assert.ok(result.stderr.includes(kind));
      assert.match(result.stderr, /\.avenxtemplates/);
      assert.match(result.stderr, /templates\//);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
      assert.deepEqual(snapshot(root), before, `${kind}: no partial scaffold or registration`);
    }
  }

  // Every existing named-template spelling remains usable in either search root.
  const spellings = (name) => [
    `component/${name}/component.js.template`,
    `component/${name}.component.js.template`,
    `component/component.js.${name}.template`,
    `${name}/component.js.template`,
    `${name}.component.js.template`,
    `${name}.component.template.template`,
    `${name}.template.template`,
  ];
  for (const directory of ['.avenxtemplates', 'templates']) {
    for (let i = 0; i < 7; i++) {
      const name = `variant${directory === 'templates' ? 'b' : 'a'}${i}`;
      write(`${directory}/${spellings(name)[i]}`, `<p>${name} {{PascalCaseName}}</p>`);
      const result = run('generate', 'component', name, '--template', name, '--with-test');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(fs.readFileSync(path.join(root, `src/components/${name}/${name}.component.js`), 'utf8'),
        new RegExp(`<p>${name} `));
      assert.ok(fs.existsSync(path.join(root, `src/components/${name}/${name}.component.css`)));
      assert.ok(fs.existsSync(path.join(root, `src/components/${name}/${name}.component.test.js`)));
    }
  }
  write('.avenxtemplates/component/card/component.js.template', '<p>Card</p>');
  write('templates/component/form/component.js.template', '<p>Form</p>');
  const typo = run('generate', 'component', 'Example', '-t', 'crad');
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Available:.*card.*form/);
  assert.match(typo.stderr, /Did you mean "card"/);

  // A named partial override can still use defaults for companion files.
  write('.avenxtemplates/component/styled/component.css.template', '/* custom stylesheet */');
  assert.equal(run('generate', 'component', 'Styled', '-t', 'styled').status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'src/components/styled/styled.component.css'), 'utf8'),
    '/* custom stylesheet */');
  for (const kind of ['page', 'bridge', 'guard']) {
    write(`templates/${kind}/custom/${kind}.js.template`, '// custom {{PascalCaseName}}');
    const result = run('generate', kind, 'Custom', '-t', 'custom');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const directory = kind === 'bridge' ? 'global' : `${kind}s`;
    assert.match(fs.readFileSync(path.join(root, `src/${directory}/custom.${kind}.js`), 'utf8'), /\/\/ custom Custom/);
  }
  console.log('Unknown named templates fail without writes; existing spellings and partial overrides work.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
