import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConfigSchema } from '../lib/configSchema.js';

const directory = fileURLToPath(new URL('../schema/', import.meta.url));
const filename = `${directory}/avenx.config.schema.json`;
const generated = `${JSON.stringify(buildConfigSchema(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  let existing;
  try {
    existing = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing !== generated) {
    const expectedLines = generated.split('\n');
    const actualLines = (existing ?? '').split('\n');
    let line = 0;
    while (line < Math.max(expectedLines.length, actualLines.length)
      && expectedLines[line] === actualLines[line]) line++;
    const reason = existing === undefined ? 'missing' : `out of date (first difference at line ${line + 1})`;
    console.error(`schema/avenx.config.schema.json is ${reason}. Run npm run generate:config-schema.`);
    process.exitCode = 1;
  } else {
    console.log('Configuration schema is up to date.');
  }
} else {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filename, generated);
}
