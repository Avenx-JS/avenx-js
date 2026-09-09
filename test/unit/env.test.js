import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseEnv, loadEnv, replaceEnvVariables } from '../../lib/env.js';
import AvenxCompiler from '../../lib/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const port = process.env.AVX_PUBLIC_PORT;
    const fallback = process.env.AVX_PUBLIC_UNDEFINED_VAR;
  `;
  const replacedJs = replaceEnvVariables(sourceJs);
  assert.ok(replacedJs.includes('const url = "https://api.example.com";'));
  assert.ok(replacedJs.includes('const port = "8080";'));
  assert.ok(replacedJs.includes('const fallback = undefined;'));

  const templateStr = `<div>{{ process.env.AVX_PUBLIC_API_URL }}</div>`;
  const replacedTemplate = replaceEnvVariables(templateStr);
  assert.strictEqual(replacedTemplate, `<div>{{ "https://api.example.com" }}</div>`);

  // Clean up
  delete process.env.AVX_PUBLIC_API_URL;
  delete process.env.AVX_PUBLIC_PORT;

  console.log('✅ replaceEnvVariables tests passed!');

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
  const entryId = compiler.buildEntryModule(virtualModules, []);
  const processedMain = virtualModules.get(entryId);
  assert.ok(processedMain.includes('const secret = "success_injection";'));

  // Clean up
  fs.rmSync(compilerTestDir, { recursive: true, force: true });
  delete process.env.AVX_PUBLIC_COMPILER_INJECT;

  console.log('✅ Compiler environment integration tests passed!');
} catch (err) {
  console.error('❌ Environment variables tests failed:');
  console.error(err);
  process.exit(1);
}
