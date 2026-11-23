import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import loadConfig, { CONFIG_SCHEMA } from '../../lib/config.js';
import { buildConfigSchema } from '../../lib/configSchema.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema/avenx.config.schema.json'), 'utf8'));
assert.deepEqual(schema, buildConfigSchema(), 'published schema must be regenerated after configuration changes');
assert.deepEqual(Object.keys(schema.properties), CONFIG_SCHEMA.topLevel);
for (const [group, names] of Object.entries(CONFIG_SCHEMA)) {
  if (group !== 'topLevel') assert.deepEqual(Object.keys(schema.properties[group].properties), names);
}
const validate = new Ajv({ allErrors: true }).compile(schema);
for (const config of [{}, { mode: 'development', style: { preprocessor: 'scss' } },
  { logging: { level: 'warn' }, warnings: { AVX_W03: 'error' }, rewind: { onConflict: 'force' } },
  { server: { port: '${PORT}' }, mode: '$MODE' },
  { server: { headers: { 'X-Count': 2, 'Set-Cookie': ['a=1', 'b=2'] } } }]) {
  assert.ok(validate(config), JSON.stringify(validate.errors));
}
for (const config of [{ modes: 'development' }, { server: { ports: 3000 } },
  { mode: 'develpment' }, { style: { preprocessor: 'sas' } }, { logging: { level: 'noisy' } },
  { warnings: { AVX_W03: 'disabled' } }, { rewind: { onConflict: 'overwrite' } },
  { incremental: 'true' }, { expressionCacheCapacity: 0 },
  { mode: 'development$SUFFIX' }, { server: { port: 'port ${PORT}' } }]) {
  assert.equal(validate(config), false, JSON.stringify(config));
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-config-schema-'));
const warn = logger.warn;
try {
  const initialized = spawnSync(process.execPath, [path.join(root, 'bin/avenx.js'), 'init', '--yes'], {
    cwd: temporary, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(temporary, 'avenx.config.json'), 'utf8'));
  assert.equal(config.$schema, './node_modules/avenx-core/schema/avenx.config.schema.json');
  assert.ok(validate(config), JSON.stringify(validate.errors));
  const warnings = [];
  logger.warn = (...args) => warnings.push(args.join(' '));
  loadConfig(temporary);
  assert.equal(warnings.length, 0, warnings.join('\n'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('schema/'));
  assert.equal(pkg.exports['./schema/avenx.config.schema.json'], './schema/avenx.config.schema.json');
  console.log('Generated configuration schema validates configs and the real init scaffold.');
} finally {
  logger.warn = warn;
  fs.rmSync(temporary, { recursive: true, force: true });
}
