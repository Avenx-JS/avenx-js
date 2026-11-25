/**
 * @file configOptionsMatrix.test.js
 * @description Schema-driven system test suite for Avenx-JS configuration options (Issue #1714).
 *
 * Verifies that:
 * 1. Every configuration option in CONFIG_SCHEMA is actively consumed outside lib/config.js (Guard 1).
 * 2. Every enumerated option in CONFIG_SCHEMA has a registered test handler in the matrix registry (Guard 2).
 * 3. Asserts configuration options against real build output, emitted artifacts, diagnostics, or runtime behavior.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import loadConfig, { CONFIG_SCHEMA } from '../../lib/config.js';
import AvenxCompiler from '../../lib/compiler.js';
import { AvenxCLI } from '../../bin/cli.js';
import { serveProject } from '../../bin/commands/serve.js';
import { clearExpressionCache, getExpressionCacheStats } from '../../lib/core/expression/compile.js';
import { isDebugReactivityEnabled } from '../../lib/core/reactive/watcher.js';
import { TraceRecorder } from '../../lib/core/trace/recorder.js';
import { journal } from '../../lib/core/reactive/journal.js';
import { AvenxLogger, logger } from '../../lib/core/runtime/AvenxLogger.js';
import { clearIncrementalCache } from '../../lib/compiler/incrementalCache.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');
const httpsFixtureDir = path.join(repoRoot, 'test/fixtures/https');

/**
 * Closes the primary server, loopback aliases, and file watcher.
 * @param {object} cli
 * @param {object} server
 * @returns {Promise<void>}
 */
async function stopServer(cli, server) {
  cli._watcher?.close();
  for (const listener of [server, cli._loopbackAlias]) {
    if (!listener) continue;
    listener.closeAllConnections?.();
    await new Promise((resolve) => listener.close(resolve));
  }
}

/**
 * Sends a lightweight HTTP/HTTPS request.
 * @param {object} transport - http or https module
 * @param {object} options
 * @param {boolean} [stream] - Whether to stop after first chunk (e.g. SSE)
 * @returns {Promise<{status: number, headers: object, body: string}>}
 */
function httpRequest(transport, options, stream = false) {
  return new Promise((resolve, reject) => {
    const req = transport.get({ ...options, rejectUnauthorized: false }, (res) => {
      let body = '';
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, body });
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (stream) {
          finish();
          res.destroy();
          req.destroy();
        }
      });
      res.on('end', finish);
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
  });
}

/**
 * Dynamically acquires an ephemeral free port.
 * @returns {Promise<number>}
 */
function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * Scaffolds standard dev-server entry and html files.
 * @param {object} fixture
 */
function setupServeFixture(fixture) {
  fixture.writeFile('package.json', JSON.stringify({ name: 'matrix-serve-test', type: 'module' }));
  fixture.writeFile('index.html', '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>');
  fixture.writeFile(
    'src/main.app.js',
    "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
  );
  fixture.writeFile('server-cert.pem', fs.readFileSync(path.join(httpsFixtureDir, 'server-cert.pem'), 'utf8'));
  fixture.writeFile('server-key.pem', fs.readFileSync(path.join(httpsFixtureDir, 'server-key.pem'), 'utf8'));
}

/**
 * Starts a dev server and returns the listening server with suppressed startup console noise.
 * @param {object} cli
 * @param {number} port
 * @param {string} [host]
 * @param {boolean} [open]
 * @returns {Promise<object>}
 */
async function startDevServer(cli, port, host = 'localhost', open = false) {
  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  try {
    const server = serveProject(cli, port, host, open);
    await once(server, 'listening');
    return server;
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
  }
}

/* ---------------------------------------------------------------------------
 * 1. Schema Enumeration Helper
 * ------------------------------------------------------------------------ */

/**
 * Dynamically walks CONFIG_SCHEMA.topLevel and nested groups to produce
 * canonical dot-paths (e.g., 'srcDir', 'server.port', 'hooks.prebuild').
 * Never hardcodes schema keys.
 * @param {typeof CONFIG_SCHEMA} [schema]
 * @returns {string[]} Canonical dot-paths in schema declaration order.
 */
export function enumerateConfigKeys(schema = CONFIG_SCHEMA) {
  const canonicalPaths = [];
  const nestedGroupNames = new Set(Object.keys(schema).filter((k) => k !== 'topLevel'));

  for (const topKey of schema.topLevel) {
    if (nestedGroupNames.has(topKey)) {
      const subKeys = schema[topKey] || [];
      for (const subKey of subKeys) {
        canonicalPaths.push(`${topKey}.${subKey}`);
      }
    } else {
      canonicalPaths.push(topKey);
    }
  }

  return canonicalPaths;
}

/**
 * Returns comprehensive schema statistics and key groupings.
 * @param {typeof CONFIG_SCHEMA} [schema]
 * @returns {{
 *   topLevelCount: number,
 *   nestedGroupCount: number,
 *   nestedKeyCount: number,
 *   totalKeyCount: number,
 *   canonicalPaths: string[]
 * }}
 */
export function getSchemaStats(schema = CONFIG_SCHEMA) {
  const nestedGroupNames = Object.keys(schema).filter((k) => k !== 'topLevel');
  let nestedKeyCount = 0;
  for (const group of nestedGroupNames) {
    nestedKeyCount += (schema[group] || []).length;
  }
  const canonicalPaths = enumerateConfigKeys(schema);

  return {
    topLevelCount: schema.topLevel.length,
    nestedGroupCount: nestedGroupNames.length,
    nestedKeyCount,
    totalKeyCount: schema.topLevel.length + nestedKeyCount,
    canonicalPaths,
  };
}

/* ---------------------------------------------------------------------------
 * 2. Guard 1: Static Consumption Guard
 * ------------------------------------------------------------------------ */

/**
 * Recursively collects all JavaScript files under a directory.
 * @param {string} dir
 * @returns {string[]} Absolute file paths.
 */
function getJsFilesRecursive(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getJsFilesRecursive(fullPath));
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Strips both block comments and single-line comments from JavaScript source.
 * @param {string} code
 * @returns {string} Source code without comments.
 */
export function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Scans all JavaScript files in `lib/` and `bin/` outside of configuration/schema
 * definition files and identifies any configuration options in CONFIG_SCHEMA
 * that have no static readers.
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {typeof CONFIG_SCHEMA} [options.schema]
 * @param {string[]} [options.excludePaths]
 * @returns {string[]} Array of canonical dot-paths that have no readers.
 */
