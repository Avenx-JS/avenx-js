import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConfigSchema } from '../../lib/configSchema.js';

// schema/avenx.config.schema.json is published and referenced by every
// `avenx init` config, so it must match CONFIG_SCHEMA byte for byte. prepack
// regenerates it at release time, which hides drift from anyone working from
// the repository; this test surfaces it in every tier instead.
const schemaPath = fileURLToPath(new URL('../../schema/avenx.config.schema.json', import.meta.url));
const generated = `${JSON.stringify(buildConfigSchema(), null, 2)}\n`;

assert.equal(
  fs.readFileSync(schemaPath, 'utf8'),
  generated,
  'schema/avenx.config.schema.json is out of date with CONFIG_SCHEMA. Run npm run generate:config-schema',
);

console.log('Committed configuration schema matches the generator output.');
