import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set env to test so that loadConfig throws validation errors instead of process.exit
process.env.NODE_ENV = 'test';

import loadConfig from '../../lib/config.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('Running config warning-code validation tests...');

let loggedWarnings = [];
const origWarn = logger.warn;
logger.warn = (...args) => loggedWarnings.push(args.join(' '));

function loadWith(userConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-config-warning-codes-'));
  try {
    fs.writeFileSync(path.join(dir, 'avenx.config.json'), JSON.stringify(userConfig), 'utf8');
    loggedWarnings = [];
    const config = loadConfig(dir);
    return { config, warnings: [...loggedWarnings] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  // 1. A code that does not exist is reported, not silently accepted.
  {
    const { config, warnings } = loadWith({ warnings: { AVX_W99: 'off' } });
    assert.strictEqual(warnings.length, 1, 'AVX_W99 must produce exactly one warning');
    assert.ok(warnings[0].includes('Unknown warning code "AVX_W99"'), warnings[0]);
    assert.ok(warnings[0].includes('No diagnostic uses this code'), warnings[0]);
    assert.strictEqual(config.warnings.AVX_W99, 'off', 'The entry is kept as written; it is reported, not rewritten');
  }

  // 2. A truncated code is reported and suggests the code it truncates.
  {
    const { warnings } = loadWith({ warnings: { AVX_W5: 'off' } });
    assert.strictEqual(warnings.length, 1, 'AVX_W5 must produce exactly one warning');
    assert.ok(warnings[0].includes('Unknown warning code "AVX_W5"'), warnings[0]);
    assert.ok(warnings[0].includes('"AVX_W55"'), `Suggestion must include AVX_W55: ${warnings[0]}`);
  }

  // 3. The short form `avenx explain` accepts does not silently apply in the
  // config: it is reported, with the canonical spelling as the suggestion.
  {
    const { config, warnings } = loadWith({ warnings: { W55: 'off' } });
    assert.strictEqual(warnings.length, 1, 'W55 must produce exactly one warning');
    assert.ok(warnings[0].includes('Unknown warning code "W55"'), warnings[0]);
    assert.ok(warnings[0].includes('Did you mean "AVX_W55"?'), warnings[0]);
    assert.strictEqual(config.warnings.AVX_W55, undefined, 'The short form must not be applied as AVX_W55');
  }

  // 4. A lowercase spelling is reported with the canonical spelling suggested.
  {
    const { warnings } = loadWith({ warnings: { 'avx_w55': 'off' } });
    assert.strictEqual(warnings.length, 1, 'avx_w55 must produce exactly one warning');
    assert.ok(warnings[0].includes('Did you mean "AVX_W55"?'), warnings[0]);
  }

  // 5. A one-character typo of a real code suggests that code.
  {
    const { warnings } = loadWith({ warnings: { AVX_W700: 'off' } });
    assert.strictEqual(warnings.length, 1, 'AVX_W700 must produce exactly one warning');
    assert.ok(warnings[0].includes('Did you mean "AVX_W70"?'), warnings[0]);
  }

  // 6. Codes that exist but are not warnings are reported as having no effect:
  // a severity override can only steer AVX_W* warnings.
  for (const code of ['AVX_C01', 'AVX_R08']) {
    const { warnings } = loadWith({ warnings: { [code]: 'off' } });
    assert.strictEqual(warnings.length, 1, `${code} must produce exactly one warning`);
    assert.ok(warnings[0].includes(`"${code}"`), warnings[0]);
    assert.ok(warnings[0].includes('is not a warning code'), warnings[0]);
    assert.ok(warnings[0].includes('has no effect'), warnings[0]);
  }

  // 7. Every real warning code still works, with no new output.
  {
    const { config, warnings } = loadWith({ warnings: { AVX_W55: 'off' } });
    assert.deepStrictEqual(warnings, [], 'A valid AVX_W55 entry must not warn');
    assert.strictEqual(config.warnings.AVX_W55, 'off');
  }

  // 8. A valid config produces no new messages.
  {
    const { warnings } = loadWith({ warnings: { AVX_W03: 'error', AVX_W01: 'off' } });
    assert.deepStrictEqual(warnings, [], 'Valid warning codes must not warn');
    const empty = loadWith({});
    assert.deepStrictEqual(empty.warnings, [], 'A config without warnings must not warn');
  }

  // 9. In a mixed map, only the unknown key is reported.
  {
    const { warnings } = loadWith({ warnings: { AVX_W55: 'off', AVX_W99: 'warn' } });
    assert.strictEqual(warnings.length, 1, 'Only the unknown key must be reported');
    assert.ok(warnings[0].includes('"AVX_W99"'), warnings[0]);
  }

  // 10. Severity validation is unchanged: an invalid severity still throws.
  {
    assert.throws(() => loadWith({ warnings: { AVX_W55: 'disabled' } }), /Invalid severity "disabled" for warning "AVX_W55"/);
  }

  console.log('✔ All config warning-code validation tests passed.');
} finally {
  logger.warn = origWarn;
}