export function getUnreadConfigKeys(options = {}) {
  const root = options.rootDir || repoRoot;
  const schema = options.schema || CONFIG_SCHEMA;
  const defaultExcludes = [path.join(root, 'lib/config.js'), path.join(root, 'lib/configSchema.js')];
  const excludePaths = new Set((options.excludePaths || defaultExcludes).map((p) => path.resolve(p)));

  const searchDirs = [path.join(root, 'lib'), path.join(root, 'bin')];
  const allCandidateFiles = searchDirs.flatMap(getJsFilesRecursive);
  const targetFiles = allCandidateFiles.filter((f) => !excludePaths.has(path.resolve(f)));

  const fileContents = targetFiles.map((file) => ({
    file,
    content: stripComments(fs.readFileSync(file, 'utf8')),
  }));

  const canonicalPaths = enumerateConfigKeys(schema);
  const unread = [];

  for (const dotPath of canonicalPaths) {
    const isNested = dotPath.includes('.');
    const leafKey = isNested ? dotPath.split('.')[1] : dotPath;

    let hasReader = false;
    for (const { content } of fileContents) {
      if (content.includes(dotPath)) {
        hasReader = true;
        break;
      }
      if (leafKey.startsWith('$')) {
        if (content.includes(leafKey)) {
          hasReader = true;
          break;
        }
      } else {
        const leafWordRegex = new RegExp(`\\b${leafKey}\\b`);
        if (leafWordRegex.test(content)) {
          hasReader = true;
          break;
        }
      }
    }

    if (!hasReader) {
      unread.push(dotPath);
    }
  }

  return unread;
}

/**
 * Asserts that all CONFIG_SCHEMA options are actively consumed outside lib/config.js.
 * @param {object} [options]
 * @param {string[]} [options.allowList] - Known exceptions permitted to remain unread.
 * @throws {AssertionError} If any un-allowed key is unread.
 */
export function assertStaticConsumption(options = {}) {
  const allowList = new Set(options.allowList || []);
  const unread = getUnreadConfigKeys(options);
  const unexpectedUnread = unread.filter((key) => !allowList.has(key));

  assert.deepStrictEqual(
    unexpectedUnread,
    [],
    `Guard 1 (Static Consumption) failed. The following CONFIG_SCHEMA options have NO readers outside lib/config.js:\n  ${unexpectedUnread.join('\n  ')}`,
  );
}

/* ---------------------------------------------------------------------------
 * 3. Guard 2: Schema Completeness Guard & Matrix Registry
 * ------------------------------------------------------------------------ */

/**
 * Matrix registry mapping canonical dot-paths to test definitions.
 * @type {Map<string, { handler: Function, metadata: object }>}
 */
export const CONFIG_TEST_REGISTRY = new Map();

/**
 * Registers a test handler in the configuration matrix registry.
 * @param {string} dotPath - Canonical dot-path (e.g. 'server.port', 'alias').
 * @param {function(FixtureProject): (Promise<void>|void)} handler - Test execution function.
 * @param {object} [metadata] - Additional test metadata.
 */
export function registerConfigTest(dotPath, handler, metadata = {}) {
  if (typeof dotPath !== 'string' || dotPath.trim() === '') {
    throw new Error('Config test registration requires a non-empty dot-path string.');
  }
  if (typeof handler !== 'function') {
    throw new Error(`Config test handler for "${dotPath}" must be a function.`);
  }
  if (CONFIG_TEST_REGISTRY.has(dotPath)) {
    throw new Error(`Duplicate test registration for configuration key: "${dotPath}"`);
  }
  CONFIG_TEST_REGISTRY.set(dotPath, { handler, metadata });
}

/**
 * Asserts that the matrix registry has a 1:1 match with all enumerated CONFIG_SCHEMA keys.
 * Fails immediately if any schema key has no test handler or if any stale key exists.
 * @param {typeof CONFIG_SCHEMA} [schema]
 * @throws {AssertionError} If registry and schema are out of sync.
 */
export function assertSchemaCompleteness(schema = CONFIG_SCHEMA) {
  const enumeratedKeys = enumerateConfigKeys(schema).sort();
  const registeredKeys = Array.from(CONFIG_TEST_REGISTRY.keys()).sort();

  const missingFromRegistry = enumeratedKeys.filter((k) => !CONFIG_TEST_REGISTRY.has(k));
  const staleInRegistry = registeredKeys.filter((k) => !enumeratedKeys.includes(k));

  assert.strictEqual(
    missingFromRegistry.length,
    0,
    `Guard 2 (Schema Completeness) failed. Missing test handlers for CONFIG_SCHEMA keys:\n  ${missingFromRegistry.join('\n  ')}`,
  );
  assert.strictEqual(
    staleInRegistry.length,
    0,
    `Guard 2 (Schema Completeness) failed. Stale test handlers registered for non-existent CONFIG_SCHEMA keys:\n  ${staleInRegistry.join('\n  ')}`,
  );
  assert.deepStrictEqual(
    registeredKeys,
    enumeratedKeys,
    'Guard 2 (Schema Completeness) failed. Registry keys do not match enumerated schema keys 1:1.',
  );

  const pendingHandlers = Array.from(CONFIG_TEST_REGISTRY.entries())
    .filter(([, def]) => def.metadata.pending)
    .map(([k]) => k);
  assert.strictEqual(
    pendingHandlers.length,
    0,
    `Guard 2 (Schema Completeness) failed. Placeholder handlers remain for:\n  ${pendingHandlers.join('\n  ')}`,
  );
}

/* ---------------------------------------------------------------------------
 * 4. Fast Fixture-Project Builder Utility
 * ------------------------------------------------------------------------ */

const activeProjectDirs = new Set();

/**
 * Cleans up all tracked temporary fixture project directories.
 */
export function cleanupActiveProjects() {
  for (const dir of activeProjectDirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error on process exit
    }
  }
  activeProjectDirs.clear();
}

process.on('exit', cleanupActiveProjects);

/**
 * @typedef {object} FixtureProject
 * @property {string} root - Temporary project root directory.
 * @property {function(string, string|object): void} writeFile - Writes a file relative to root.
 * @property {function(string): string} readFile - Reads a file relative to root.
 * @property {function(string): boolean} existsFile - Checks if a relative file exists.
 * @property {function(string[]): { status: number, stdout: string, stderr: string, output: string }} runAvenx - Runs avenx CLI.
 * @property {function(object=): { js: string, css: string, compiler: AvenxCompiler }} build - Runs AvenxCompiler programmatic build.
 * @property {function(): void} cleanup - Destroys this fixture directory immediately.
 */

/**
 * Creates an isolated temporary fixture project directory populated with files
 * and symlinked to repo avenx-core.
 * @param {Record<string, string|object>} [files] - Map of relative path to file content.
 * @param {object} [options]
 * @param {string} [options.prefix]
 * @returns {FixtureProject}
 */
