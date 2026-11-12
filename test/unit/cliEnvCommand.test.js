import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { runEnv } from '../../bin/commands/env.js';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-env-unit-'));

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(TEST_DIR, '.env'),
    [
      'AVX_PUBLIC_API_URL=https://api.example.com',
      'AVX_PUBLIC_EMPTY=',
      'SECRET_TOKEN=supersecretvalue',
      'DB_PASSWORD=dbpass',
    ].join('\n'),
    'utf-8'
  );
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  delete process.env.AVX_PUBLIC_API_URL;
  delete process.env.AVX_PUBLIC_EMPTY;
  delete process.env.SECRET_TOKEN;
  delete process.env.DB_PASSWORD;
}

console.log('🧪 Testing bin/commands/env.js...');

try {
  setup();

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(' '));
  };

  runEnv({ baseDir: TEST_DIR });

  console.log = originalLog;
  const output = logs.join('\n');

  assert.ok(output.includes('.env'), 'should list .env source file');
  assert.ok(output.includes('AVX_PUBLIC_API_URL'), 'should list public key');
  assert.ok(output.includes('https://api.example.com'), 'should show public value unmasked');
  assert.ok(output.includes('SECRET_TOKEN'), 'should list private key');
  assert.ok(!output.includes('supersecretvalue'), 'should mask private value');
  assert.ok(output.includes('supe'), 'masked secret should keep a short prefix');

  cleanup();
  console.log('✅ cliEnvCommand tests passed!');
} catch (error) {
  console.log = console.log.bind(console);
  cleanup();
  console.error('❌ cliEnvCommand tests failed!');
  console.error(error);
  process.exit(1);
}
