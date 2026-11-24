import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readScaffoldFile } from '../../bin/commands/scaffoldFiles.js';
import { readTemplate } from '../../bin/utils.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-template-newlines-'));
const project = path.join(root, 'project');
const framework = path.join(root, 'framework');
const crlf = '{\r\n  "compilerOptions": {}\r\n}\r\n';
const lf = crlf.replace(/\r\n/g, '\n');

try {
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(framework, 'templates', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(framework, 'templates', 'vscode', 'jsconfig.json.template'), crlf);
  const cli = { baseDir: project, frameworkDir: framework, config: {} };
  assert.strictEqual(readScaffoldFile(cli, '.vscode/jsconfig.json'), lf);

  // Custom templates retain their chosen line endings.
  const overrides = path.join(project, '.avenxtemplates', 'vscode');
  fs.mkdirSync(overrides, { recursive: true });
  fs.writeFileSync(path.join(overrides, 'jsconfig.json.template'), crlf);
  assert.strictEqual(readScaffoldFile(cli, '.vscode/jsconfig.json'), crlf);
  fs.mkdirSync(path.join(overrides, 'custom'));
  fs.writeFileSync(path.join(overrides, 'custom', 'jsconfig.json.template'), crlf);
  assert.strictEqual(readTemplate(project, {}, framework, 'vscode', 'jsconfig.json.template', 'custom'), crlf);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Built-in scaffold template newlines are independent of checkout settings.');