export function createFixtureProject(files = {}, options = {}) {
  const prefix = options.prefix || 'avenx-config-matrix-';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  activeProjectDirs.add(root);

  const writeFile = (relativePath, content) => {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(fullPath, content);
      return;
    }
    const text = typeof content === 'object' && content !== null ? JSON.stringify(content, null, 2) : String(content);
    fs.writeFileSync(fullPath, text, 'utf8');
  };

  const readFile = (relativePath) => {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  };

  const existsFile = (relativePath) => {
    return fs.existsSync(path.join(root, relativePath));
  };

  // Default package.json if not explicitly provided
  if (!Object.prototype.hasOwnProperty.call(files, 'package.json')) {
    writeFile('package.json', { name: 'test-fixture-project', type: 'module' });
  }

  // Populate fixture files
  for (const [relPath, content] of Object.entries(files)) {
    writeFile(relPath, content);
  }

  // Symlink avenx-core into node_modules
  const nodeModulesDir = path.join(root, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  const symlinkPath = path.join(nodeModulesDir, 'avenx-core');
  try {
    fs.symlinkSync(repoRoot, symlinkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    if (!fs.existsSync(symlinkPath)) {
      throw new Error(`Failed to symlink avenx-core into fixture project: ${err.message}`, { cause: err });
    }
  }

  const runAvenx = (args = []) => {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    return {
      status: result.status ?? 1,
      stdout,
      stderr,
      output: stdout + stderr,
    };
  };

  const build = (compilerOptions = {}) => {
    const compiler = new AvenxCompiler({
      rootDir: root,
      logging: { silent: true },
      ...compilerOptions,
    });
    compiler.build();
    const distDir = compiler.distDir || path.join(root, 'dist');
    const outputName = compiler.outputName || 'bundle';
    const jsPath = path.join(distDir, `${outputName}.js`);
    const cssPath = path.join(distDir, `${outputName}.css`);
    return {
      js: fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '',
      css: fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '',
      compiler,
    };
  };

  const cleanup = () => {
    if (activeProjectDirs.has(root)) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // Ignore removal error
      }
      activeProjectDirs.delete(root);
    }
  };

  return {
    root,
    writeFile,
    readFile,
    existsFile,
    runAvenx,
    build,
    cleanup,
  };
}

/**
 * Runs a test action inside an isolated fixture project, guaranteeing cleanup.
 * @template T
 * @param {Record<string, string|object>} files
 * @param {function(FixtureProject): Promise<T>|T} callback
 * @returns {Promise<T>}
 */
export async function withFixtureProject(files, callback) {
  const fixture = createFixtureProject(files);
  try {
    return await callback(fixture);
  } finally {
    fixture.cleanup();
  }
}

/* ---------------------------------------------------------------------------
 * 5. Matrix Test Registrations (Step 2: 24 Build/Compiler/Style/Hooks/CSP Options)
 * ------------------------------------------------------------------------ */

// 1. $schema
registerConfigTest(
  '$schema',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', {});
    const res1 = fixture.runAvenx(['build']);
    assert.equal(res1.status, 0, res1.output);
    const bundleNoSchema = fixture.readFile('dist/bundle.js');

    fixture.writeFile('avenx.config.json', {
      $schema: './node_modules/avenx-core/schema/avenx.config.schema.json',
    });
    const res2 = fixture.runAvenx(['build']);
    assert.equal(res2.status, 0, res2.output);
    assert.ok(
      !res2.output.includes('Unknown configuration option "$schema"'),
      '$schema must not trigger unknown-option warning',
    );
    const bundleWithSchema = fixture.readFile('dist/bundle.js');
    assert.equal(bundleWithSchema, bundleNoSchema, '$schema must be deliberately inert on build output');
  },
  { step: 2 },
);

// 2. srcDir
registerConfigTest(
  'srcDir',
  (fixture) => {
    fixture.writeFile(
      'custom_src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' }); const srcToken = 'SRC_DIR_CONFIGURED_SUCCESSFULLY';",
    );
    fixture.writeFile('avenx.config.json', { srcDir: 'custom_src' });
    const res = fixture.runAvenx(['build']);
    assert.equal(res.status, 0, res.output);
    const bundle = fixture.readFile('dist/bundle.js');
    assert.ok(bundle.includes('SRC_DIR_CONFIGURED_SUCCESSFULLY'), 'build must read from configured srcDir');
  },
  { step: 2 },
);

// 3. distDir
registerConfigTest(
  'distDir',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', { distDir: 'custom_dist' });
    const res = fixture.runAvenx(['build']);
    assert.equal(res.status, 0, res.output);
    assert.ok(fixture.existsFile('custom_dist/bundle.js'), 'artifacts must be emitted to configured distDir');
    assert.ok(!fixture.existsFile('dist/bundle.js'), 'default dist directory must not be created');
  },
  { step: 2 },
);

// 4. templatesDir
registerConfigTest(
  'templatesDir',
  (fixture) => {
    fixture.writeFile(
      'custom_templates/component/component.js.template',
      '// TEMPLATES_DIR_OVERRIDE_TOKEN\nexport default class {{PascalCaseName}} {}',
    );
    fixture.writeFile(
      'custom_templates/component/component.css.template',
      '<@css>\n.{{file}} { color: red; }\n</@css>',
    );
    fixture.writeFile('avenx.config.json', {
      templatesDir: 'custom_templates',
    });
    const res = fixture.runAvenx(['generate', 'component', 'SpecialWidget']);
    assert.equal(res.status, 0, res.output);
    const generated = fixture.readFile('src/components/special-widget/special-widget.component.js');
    assert.ok(
      generated.includes('TEMPLATES_DIR_OVERRIDE_TOKEN'),
      'scaffold generator must use configured templatesDir',
    );
  },
  { step: 2 },
);

// 5. scaffold.test
registerConfigTest(
  'scaffold.test',
  (fixture) => {
    fixture.writeFile('avenx.config.json', { scaffold: { test: true } });
    const res = fixture.runAvenx(['generate', 'component', 'TestEnabled']);
    assert.equal(res.status, 0, res.output);
    assert.ok(
      fixture.existsFile('src/components/test-enabled/test-enabled.component.test.js'),
      'scaffold.test must enable colocated component test output',
    );
  },
  { step: 2 },
);

// 6. scaffold.style
registerConfigTest(
  'scaffold.style',
  (fixture) => {
    fixture.writeFile('avenx.config.json', { scaffold: { style: false } });
    const res = fixture.runAvenx(['generate', 'component', 'StyleDisabled']);
    assert.equal(res.status, 0, res.output);
    assert.ok(
      !fixture.existsFile('src/components/style-disabled/style-disabled.component.css'),
      'scaffold.style false must suppress component stylesheet output',
    );
    const generated = fixture.readFile('src/components/style-disabled/style-disabled.component.js');
    assert.doesNotMatch(generated, /@css/, 'scaffold.style false must remove @css references');
  },
  { step: 2 },
);

// 7. scaffold.template
registerConfigTest(
  'scaffold.template',
  (fixture) => {
    fixture.writeFile(
      '.avenxtemplates/component/house/component.js.template',
      '// SCAFFOLD_TEMPLATE_MATRIX_TOKEN\n<template><p>{{PascalCaseName}}</p></template>',
    );
    fixture.writeFile('avenx.config.json', { scaffold: { template: 'house' } });
    const res = fixture.runAvenx(['generate', 'component', 'TemplateConfigured']);
    assert.equal(res.status, 0, res.output);
    const generated = fixture.readFile('src/components/template-configured/template-configured.component.js');
    assert.ok(
      generated.includes('SCAFFOLD_TEMPLATE_MATRIX_TOKEN'),
      'scaffold.template must select the configured named component template',
    );
  },
  { step: 2 },
);

// 8. mode
registerConfigTest(
  'mode',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', { mode: 'production' });
    const prodRes = fixture.runAvenx(['build']);
    assert.equal(prodRes.status, 0, prodRes.output);
    const prodJs = fixture.readFile('dist/bundle.js');

    fixture.writeFile('avenx.config.json', { mode: 'development' });
    const devRes = fixture.runAvenx(['build']);
    assert.equal(devRes.status, 0, devRes.output);
    const devJs = fixture.readFile('dist/bundle.js');

    assert.notEqual(prodJs, devJs, 'development output must differ from production output');
    assert.ok(devJs.length > prodJs.length, 'development bundle includes unminified development runtime');
  },
  { step: 2 },
);

