import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseEnv, loadEnv, replaceEnvVariables } from '../../lib/env.js';
import AvenxCompiler from '../../lib/compiler.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs `fn` and returns the text of every warning the logger received.
 * @param {Function} fn - The work to run.
 * @returns {string[]} The warnings, in order.
 */
function warningsFrom(fn) {
  const seen = [];
  const previous = logger.config.transports;
  logger.configure({
    transports: [
      (level, formatted) => {
        if (level === 'warn') seen.push(Array.isArray(formatted) ? formatted.join(' ') : String(formatted));
      },
    ],
  });
  try {
    fn();
  } finally {
    logger.configure({ transports: previous });
  }
  return seen;
}

try {
  console.log('🧪 Testing Environment Variable Parser (parseEnv)...');

  // Test Case 1: basic unquoted values
  const envContent1 = `
  KEY_ONE=val1
  KEY_TWO = val2
  `;
  const parsed1 = parseEnv(envContent1);
  assert.strictEqual(parsed1['KEY_ONE'], 'val1');
  assert.strictEqual(parsed1['KEY_TWO'], 'val2');

  // Test Case 2: double/single quoted values
  const envContent2 = `
  KEY_THREE="val with spaces"
  KEY_FOUR='another val'
  `;
  const parsed2 = parseEnv(envContent2);
  assert.strictEqual(parsed2['KEY_THREE'], 'val with spaces');
  assert.strictEqual(parsed2['KEY_FOUR'], 'another val');

  // Test Case 3: inline comments
  const envContent3 = `
  KEY_FIVE=val5 # inline comment here
  KEY_SIX="val6 # comment inside quotes" # comment outside
  `;
  const parsed3 = parseEnv(envContent3);
  assert.strictEqual(parsed3['KEY_FIVE'], 'val5');
  assert.strictEqual(parsed3['KEY_SIX'], 'val6 # comment inside quotes');

  // Test Case 4: escape sequences
  const envContent4 = `
  KEY_SEVEN="line1\\nline2"
  KEY_EIGHT="val with \\" escaped quote"
  `;
  const parsed4 = parseEnv(envContent4);
  assert.strictEqual(parsed4['KEY_SEVEN'], 'line1\nline2');
  assert.strictEqual(parsed4['KEY_EIGHT'], 'val with " escaped quote');

  console.log('✅ parseEnv tests passed!');

  console.log('🧪 Testing loadEnv...');
  // Create temporary .env file
  const tempDir = path.join(__dirname, 'temp_env_test');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const originalVal = process.env.AVX_PUBLIC_TEST_PRESERVE;
  process.env.AVX_PUBLIC_TEST_PRESERVE = 'existing';

  fs.writeFileSync(
    path.join(tempDir, '.env'),
    `
  AVX_PUBLIC_TEST_VAR="hello_env"
  AVX_PUBLIC_TEST_PRESERVE="ignored"
  `,
  );

  loadEnv(tempDir);

  assert.strictEqual(process.env.AVX_PUBLIC_TEST_VAR, 'hello_env');
  assert.strictEqual(process.env.AVX_PUBLIC_TEST_PRESERVE, 'existing');

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalVal === undefined) {
    delete process.env.AVX_PUBLIC_TEST_PRESERVE;
  } else {
    process.env.AVX_PUBLIC_TEST_PRESERVE = originalVal;
  }
  delete process.env.AVX_PUBLIC_TEST_VAR;

  console.log('✅ loadEnv tests passed!');

  console.log('🧪 Testing replaceEnvVariables...');
  process.env.AVX_PUBLIC_API_URL = 'https://api.example.com';
  process.env.AVX_PUBLIC_PORT = '8080';

  const sourceJs = `
    const url = process.env.AVX_PUBLIC_API_URL;
    const singleQuoted = process.env['AVX_PUBLIC_API_URL'];
    const doubleQuoted = process.env["AVX_PUBLIC_API_URL"];
    const bracketSpaces = process.env[  'AVX_PUBLIC_API_URL'  ];
    const port = process.env.AVX_PUBLIC_PORT;
    const fallback = process.env.AVX_PUBLIC_UNDEFINED_VAR;
    const computed = process.env[envKey];
    const computedUnquoted = process.env[AVX_PUBLIC_API_URL];
    const privateValue = process.env['API_SECRET'];
  `;
  const replacedJs = replaceEnvVariables(sourceJs);
  assert.ok(replacedJs.includes('const url = "https://api.example.com";'));
  assert.ok(replacedJs.includes('const singleQuoted = "https://api.example.com";'));
  assert.ok(replacedJs.includes('const doubleQuoted = "https://api.example.com";'));
  assert.ok(replacedJs.includes('const bracketSpaces = "https://api.example.com";'));
  assert.ok(replacedJs.includes('const port = "8080";'));
  assert.ok(replacedJs.includes('const fallback = undefined;'));
  assert.ok(replacedJs.includes('const computed = process.env[envKey];'));
  assert.ok(replacedJs.includes('const computedUnquoted = process.env[AVX_PUBLIC_API_URL];'));
  assert.ok(replacedJs.includes("const privateValue = process.env['API_SECRET'];"));

  const templateStr = `<div>{{ process.env.AVX_PUBLIC_API_URL }}</div>`;
  const replacedTemplate = replaceEnvVariables(templateStr);
  assert.strictEqual(replacedTemplate, `<div>{{ "https://api.example.com" }}</div>`);

  // Clean up
  delete process.env.AVX_PUBLIC_API_URL;
  delete process.env.AVX_PUBLIC_PORT;

  console.log('✅ replaceEnvVariables tests passed!');

  console.log('🧪 Testing AVX_W60 (undefined AVX_PUBLIC_* reference)...');
  process.env.AVX_PUBLIC_API_URL = 'https://api.example.com';

  // Unset: one warning per variable, naming the variable and the file, with a
  // suggestion when a similarly named variable is set.
  const typoSource = `
    const a = process.env.AVX_PUBLIC_API_URLL;
    const b = process.env['AVX_PUBLIC_API_URLL'];
    const c = process.env.AVX_PUBLIC_NEVER_SET_ANYWHERE;
  `;
  let typoOutput;
  const unsetWarnings = warningsFrom(() => {
    typoOutput = replaceEnvVariables(typoSource, 'src/api.bridge.js');
  });
  assert.ok(typoOutput.includes('const a = undefined;'), 'the reference is still inlined as undefined');
  assert.strictEqual(unsetWarnings.length, 2, 'one warning per unset variable, not per reference');
  assert.ok(unsetWarnings[0].includes('AVX_W60'));
  assert.ok(unsetWarnings[0].includes('process.env.AVX_PUBLIC_API_URLL'), 'names the variable');
  assert.ok(unsetWarnings[0].includes('src/api.bridge.js'), 'names the file');
  assert.ok(unsetWarnings[0].includes('Did you mean "AVX_PUBLIC_API_URL"?'), 'suggests the close match');
  assert.ok(unsetWarnings[0].includes('avenx env'), 'points at avenx env');
  assert.ok(unsetWarnings[1].includes('process.env.AVX_PUBLIC_NEVER_SET_ANYWHERE'));

  // Set: no warning.
  const setWarnings = warningsFrom(() => {
    replaceEnvVariables('const a = process.env.AVX_PUBLIC_API_URL;', 'src/api.bridge.js');
  });
  assert.deepStrictEqual(setWarnings, [], 'a build where every variable is set emits no AVX_W60');

  // Without a file (a re-read of a file already reported): no warning.
  const noFileWarnings = warningsFrom(() => {
    replaceEnvVariables(typoSource);
  });
  assert.deepStrictEqual(noFileWarnings, [], 'callers that omit the file are not reported');

  // Severity overrides apply like any other warning.
  const offWarnings = warningsFrom(() => {
    replaceEnvVariables(typoSource, 'src/api.bridge.js', { warnings: { AVX_W60: 'off' } });
  });
  assert.deepStrictEqual(offWarnings, [], '"off" silences AVX_W60');
  assert.throws(
    () => replaceEnvVariables(typoSource, 'src/api.bridge.js', { warnings: { AVX_W60: 'error' } }),
    /AVX_W60/,
    '"error" escalates AVX_W60',
  );

  delete process.env.AVX_PUBLIC_API_URL;

  // Registered, and answered by `avenx explain`.
  assert.strictEqual(AvenxErrorCodes.COMPILER_UNDEFINED_PUBLIC_ENV, 'AVX_W60');
  const entry = getDiagnostic('AVX_W60');
  assert.ok(entry && entry.code === 'AVX_W60', 'AVX_W60 is in the catalogue');
  assert.ok(entry.summary && entry.causes.length > 0 && entry.remedies.length > 0, 'AVX_W60 is documented');
  assert.strictEqual(getDiagnostic('W60').code, 'AVX_W60', 'the short form resolves too');

  console.log('✅ AVX_W60 tests passed!');

  console.log('🧪 Testing AvenxCompiler environment integration...');
  // Verify that the compiler exposes publicEnv and replaces it in compilation
  const compilerTestDir = path.join(__dirname, 'temp_compiler_env_test');
  if (!fs.existsSync(compilerTestDir)) {
    fs.mkdirSync(compilerTestDir, { recursive: true });
  }

  // Create a .env file in the test project root
  fs.writeFileSync(
    path.join(compilerTestDir, '.env'),
    `
  AVX_PUBLIC_COMPILER_INJECT="success_injection"
  `,
  );

  // Create a minimal compiler options object
  const compiler = new AvenxCompiler({
    rootDir: compilerTestDir,
    srcDir: 'src',
    distDir: 'dist',
  });

  // Verify exposing to the compiler
  assert.strictEqual(compiler.publicEnv['AVX_PUBLIC_COMPILER_INJECT'], 'success_injection');

  // Verify replacement in a main.app.js
  const srcDir = path.join(compilerTestDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, 'main.app.js'),
    `
    const app = new AvenxApp();
    const secret = process.env.AVX_PUBLIC_COMPILER_INJECT;
  `,
  );

  // The entry module is assembled from main.app.js with the developer's own
  // imports intact; environment substitution happens on the way in.
  const virtualModules = new Map();
  let entryId;
  const entryWarnings = warningsFrom(() => {
    entryId = compiler.buildEntryModule(virtualModules, []);
  });
  const processedMain = virtualModules.get(entryId);
  assert.ok(processedMain.includes('const secret = "success_injection";'));
  assert.ok(!entryWarnings.some((w) => w.includes('AVX_W60')), 'no AVX_W60 when the variable is set');

  // An unset reference in main.app.js is reported against that file.
  fs.writeFileSync(
    path.join(srcDir, 'main.app.js'),
    `
    const app = new AvenxApp();
    const missing = process.env.AVX_PUBLIC_COMPILER_MISSING;
  `,
  );
  const missingWarnings = warningsFrom(() => {
    compiler.buildEntryModule(new Map(), []);
  });
  const w60 = missingWarnings.filter((w) => w.includes('AVX_W60'));
  assert.strictEqual(w60.length, 1, 'the build reports the unset variable once');
  assert.ok(w60[0].includes('AVX_PUBLIC_COMPILER_MISSING'));
  assert.ok(w60[0].includes(path.join('src', 'main.app.js')), 'the warning names main.app.js');

  // Clean up
  fs.rmSync(compilerTestDir, { recursive: true, force: true });
  delete process.env.AVX_PUBLIC_COMPILER_INJECT;

  console.log('✅ Compiler environment integration tests passed!');
} catch (err) {
  console.error('❌ Environment variables tests failed:');
  console.error(err);
  process.exit(1);
}
