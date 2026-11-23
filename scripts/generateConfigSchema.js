import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConfigSchema } from '../lib/configSchema.js';

const directory = fileURLToPath(new URL('../schema/', import.meta.url));
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(`${directory}/avenx.config.schema.json`, `${JSON.stringify(buildConfigSchema(), null, 2)}\n`);