// 6. outputName
registerConfigTest(
  'outputName',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', { outputName: 'custom_bundle' });
    const res = fixture.runAvenx(['build']);
    assert.equal(res.status, 0, res.output);
    assert.ok(fixture.existsFile('dist/custom_bundle.js'), 'dist/<outputName>.js must be emitted');
    assert.ok(fixture.existsFile('dist/custom_bundle.css'), 'dist/<outputName>.css must be emitted');
    assert.ok(!fixture.existsFile('dist/bundle.js'), 'default bundle.js must not be emitted');
  },
  { step: 2 },
);

// 7. voidTags
registerConfigTest(
  'voidTags',
  (fixture) => {
    fixture.writeFile(
      'src/components/player.component.js',
      '<div><custom-media><span>Sibling</span></div>\nexport default class Player {}',
    );
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Player from './components/player.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Player', Player);
`,
    );

    const { js } = fixture.build({
      voidTags: ['custom-media'],
    });
    assert.ok(js.length > 0, 'build must emit bundle');
    assert.ok(js.includes('custom-media'), 'custom void tag must compile cleanly into bundle');
    assert.ok(js.includes('<custom-media />'), 'custom void tag must be self-closing in emitted template');
  },
  { step: 2 },
);

// 8. templateGlobals
registerConfigTest(
  'templateGlobals',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('src/comp.component.js', '<div>{{ customT("item") }}</div>');

    const undeclaredComp = new AvenxCompiler({
      rootDir: fixture.root,
      templateGlobals: [],
      logging: { silent: true },
    });
    undeclaredComp.build();
    assert.ok(
      undeclaredComp.diagnostics.records.some((r) => r.code === 'AVX_W03'),
      'undeclared global must emit AVX_W03',
    );

    const declaredComp = new AvenxCompiler({
      rootDir: fixture.root,
      templateGlobals: ['customT'],
      logging: { silent: true },
    });
    declaredComp.build();
    assert.ok(
      !declaredComp.diagnostics.records.some((r) => r.code === 'AVX_W03'),
      'declared templateGlobals must suppress AVX_W03',
    );
  },
  { step: 2 },
);

// 9. warnings
registerConfigTest(
  'warnings',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('src/comp.component.js', '<div>{{ undeclaredIdentifier }}</div>');

    const offCompiler = new AvenxCompiler({
      rootDir: fixture.root,
      warnings: { AVX_W03: 'off' },
      logging: { silent: true },
    });
    offCompiler.build();
    assert.ok(
      !offCompiler.diagnostics.records.some((r) => r.code === 'AVX_W03'),
      'warnings off must suppress diagnostic',
    );

    assert.throws(
      () => {
        const errCompiler = new AvenxCompiler({
          rootDir: fixture.root,
          warnings: { AVX_W03: 'error' },
          logging: { silent: true },
        });
        errCompiler.build();
      },
      (err) => err.code === 'AVX_W03' || String(err).includes('AVX_W03'),
      'warnings error must fail the build',
    );
  },
  { step: 2 },
);

// 10. treeShakeComponents
registerConfigTest(
  'treeShakeComponents',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    const { js: shakenJs } = fixture.build({ treeShakeComponents: true });
    assert.ok(
      !shakenJs.includes('installTraceRecorder'),
      'unused runtime module must be pruned with treeShakeComponents true',
    );

    const { js: unshakenJs } = fixture.build({
      treeShakeComponents: false,
    });
    assert.ok(
      unshakenJs.includes('installTraceRecorder'),
      'pruning must be disabled when treeShakeComponents is false',
    );
    assert.ok(unshakenJs.length > shakenJs.length, 'unshaken bundle must be larger than shaken bundle');
  },
  { step: 2 },
);

// 11. codeSplitting
registerConfigTest(
  'codeSplitting',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('src/pages/home.page.js', '<div>Home Page Route Content</div>');

    fixture.build({ codeSplitting: false });
    assert.ok(!fixture.existsFile('dist/pages'), 'dist/pages must not exist when codeSplitting is false');

    try {
      fs.rmSync(path.join(fixture.root, 'dist'), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore
    }

    fixture.build({ codeSplitting: true });
    assert.ok(
      fixture.existsFile('dist/pages/home.page.js'),
      'separate page chunk must emit under dist/pages/ when codeSplitting is true',
    );
  },
  { step: 2 },
);

// 12. preprocessors
registerConfigTest(
  'preprocessors',
  (fixture) => {
    fixture.writeFile('src/components/banner.component.js', '<div>RAW_BANNER_SOURCE</div>');
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Banner from './components/banner.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Banner', Banner);
`,
    );

    const { js } = fixture.build({
      preprocessors: {
        template: (src) => src.replaceAll('RAW_BANNER_SOURCE', 'TRANSFORMED_BANNER_OUTPUT'),
      },
    });

    assert.ok(js.includes('TRANSFORMED_BANNER_OUTPUT'), 'preprocessor output must appear in emitted bundle');
    assert.ok(!js.includes('RAW_BANNER_SOURCE'), 'raw template source must be transformed');
  },
  { step: 2 },
);

// 13. alias
registerConfigTest(
  'alias',
  (fixture) => {
    fixture.writeFile('src/shared/util.js', "export const message = 'ALIASED_MODULE_RESOLVED_OK';");
    fixture.writeFile(
      'src/main.app.js',
      "import { message } from '@/shared/util.js'; import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', { alias: { '@': 'src' } });

    const res = fixture.runAvenx(['build']);
    assert.equal(res.status, 0, res.output);
    const bundle = fixture.readFile('dist/bundle.js');
    assert.ok(bundle.includes('ALIASED_MODULE_RESOLVED_OK'), 'aliased import must resolve into emitted bundle.js');
  },
  { step: 2 },
);

// 14. expressionCacheCapacity
registerConfigTest(
  'expressionCacheCapacity',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('src/comp.component.js', '<div>{{ exprA }} {{ exprB }} {{ exprC }} {{ exprD }}</div>');

    clearExpressionCache();
    fixture.build({ expressionCacheCapacity: 2 });
    const stats2 = getExpressionCacheStats();
    assert.equal(stats2.size, 2, 'LRU cache size must be bounded by configured capacity of 2');

    clearExpressionCache();
    fixture.build({ expressionCacheCapacity: 50 });
    const stats50 = getExpressionCacheStats();
    assert.equal(stats50.size, 4, 'larger capacity must retain all 4 compiled expressions');
  },
  { step: 2 },
);

// 15. sourceMap
registerConfigTest(
  'sourceMap',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    fixture.build({ sourceMap: false });
    assert.ok(!fixture.existsFile('dist/bundle.js.map'), 'bundle.js.map must not exist when sourceMap is false');

    try {
      fs.rmSync(path.join(fixture.root, 'dist'), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore
    }

    fixture.build({ sourceMap: true });
    assert.ok(fixture.existsFile('dist/bundle.js.map'), 'bundle.js.map must be generated when sourceMap is true');
  },
  { step: 2 },
);

