import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import loadConfig from '../../lib/config.js';
import { buildConfigSchema } from '../../lib/configSchema.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import Ajv from 'ajv';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-scaffold-config-'));
const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const configPath = path.join(root, 'avenx.config.json');
const writeConfig = (scaffold) => fs.writeFileSync(configPath, JSON.stringify({ scaffold }));
const invoke = (...args) => spawnSync(process.execPath, [bin, ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});
const run = (...args) => {
  const result = invoke(...args);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
};
const componentFile = (name, suffix) => path.join(root, 'src/components', name, `${name}.component.${suffix}`);
const originalWarn = logger.warn;
try {
  run('init', '--yes');
  writeConfig({ test: true, style: false });
  run('generate', 'component', 'Card');
  assert.ok(fs.existsSync(componentFile('card', 'test.js')), 'config should enable the component test');
  assert.equal(fs.existsSync(componentFile('card', 'css')), false);
  assert.doesNotMatch(fs.readFileSync(componentFile('card', 'js'), 'utf8'), /@css/);
  run('g', 'component', 'Badge', '--no-test', '--no-style');
  assert.ok(fs.existsSync(componentFile('badge', 'js')));
  assert.equal(fs.existsSync(componentFile('badge', 'test.js')), false);
  run('generate', 'page', 'Settings');
  assert.equal(fs.existsSync(path.join(root, 'src/pages/settings/settings.page.css')), false);

  writeConfig({ test: false, style: true });
  run('g', 'Forced', '--with-test', '--no-style');
  assert.ok(fs.existsSync(componentFile('forced', 'test.js')));
  assert.equal(fs.existsSync(componentFile('forced', 'css')), false);

  for (const name of ['house', 'other']) {
    const folder = path.join(root, '.avenxtemplates/component', name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'component.js.template'), `// ${name}\n<template><p>{{PascalCaseName}}</p></template>`);
  }
  writeConfig({ template: 'house', style: false });
  run('g', 'House');
  assert.match(fs.readFileSync(componentFile('house', 'js'), 'utf8'), /^\/\/ house/);
  run('g', 'Other', '--template', 'other');
  assert.match(fs.readFileSync(componentFile('other', 'js'), 'utf8'), /^\/\/ other/);
  run('g', 'Inline', '--template=other');
  assert.match(fs.readFileSync(componentFile('inline', 'js'), 'utf8'), /^\/\/ other/);
  assert.doesNotMatch(run('doctor'), /Unknown configuration option "scaffold/);

  const warnings = [];
  logger.warn = (...args) => warnings.push(args.join(' '));
  writeConfig({ tset: true });
  loadConfig(root);
  assert.ok(warnings.some((message) => /scaffold\.tset/.test(message) && /scaffold\.test/.test(message)));
  for (const [value, error] of [
    [null, /scaffold must be an object/], [[], /scaffold must be an object/],
    [{ test: 'yes' }, /scaffold.test must be a boolean/],
    [{ style: 0 }, /scaffold.style must be a boolean/],
    [{ template: false }, /scaffold.template must be a string or null/],
  ]) {
    writeConfig(value);
    const result = invoke('g', 'Rejected');
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, error);
    assert.equal(fs.existsSync(componentFile('rejected', 'js')), false);
  }
  writeConfig({});
  assert.deepEqual(loadConfig(root).scaffold, { test: false, style: true, template: null });
  fs.unlinkSync(configPath);
  assert.deepEqual(loadConfig(root).scaffold, { test: false, style: true, template: null });
  const validate = new Ajv().compile(buildConfigSchema());
  assert.equal(validate({ scaffold: { test: true, style: false, template: 'house' } }), true);
  assert.equal(validate({ scaffold: { template: null } }), true);
  assert.equal(validate({ scaffold: { test: 'true' } }), false);
  assert.equal(validate({ scaffold: { typo: true } }), false);
} finally {
  logger.warn = originalWarn;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Scaffold configuration defaults and flag overrides pass.');
