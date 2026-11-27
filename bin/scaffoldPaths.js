import path from 'node:path';
import { parseName } from './utils.js';

/** @typedef {'component'|'page'|'bridge'|'guard'} ScaffoldKind */

/** @type {ReadonlyArray<ScaffoldKind>} */
export const SCAFFOLD_KINDS = Object.freeze(['component', 'page', 'bridge', 'guard']);

/**
 * Describes scaffold paths without checking or changing the filesystem.
 * @param {{baseDir: string, config: {srcDir: string}}} cli - Project paths.
 * @param {ScaffoldKind} kind - Scaffold kind.
 * @param {string} name - Name accepted by generate and destroy.
 * @returns {{kind: ScaffoldKind, capitalizedName: string, lowerName: string, directory: string, sourcePath: string, testPath: string}} Paths and normalized names.
 */
export function getScaffoldPaths(cli, kind, name) {
  const { capitalizedName, folderFileName: lowerName } = parseName(name);
  /** @type {Record<ScaffoldKind, string>} */
  const folders = { component: 'components', page: 'pages', bridge: 'global', guard: 'guards' };
  const directory = path.join(cli.baseDir, cli.config.srcDir, folders[kind], kind === 'component' ? lowerName : '');
  const stem = path.join(directory, `${lowerName}.${kind}`);
  return { kind, capitalizedName, lowerName, directory, sourcePath: `${stem}.js`, testPath: `${stem}.test.js` };
}