// 16. sourcesContent
registerConfigTest(
  'sourcesContent',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    fixture.build({ sourceMap: true, sourcesContent: true });
    const mapWithSources = JSON.parse(fixture.readFile('dist/bundle.js.map'));
    assert.ok(
      Array.isArray(mapWithSources.sourcesContent) && mapWithSources.sourcesContent.length > 0,
      'sourcesContent must be present when configured true',
    );

    try {
      fs.rmSync(path.join(fixture.root, 'dist'), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore
    }

    fixture.build({ sourceMap: true, sourcesContent: false });
    const mapWithoutSources = JSON.parse(fixture.readFile('dist/bundle.js.map'));
    assert.equal(mapWithoutSources.sourcesContent, undefined, 'sourcesContent must be omitted when configured false');
  },
  { step: 2 },
);

// 17. style.preprocessor
registerConfigTest(
  'style.preprocessor',
  (fixture) => {
    fixture.writeFile('src/components/card.component.js', '<div>Card</div>');
    fixture.writeFile(
      'src/components/card.component.css',
      '<@global>\nbody { margin: 0; }\n</@global>\n<@css>\ncard { color: blue; }\n</@css>',
    );
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Card from './components/card.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Card', Card);
app.mount('Card');
`,
    );

    const cNone = new AvenxCompiler({
      rootDir: fixture.root,
      style: { preprocessor: 'none' },
      logging: { silent: true },
    });
    cNone.build();
    assert.ok(
      !cNone.diagnostics.records.some((r) => r.code === 'AVX_W24'),
      'style.preprocessor none must not emit missing preprocessor diagnostic',
    );

    const cScss = new AvenxCompiler({
      rootDir: fixture.root,
      style: { preprocessor: 'scss' },
      logging: { silent: true },
    });
    cScss.build();
    assert.ok(
      cScss.diagnostics.records.some((r) => r.code === 'AVX_W24'),
      'uninstalled scss preprocessor must raise AVX_W24 diagnostic',
    );
  },
  { step: 2 },
);

// 18. style.sourceMap
registerConfigTest(
  'style.sourceMap',
  (fixture) => {
    fixture.writeFile('src/components/nav.component.js', '<div>Nav</div>');
    fixture.writeFile('src/components/nav.component.css', '<@css>\nnav { color: green; }\n</@css>');
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Nav from './components/nav.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Nav', Nav);
app.mount('Nav');
`,
    );

    const { css: inlineCss } = fixture.build({
      mode: 'production',
      style: { sourceMap: 'inline' },
    });
    assert.ok(
      inlineCss.includes('data:application/json;charset=utf-8;base64,'),
      'bundle.css must embed inline data URI map when style.sourceMap is "inline"',
    );
    assert.ok(
      !inlineCss.includes('/*# sourceMappingURL=bundle.css.map */'),
      'bundle.css must not reference external map comment when style.sourceMap is "inline"',
    );

    const { css: defaultCss } = fixture.build({
      mode: 'production',
      style: { sourceMap: false },
    });
    assert.ok(
      defaultCss.includes('/*# sourceMappingURL=bundle.css.map */'),
      'bundle.css must reference external map comment when style.sourceMap is false in production',
    );
    assert.ok(
      !defaultCss.includes('data:application/json;charset=utf-8;base64,'),
      'bundle.css must not embed inline base64 map when style.sourceMap is false',
    );
  },
  { step: 2 },
);

// 19. style.inlineSourceMap
registerConfigTest(
  'style.inlineSourceMap',
  (fixture) => {
    fixture.writeFile('src/components/item.component.js', '<div>Item</div>');
    fixture.writeFile('src/components/item.component.css', '<@css>\nitem { display: block; }\n</@css>');
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Item from './components/item.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Item', Item);
app.mount('Item');
`,
    );

    const { css: inlineCss } = fixture.build({
      style: { inlineSourceMap: true },
    });
    assert.ok(
      inlineCss.includes('data:application/json;charset=utf-8;base64,'),
      'bundle.css must contain inlined base64 data URI map comment',
    );

    const { css: noInlineCss } = fixture.build({
      style: { inlineSourceMap: false, dev: false },
    });
    assert.ok(
      !noInlineCss.includes('data:application/json;charset=utf-8;base64,'),
      'bundle.css must not contain base64 map when inlineSourceMap is false',
    );
  },
  { step: 2 },
);

// 20. style.dev
registerConfigTest(
  'style.dev',
  (fixture) => {
    fixture.writeFile('src/components/box.component.js', '<div>Box</div>');
    fixture.writeFile('src/components/box.component.css', '<@css>\nbox { padding: 10px; }\n</@css>');
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Box from './components/box.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Box', Box);
app.mount('Box');
`,
    );

    const { css: devCss } = fixture.build({ style: { dev: true } });
    const { css: prodCss } = fixture.build({ style: { dev: false } });
    assert.notEqual(devCss, prodCss, 'style.dev true must produce distinct output from style.dev false');
  },
  { step: 2 },
);

// 21. debug.debugReactivity
registerConfigTest(
  'debug.debugReactivity',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    fixture.writeFile('avenx.config.json', {
      debug: { debugReactivity: true },
    });
    loadConfig(fixture.root);
    assert.equal(isDebugReactivityEnabled(), true, 'debugReactivity true must enable reactive tracking in runtime');

    fixture.writeFile('avenx.config.json', {
      debug: { debugReactivity: false },
    });
    loadConfig(fixture.root);
    assert.equal(isDebugReactivityEnabled(), false, 'debugReactivity false must disable reactive tracking in runtime');
  },
  { step: 2 },
);

// 22. csp.strict
registerConfigTest(
  'csp.strict',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    // With csp.strict false in development mode: bundle includes the fallback interpreter
    const { js: normalJs } = fixture.build({
      mode: 'development',
      csp: { strict: false },
    });

    // With csp.strict true in development mode: interpreter is omitted (~85KB smaller)
    const { js: strictJs } = fixture.build({
      mode: 'development',
      csp: { strict: true },
    });

    assert.ok(normalJs.length > strictJs.length, 'csp.strict true must omit the expression interpreter');
    assert.ok(normalJs.length - strictJs.length > 50000, 'interpreter omission must reduce bundle size by > 50KB');
  },
  { step: 2 },
);

// 23. hooks.prebuild
registerConfigTest(
  'hooks.prebuild',
  (fixture) => {
    const preFile = path.join(fixture.root, 'prebuild_done.txt').replace(/\\/g, '/');
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', {
      hooks: {
        prebuild: `node -e "require('fs').writeFileSync('${preFile}', 'PRE_OK', 'utf8')"`,
      },
    });

    const res = fixture.runAvenx(['build']);
    assert.equal(res.status, 0, res.output);
    assert.equal(fixture.readFile('prebuild_done.txt'), 'PRE_OK', 'prebuild hook must execute before build');

    // Failing prebuild stops the build
    fixture.writeFile('avenx.config.json', {
      hooks: {
        prebuild: 'node -e "process.exit(1)"',
      },
    });
    try {
      fs.rmSync(path.join(fixture.root, 'dist'), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore
    }
    const failRes = fixture.runAvenx(['build']);
    assert.notEqual(failRes.status, 0, 'failing prebuild hook must exit with non-zero');
    assert.ok(!fixture.existsFile('dist/bundle.js'), 'dist bundle must not be emitted when prebuild fails');
  },
  { step: 2 },
);

