import path from 'path';
import { fileURLToPath } from 'url';
import { readTemplate } from '../utils.js';
import { getInitialHtml } from './serve.js';

export const CONFIG_SCHEMA_REF = './node_modules/avenx-core/schema/avenx.config.schema.json';

export const SCAFFOLD_FILES = [
  '.vscode/jsconfig.json',
  '.vscode/avenx.html-data.json',
  '.vscode/settings.json',
  '.prettierrc',
  '.gitignore',
];

/**
 * The same application companion files are used by init and doctor.
 * @param {object} cli
 * @param {string} name
 * @returns {string} Scaffold content, including local template overrides.
 */
export function readScaffoldFile(cli, name) {
  if (name === 'index.html') return getInitialHtml(cli);
  if (name === '.gitignore') {
    const dist = (cli.config.distDir || 'dist').replace(/\\/g, '/').replace(/\/$/, '');
    return `node_modules/\n${dist}/\n.DS_Store\n.env\n.env.*\n!.env.example\n.avenx/traces/\n`;
  }
  const framework = cli.frameworkDir || fileURLToPath(new URL('../../', import.meta.url));
  const folder = name === '.prettierrc' ? 'init' : 'vscode';
  const template = name === '.prettierrc' ? name : `${path.basename(name)}.template`;
  return readTemplate(cli.baseDir, cli.config, framework, folder, template);
}
