import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const files = [
  'index.html',
  '.vscode/jsconfig.json',
  '.vscode/avenx.html-data.json',
  '.vscode/settings.json',
  '.prettierrc',
  '.gitignore',
];

/** @param {string} cwd @param {string[]} args @returns {object} CLI result. */
function run(cwd, args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
}

/** @param {Function} check @returns {void} Runs an isolated scaffolded project. */
function project(check) {
  const cwd = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-doctor-fix-'));
  try {
    const init = run(cwd, ['init', '--yes']);
    assert.equal(init.status, 0, init.stdout + init.stderr);
    assert.equal(spawnSync('git', ['init', '--quiet'], { cwd }).status, 0);
    check(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

for (const missing of files) {
  project((cwd) => {
    const original = new Map(files.map((name) => [name, fs.readFileSync(path.join(cwd, name))]));
    fs.unlinkSync(path.join(cwd, missing));
    const preview = run(cwd, ['doctor', '--fix', '--dry-run', '--json']);
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    const planned = JSON.parse(preview.stdout).repairs;
    assert.deepEqual(
      planned.map((repair) => [repair.path, repair.action, repair.status]),
      [[missing, 'create', 'planned']],
    );
    assert.ok(!fs.existsSync(path.join(cwd, missing)), 'dry run must not write');
    const repair = run(cwd, ['doctor', '--fix', '--json']);
    assert.equal(repair.status, 0, repair.stdout + repair.stderr);
    assert.equal(JSON.parse(repair.stdout).repairs[0].status, 'applied');
    for (const [name, content] of original) assert.deepEqual(fs.readFileSync(path.join(cwd, name)), content);
    const again = run(cwd, ['doctor', '--fix', '--json']);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.deepEqual(JSON.parse(again.stdout).repairs, [], 'a second run must have no repairs');
  });
}

project((cwd) => {
  const configPath = path.join(cwd, 'avenx.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...config, distDir: 'public/assets', outputName: 'app' }));
  const html =
    '<!doctype html>\r\n<!-- <script src="dist/bundle.js"></script> -->\r\n' +
    '<script>const sample = \'<link href="dist/bundle.css">\';</script>\r\n' +
    '<link data-note="keep > this" rel="stylesheet" href=\'./dist/bundle.css?v=1#x\'>\r\n' +
    '<script defer SRC="/dist/bundle.js?v=2"></script>\r\n' +
    '<script src="https://cdn.example/dist/bundle.js"></script>\r\n<div>my content</div>';
  const htmlPath = path.join(cwd, 'index.html');
  fs.writeFileSync(htmlPath, html);
  const beforeIgnore = '# custom\r\n!.env.example\r\n';
  fs.writeFileSync(path.join(cwd, '.gitignore'), beforeIgnore);
  const custom = '{"editor.fontSize": 18}\n';
  fs.writeFileSync(path.join(cwd, '.vscode/settings.json'), custom);
  const preview = run(cwd, ['doctor', '--fix', '--dry-run']);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.match(preview.stdout, /Would update index\.html/);
  assert.equal(fs.readFileSync(htmlPath, 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8'), beforeIgnore);
  const result = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(
    fs.readFileSync(htmlPath, 'utf8'),
    html
      .replace('./dist/bundle.css?v=1#x', './public/assets/app.css?v=1#x')
      .replace('/dist/bundle.js?v=2', '/public/assets/app.js?v=2'),
  );
  assert.equal(fs.readFileSync(path.join(cwd, '.vscode/settings.json'), 'utf8'), custom);
  assert.match(
    JSON.parse(result.stdout)
      .checks.map((check) => check.message)
      .join('\n'),
    /settings\.json.*preserved/,
  );
  const ignore = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
  assert.ok(ignore.startsWith(beforeIgnore));
  assert.equal(spawnSync('git', ['check-ignore', '.env.local'], { cwd }).status, 0);
  assert.equal(spawnSync('git', ['check-ignore', '.env.example'], { cwd }).status, 1);
  const again = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(JSON.parse(again.stdout).repairs, []);
});

project((cwd) => {
  const html = '<script src="legacy/custom.js"></script><p>Keep me</p>';
  fs.writeFileSync(path.join(cwd, 'index.html'), html);
  const result = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(result.status, 1);
  assert.match(
    JSON.parse(result.stdout)
      .checks.map((check) => check.hint || '')
      .join('\n'),
    /script.*stylesheet/,
  );
  assert.equal(fs.readFileSync(path.join(cwd, 'index.html'), 'utf8'), html);
  assert.equal(run(cwd, ['doctor', '--dry-run']).status, 1);
});

project((cwd) => {
  const configPath = path.join(cwd, 'avenx.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...config, outputName: 'app', distDir: 'build' }));
  const html = '<script src="dist/bundle.js"></script><script src="./dist/bundle.js"></script>';
  fs.writeFileSync(path.join(cwd, 'index.html'), html);
  assert.equal(run(cwd, ['doctor', '--fix']).status, 1, 'ambiguous entry points require a manual edit');
  assert.equal(fs.readFileSync(path.join(cwd, 'index.html'), 'utf8'), html);
  fs.unlinkSync(path.join(cwd, 'index.html'));
  assert.equal(run(cwd, ['doctor', '--fix']).status, 0);
  const created = fs.readFileSync(path.join(cwd, 'index.html'), 'utf8');
  assert.match(created, /href="build\/app\.css"/);
  assert.match(created, /src="build\/app\.js"/);
});

project((cwd) => {
  fs.rmSync(path.join(cwd, '.vscode'), { recursive: true });
  assert.equal(run(cwd, ['doctor', '--fix', '--dry-run']).status, 0);
  assert.ok(!fs.existsSync(path.join(cwd, '.vscode')), 'preview must not even create the directory');
  assert.equal(run(cwd, ['doctor']).status, 0);
  assert.ok(!fs.existsSync(path.join(cwd, '.vscode')), 'ordinary doctor remains read-only');
  fs.writeFileSync(path.join(cwd, 'avenx.config.json'), '{broken');
  assert.equal(run(cwd, ['doctor', '--fix']).status, 1);
  assert.ok(!fs.existsSync(path.join(cwd, '.vscode')), 'invalid configuration must not produce guessed repairs');
});

project((cwd) => {
  fs.rmSync(path.join(cwd, '.git'), { recursive: true, force: true });
  const result = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(result.status, 0);
  assert.ok(!fs.existsSync(path.join(cwd, '.git')), 'doctor must not initialize Git');
  assert.match(
    JSON.parse(result.stdout)
      .checks.map((check) => check.hint || '')
      .join('\n'),
    /git init/,
  );
});

project((cwd) => {
  fs.rmSync(path.join(cwd, '.vscode'), { recursive: true });
  const outside = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-doctor-outside-'));
  try {
    fs.symlinkSync(outside, path.join(cwd, '.vscode'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = run(cwd, ['doctor', '--fix', '--json']);
    assert.equal(result.status, 1);
    assert.deepEqual(fs.readdirSync(outside), [], 'repairs must not follow a linked editor directory');
  } finally {
    fs.unlinkSync(path.join(cwd, '.vscode'));
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// $schema reference checks and repairs in avenx.config.json
project((cwd) => {
  const configPath = path.join(cwd, 'avenx.config.json');
  const schemaRel = './node_modules/avenx-core/schema/avenx.config.schema.json';

  // Fresh checkout without node_modules passes when $schema is set
  const freshResult = run(cwd, ['doctor', '--json']);
  assert.equal(freshResult.status, 0, freshResult.stdout + freshResult.stderr);
  const freshSchemaCheck = JSON.parse(freshResult.stdout).checks.find((c) => c.message.includes('$schema'));
  assert.equal(freshSchemaCheck?.status, 'pass');

  // Missing $schema warns, previews in --dry-run, and repairs while preserving keys/indentation
  const withoutSchema = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  delete withoutSchema.$schema;
  const fourSpaceConfig = JSON.stringify({ ...withoutSchema, server: { port: 4123 } }, null, 4) + '\n';
  fs.writeFileSync(configPath, fourSpaceConfig);

  const warnResult = run(cwd, ['doctor', '--json']);
  assert.equal(warnResult.status, 0);
  const missingCheck = JSON.parse(warnResult.stdout).checks.find((c) => c.message.includes('$schema'));
  assert.equal(missingCheck?.status, 'warn');
  assert.equal(missingCheck?.area, 'Project files');
  assert.match(missingCheck?.hint || '', /avenx doctor --fix/);

  const preview = run(cwd, ['doctor', '--fix', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.deepEqual(
    JSON.parse(preview.stdout).repairs.map((r) => [r.path, r.action, r.status]),
    [['avenx.config.json', 'update', 'planned']],
  );
  assert.equal(fs.readFileSync(configPath, 'utf8'), fourSpaceConfig, 'dry-run must not modify avenx.config.json');

  const fixed = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.deepEqual(
    JSON.parse(fixed.stdout).repairs.map((r) => [r.path, r.action, r.status]),
    [['avenx.config.json', 'update', 'applied']],
  );
  const repairedText = fs.readFileSync(configPath, 'utf8');
  assert.match(repairedText, /^ {4}"\$schema"/m, 'existing 4-space indentation must be preserved');
  const repairedJson = JSON.parse(repairedText);
  assert.equal(repairedJson.$schema, schemaRel);
  assert.deepEqual(repairedJson.server, { port: 4123 });
  assert.deepEqual(repairedJson.style, withoutSchema.style);

  const repeat = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(repeat.status, 0);
  assert.deepEqual(JSON.parse(repeat.stdout).repairs, [], 'second run must have no repairs');

  // Stale $schema when node_modules exists warns with the stale path and is repaired by --fix
  const installedSchema = path.join(cwd, schemaRel);
  fs.mkdirSync(path.dirname(installedSchema), { recursive: true });
  fs.writeFileSync(installedSchema, '{}\n');
  fs.writeFileSync(
    configPath,
    JSON.stringify({ ...repairedJson, $schema: './node_modules/stale-pkg/missing.json' }, null, 2) + '\n',
  );

  const staleResult = run(cwd, ['doctor', '--json']);
  assert.equal(staleResult.status, 0);
  const staleCheck = JSON.parse(staleResult.stdout).checks.find((c) => c.message.includes('$schema'));
  assert.equal(staleCheck?.status, 'warn');
  assert.match(staleCheck?.message || '', /\.\/node_modules\/stale-pkg\/missing\.json/);

  const staleFixed = run(cwd, ['doctor', '--fix', '--json']);
  assert.equal(staleFixed.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).$schema, schemaRel);
  const afterStaleFix = run(cwd, ['doctor', '--json']);
  assert.equal(JSON.parse(afterStaleFix.stdout).checks.find((c) => c.message.includes('$schema'))?.status, 'pass');

  // Missing avenx.config.json must not emit a $schema warning
  fs.unlinkSync(configPath);
  const noConfigResult = run(cwd, ['doctor', '--json']);
  assert.equal(noConfigResult.status, 0);
  assert.equal(
    JSON.parse(noConfigResult.stdout).checks.find((c) => c.message.includes('$schema')),
    undefined,
  );
});

console.log('doctor --fix repairs, previews, preservation, and repeat runs passed.');