// 24. hooks.postbuild
registerConfigTest(
  'hooks.postbuild',
  (fixture) => {
    const postFile = path.join(fixture.root, 'postbuild_done.txt').replace(/\\/g, '/');
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    fixture.writeFile('avenx.config.json', {
      hooks: {
        postbuild: `node -e "require('fs').writeFileSync('${postFile}', 'POST_OK', 'utf8')"`,
      },
    });

    const res = fixture.runAvenx(['build']);
    assert.equal(res.status, 0, res.output);
    assert.equal(
      fixture.readFile('postbuild_done.txt'),
      'POST_OK',
      'postbuild hook must execute after successful build',
    );
  },
  { step: 2 },
);

/* ---------------------------------------------------------------------------
 * 6. Register Remaining Handlers for Step 3 (15 options: server, logging, trace, rewind, incremental)
 * ------------------------------------------------------------------------ */

// 25. server.port
registerConfigTest(
  'server.port',
  async (fixture) => {
    setupServeFixture(fixture);
    const testPort = await getEphemeralPort();
    fixture.writeFile('avenx.config.json', { server: { port: testPort } });

    // Verify CLI parsing honors server.port from config
    class PortCLI extends AvenxCLI {
      serveProject(port, host, open) {
        this.calledWith = { port, host, open };
      }
    }
    const parsingCli = new PortCLI({ baseDir: fixture.root });
    await parsingCli.run('serve', []);
    assert.strictEqual(parsingCli.calledWith.port, testPort, 'CLI serve must resolve server.port from config');

    // Verify real server listens on configured port
    const cli = new AvenxCLI({ baseDir: fixture.root });
    const server = await startDevServer(cli, testPort, '127.0.0.1');
    try {
      assert.strictEqual(server.address().port, testPort, 'dev server must listen on configured port');
      const res = await httpRequest(http, { host: '127.0.0.1', port: testPort, path: '/' });
      assert.strictEqual(res.status, 200);
    } finally {
      await stopServer(cli, server);
    }
  },
  { step: 3 },
);

// 26. server.host
registerConfigTest(
  'server.host',
  async (fixture) => {
    setupServeFixture(fixture);
    fixture.writeFile('avenx.config.json', { server: { host: '127.0.0.1' } });

    // Verify CLI parsing honors server.host from config
    class HostCLI extends AvenxCLI {
      serveProject(port, host, open) {
        this.calledWith = { port, host, open };
      }
    }
    const parsingCli = new HostCLI({ baseDir: fixture.root });
    await parsingCli.run('serve', []);
    assert.strictEqual(parsingCli.calledWith.host, '127.0.0.1', 'CLI serve must resolve server.host from config');

    // Verify real server responds on configured host
    const cli = new AvenxCLI({ baseDir: fixture.root });
    const server = await startDevServer(cli, 0, cli.config.server?.host || '127.0.0.1');
    try {
      const activePort = server.address().port;
      const res = await httpRequest(http, { host: '127.0.0.1', port: activePort, path: '/' });
      assert.strictEqual(res.status, 200);
    } finally {
      await stopServer(cli, server);
    }
  },
  { step: 3 },
);

// 27. server.https
registerConfigTest(
  'server.https',
  async (fixture) => {
    setupServeFixture(fixture);

    // Default: HTTP server
    const httpCli = new AvenxCLI({ baseDir: fixture.root });
    const httpServer = await startDevServer(httpCli, 0, '127.0.0.1');
    try {
      assert.ok(
        httpServer instanceof http.Server && !(httpServer instanceof https.Server),
        'server must default to HTTP',
      );
    } finally {
      await stopServer(httpCli, httpServer);
    }

    // Configured: HTTPS server
    fixture.writeFile('avenx.config.json', {
      server: {
        https: true,
        cert: './server-cert.pem',
        key: './server-key.pem',
      },
    });
    const httpsCli = new AvenxCLI({ baseDir: fixture.root });
    const httpsServer = await startDevServer(httpsCli, 0, '127.0.0.1');
    try {
      assert.ok(httpsServer instanceof https.Server, 'server must be https.Server when server.https is true');
      const activePort = httpsServer.address().port;
      const res = await httpRequest(https, { host: '127.0.0.1', port: activePort, path: '/' });
      assert.strictEqual(res.status, 200);
    } finally {
      await stopServer(httpsCli, httpsServer);
    }
  },
  { step: 3 },
);

// 28. server.cert
registerConfigTest(
  'server.cert',
  async (fixture) => {
    setupServeFixture(fixture);

    // Missing cert throws UsageError
    fixture.writeFile('avenx.config.json', {
      server: {
        https: true,
        cert: './non-existent-cert.pem',
        key: './server-key.pem',
      },
    });
    const cliMissing = new AvenxCLI({ baseDir: fixture.root });
    assert.throws(() => serveProject(cliMissing, 0, '127.0.0.1'), /Cannot load HTTPS certificate\/key/);

    // Valid cert loads cleanly
    fixture.writeFile('avenx.config.json', {
      server: {
        https: true,
        cert: './server-cert.pem',
        key: './server-key.pem',
      },
    });
    const cliValid = new AvenxCLI({ baseDir: fixture.root });
    const server = await startDevServer(cliValid, 0, '127.0.0.1');
    try {
      assert.ok(server.listening, 'server must listen successfully with valid cert');
    } finally {
      await stopServer(cliValid, server);
    }
  },
  { step: 3 },
);

// 29. server.key
registerConfigTest(
  'server.key',
  async (fixture) => {
    setupServeFixture(fixture);

    // Missing key throws UsageError
    fixture.writeFile('avenx.config.json', {
      server: {
        https: true,
        cert: './server-cert.pem',
        key: './non-existent-key.pem',
      },
    });
    const cliMissing = new AvenxCLI({ baseDir: fixture.root });
    assert.throws(() => serveProject(cliMissing, 0, '127.0.0.1'), /Cannot load HTTPS certificate\/key/);

    // Valid key loads cleanly
    fixture.writeFile('avenx.config.json', {
      server: {
        https: true,
        cert: './server-cert.pem',
        key: './server-key.pem',
      },
    });
    const cliValid = new AvenxCLI({ baseDir: fixture.root });
    const server = await startDevServer(cliValid, 0, '127.0.0.1');
    try {
      assert.ok(server.listening, 'server must listen successfully with valid key');
    } finally {
      await stopServer(cliValid, server);
    }
  },
  { step: 3 },
);

// 30. server.liveReload
registerConfigTest(
  'server.liveReload',
  async (fixture) => {
    setupServeFixture(fixture);

    // Default true: injected client script and live-reload SSE endpoint active
    const cliTrue = new AvenxCLI({ baseDir: fixture.root });
    const srvTrue = await startDevServer(cliTrue, 0, '127.0.0.1');
    try {
      const port = srvTrue.address().port;
      const page = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.ok(page.body.includes('__avenx_live_reload__'), 'page must include live-reload client script');
      const sse = await httpRequest(http, { host: '127.0.0.1', port, path: '/__avenx_live_reload__' }, true);
      assert.strictEqual(sse.headers['content-type'], 'text/event-stream');
    } finally {
      await stopServer(cliTrue, srvTrue);
    }

    // Configured false: live-reload suppressed and SSE endpoint returns 404
    fixture.writeFile('avenx.config.json', { server: { liveReload: false } });
    const cliFalse = new AvenxCLI({ baseDir: fixture.root });
    const srvFalse = await startDevServer(cliFalse, 0, '127.0.0.1');
    try {
      const port = srvFalse.address().port;
      const page = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.ok(!page.body.includes('__avenx_live_reload__'), 'page must not include live-reload script when disabled');
      const sse = await httpRequest(http, { host: '127.0.0.1', port, path: '/__avenx_live_reload__' });
      assert.notEqual(
        sse.headers['content-type'],
        'text/event-stream',
        'live-reload SSE endpoint must not mount when liveReload is false',
      );
    } finally {
      await stopServer(cliFalse, srvFalse);
    }
  },
  { step: 3 },
);

// 31. server.errorOverlay
registerConfigTest(
  'server.errorOverlay',
  async (fixture) => {
    setupServeFixture(fixture);

    // Dev server with errorOverlay true (default)
    const cli = new AvenxCLI({ baseDir: fixture.root });
    const server = await startDevServer(cli, 0, '127.0.0.1');
    try {
      const port = server.address().port;
      const page = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.ok(page.body.includes('__avenx-error-overlay'), 'overlay script must be present when enabled');
    } finally {
      await stopServer(cli, server);
    }

    // Dev server with errorOverlay false
    fixture.writeFile('avenx.config.json', {
      server: { liveReload: true, errorOverlay: false },
    });
    const cliOff = new AvenxCLI({ baseDir: fixture.root });
    const serverOff = await startDevServer(cliOff, 0, '127.0.0.1');
    try {
      const port = serverOff.address().port;
      const page = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.ok(!page.body.includes('__avenx-error-overlay'), 'overlay script must be omitted when disabled');
    } finally {
      await stopServer(cliOff, serverOff);
    }

    // Build mode deliberate inertness: build bundle never carries overlay code
    const { js } = fixture.build({ server: { errorOverlay: true } });
    assert.ok(!js.includes('__avenx-error-overlay'), 'build output must never contain dev-server error overlay code');
  },
  { step: 3 },
);

// 32. server.headers
registerConfigTest(
  'server.headers',
  async (fixture) => {
    setupServeFixture(fixture);
    fixture.writeFile('avenx.config.json', {
      server: {
        headers: {
          'X-Matrix-Test': 'Active-Val',
          'X-Security-Policy': 'Strict-Dev',
        },
      },
    });

    const cli = new AvenxCLI({ baseDir: fixture.root });
    const server = await startDevServer(cli, 0, '127.0.0.1');
    try {
      const port = server.address().port;
      const res = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['x-matrix-test'], 'Active-Val');
      assert.strictEqual(res.headers['x-security-policy'], 'Strict-Dev');
    } finally {
      await stopServer(cli, server);
    }

    // Default config: custom headers absent
    fixture.writeFile('avenx.config.json', {});
    const defaultCli = new AvenxCLI({ baseDir: fixture.root });
    const defaultSrv = await startDevServer(defaultCli, 0, '127.0.0.1');
    try {
      const port = defaultSrv.address().port;
      const res = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.strictEqual(res.headers['x-matrix-test'], undefined);
    } finally {
      await stopServer(defaultCli, defaultSrv);
    }
  },
  { step: 3 },
);

// 33. logging.level
registerConfigTest(
  'logging.level',
  () => {
    const warnLogger = new AvenxLogger({ level: 'warn' });
    assert.strictEqual(warnLogger.shouldLog('debug'), false);
    assert.strictEqual(warnLogger.shouldLog('info'), false);
    assert.strictEqual(warnLogger.shouldLog('warn'), true);
    assert.strictEqual(warnLogger.shouldLog('error'), true);

    const debugLogger = new AvenxLogger({ level: 'debug' });
    assert.strictEqual(debugLogger.shouldLog('debug'), true);
    assert.strictEqual(debugLogger.shouldLog('info'), true);
  },
  { step: 3 },
);

// 34. logging.silent
registerConfigTest(
  'logging.silent',
  (fixture) => {
    const silentLogger = new AvenxLogger({ silent: true });
    assert.strictEqual(silentLogger.shouldLog('info'), false);
    assert.strictEqual(silentLogger.shouldLog('warn'), false);
    assert.strictEqual(silentLogger.shouldLog('error'), false);
    assert.strictEqual(silentLogger.shouldLog('fatal'), false);

    const activeLogger = new AvenxLogger({ silent: false });
    assert.strictEqual(activeLogger.shouldLog('info'), true);
    assert.strictEqual(activeLogger.shouldLog('error'), true);

    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );
    new AvenxCompiler({
      rootDir: fixture.root,
      logging: { silent: true },
    });
    assert.strictEqual(logger.config.silent, true);

    new AvenxCompiler({
      rootDir: fixture.root,
      logging: { silent: false },
    });
    assert.strictEqual(logger.config.silent, false);
  },
  { step: 3 },
);

// 35. trace.redact
registerConfigTest(
  'trace.redact',
  async (fixture) => {
    setupServeFixture(fixture);

    // 1. Runtime TraceRecorder redaction
    const recorder = new TraceRecorder({ redact: ['user.secret', 'auth.token'] });
    recorder.arm();
    const captured = recorder.capture('top-secret', 'user.secret');
    recorder.push('write', { path: 'user.secret', val: captured }, null);
    const trace = recorder.toJSON();
    assert.deepStrictEqual(trace.redactions, ['user.secret', 'auth.token']);
    assert.strictEqual(trace.redacted, true);
    assert.ok(!JSON.stringify(trace).includes('top-secret'));

    // 2. Dev-server --trace script injection honors config
    fixture.writeFile('avenx.config.json', {
      trace: { redact: ['user.secret'] },
    });
    const cli = new AvenxCLI({ baseDir: fixture.root });
    cli.traceEnabled = true;
    const srv = await startDevServer(cli, 0, '127.0.0.1');
    try {
      const port = srv.address().port;
      const page = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.ok(
        page.body.includes('"redact":["user.secret"]'),
        'dev-server trace script must include configured redactions',
      );
    } finally {
      await stopServer(cli, srv);
    }
  },
  { step: 3 },
);

// 36. trace.maxNodes
registerConfigTest(
  'trace.maxNodes',
  async (fixture) => {
    setupServeFixture(fixture);

    // 1. Runtime TraceRecorder ring-buffer capacity limit
    const recorder = new TraceRecorder({ maxNodes: 5 });
    recorder.arm();
    for (let i = 0; i < 15; i++) {
      recorder.push('action', { name: `act_${i}` }, null);
    }
    assert.ok(recorder.nodes.length <= 5, 'ring buffer length must not exceed maxNodes');
    assert.ok(recorder.dropped > 0, 'dropped nodes must be recorded when buffer wraps');

    const defaultRecorder = new TraceRecorder();
    defaultRecorder.arm();
    for (let i = 0; i < 15; i++) {
      defaultRecorder.push('action', { name: `act_${i}` }, null);
    }
    assert.strictEqual(defaultRecorder.nodes.length, 15, 'default recorder must not drop 15 nodes');

    // 2. Dev-server --trace script injection honors config
    fixture.writeFile('avenx.config.json', {
      trace: { maxNodes: 250 },
    });
    const cli = new AvenxCLI({ baseDir: fixture.root });
    cli.traceEnabled = true;
    const srv = await startDevServer(cli, 0, '127.0.0.1');
    try {
      const port = srv.address().port;
      const page = await httpRequest(http, { host: '127.0.0.1', port, path: '/' });
      assert.ok(page.body.includes('"maxNodes":250'), 'dev-server trace script must include configured maxNodes');
    } finally {
      await stopServer(cli, srv);
    }
  },
  { step: 3 },
);

// 37. rewind.onConflict
registerConfigTest(
  'rewind.onConflict',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    // Build bundle configures onConflict
    const { js: abortJs } = fixture.build({
      rewind: { onConflict: 'abort' },
    });
    assert.ok(
      abortJs.includes('journal.configure({"onConflict":"abort"})'),
      'bundle must configure rewind onConflict abort when configured',
    );

    // Default safe does not inject redundant configure
    const { js: safeJs } = fixture.build({
      rewind: { onConflict: 'safe' },
    });
    assert.ok(!safeJs.includes('journal.configure'), 'default onConflict safe must not emit redundant configure');

    // Runtime journal configuration check
    journal.configure({ onConflict: 'abort' });
    assert.strictEqual(journal.defaults.onConflict, 'abort');
    journal.configure({ onConflict: 'safe' });
    assert.strictEqual(journal.defaults.onConflict, 'safe');
  },
  { step: 3 },
);

// 38. rewind.maxSnapshotItems
registerConfigTest(
  'rewind.maxSnapshotItems',
  (fixture) => {
    fixture.writeFile(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime'; const app = new AvenxApp({ target: '#app' });",
    );

    // Build bundle configures maxSnapshotItems
    const { js: limitJs } = fixture.build({
      rewind: { maxSnapshotItems: 250 },
    });
    assert.ok(
      limitJs.includes('journal.configure({"maxSnapshotItems":250})'),
      'bundle must configure maxSnapshotItems when configured',
    );

    // Default 10000 does not inject redundant configure
    const { js: defaultJs } = fixture.build({
      rewind: { maxSnapshotItems: 10000 },
    });
    assert.ok(
      !defaultJs.includes('journal.configure'),
      'default maxSnapshotItems 10000 must not emit redundant configure',
    );

    // Runtime journal configuration check
    journal.configure({ maxSnapshotItems: 250 });
    assert.strictEqual(journal.defaults.maxSnapshotItems, 250);
    journal.configure({ maxSnapshotItems: 10000 });
    assert.strictEqual(journal.defaults.maxSnapshotItems, 10000);
  },
  { step: 3 },
);

// 39. incremental
registerConfigTest(
  'incremental',
  (fixture) => {
    // 1. Incremental Rebuild Parity
    fixture.writeFile('src/components/item.component.js', '<div>Item Initial</div>');
    fixture.writeFile(
      'src/main.app.js',
      `import { AvenxApp } from 'avenx-core/runtime';
import Item from './components/item.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Item', Item);
app.mount('Item');
`,
    );

    clearIncrementalCache();
    clearAtlasCache();

    // Cold watch build seeds cache
    const { compiler: coldWatchComp } = fixture.build({
      incremental: true,
      watch: true,
    });
    assert.strictEqual(coldWatchComp.incremental, true);

    // Edit component file
    fixture.writeFile('src/components/item.component.js', '<div>Item Edited</div>');

    // Incremental rebuild reusing unchanged units
    const { js: incrementalJs, css: incrementalCss } = fixture.build({
      incremental: true,
      watch: true,
    });

    // Fresh cold build of the exact same edited sources
    clearIncrementalCache();
    clearAtlasCache();
    const { js: freshColdJs, css: freshColdCss } = fixture.build({
      incremental: true,
      watch: false,
    });

    assert.strictEqual(
      incrementalJs,
      freshColdJs,
      'incremental rebuild output must be byte-identical to a fresh cold build',
    );
    assert.strictEqual(
      incrementalCss,
      freshColdCss,
      'incremental rebuild CSS must be byte-identical to a fresh cold build',
    );

    // 2. Deliberate inertness in build mode (watch: false)
    const { js: builtWithIncTrue, compiler: compIncTrue } = fixture.build({
      incremental: true,
      watch: false,
    });
    assert.strictEqual(compIncTrue.incremental, false, 'compiler.incremental must be false when watch is false');

    const { js: builtWithIncFalse, compiler: compIncFalse } = fixture.build({
      incremental: false,
      watch: false,
    });
    assert.strictEqual(compIncFalse.incremental, false, 'compiler.incremental must be false when incremental is false');

    assert.strictEqual(
      builtWithIncTrue,
      builtWithIncFalse,
      'build output with incremental: true must be byte-identical to incremental: false in build mode',
    );
  },
  { step: 3 },
);

/* ---------------------------------------------------------------------------
 * 7. Test Suite Execution
 * ------------------------------------------------------------------------ */

console.log('🧪 Issue #1714: Config Options Matrix Test Suite (Step 3 Full Execution)...');

// Test 1: Dynamic Schema Enumeration & Guard 2 (Schema Completeness)
{
  const stats = getSchemaStats();
  assertSchemaCompleteness();
  console.log(
    `  ✅ Guard 2: 1:1 bidirectional completeness verified for all ${stats.canonicalPaths.length} options across ${stats.topLevelCount} top-level entries and ${stats.nestedGroupCount} nested groups (0 placeholders).`,
  );
}

// Test 2: Guard 1 (Static Consumption Scan — ZERO allowlist entries)
{
  assertStaticConsumption({ allowList: [] });
  console.log('  ✅ Guard 1: Static consumption check passed with 0 unread keys across lib/ and bin/.');
}

// Test 3: Run Matrix Tests for all 39 options
{
  const allEntries = Array.from(CONFIG_TEST_REGISTRY.entries());
  console.log(`  🏃 Running all ${allEntries.length} matrix tests against real build output/server/runtime...`);

  const startTime = Date.now();
  for (const [dotPath, def] of allEntries) {
    const itemStart = Date.now();
    await withFixtureProject({}, async (fixture) => {
      await def.handler(fixture);
    });
    const elapsedItem = Date.now() - itemStart;
    console.log(`    ✅ [${dotPath}] verified (${elapsedItem}ms)`);
  }
  const totalDuration = Date.now() - startTime;
  console.log(`  🎉 All ${allEntries.length} configuration options verified in ${totalDuration}ms.`);
}

console.log('🧪 Step 3 Matrix Tests & Guards completed successfully.');
