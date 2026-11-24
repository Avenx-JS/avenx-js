import fs from 'node:fs';
import path from 'node:path';
import { AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { ATLAS_GRAPH_FORMATS, atlasKindAliases, renderAtlasGraph } from '../../lib/compiler/atlas/graph.js';
import { resolveSymbol } from '../../lib/compiler/atlas/query.js';
import { cyan } from '../colors.js';
import { UsageError } from '../fatal.js';

/**
 * Read a graph option in either --name=value or --name value form.
 * @param {string[]} args - CLI arguments.
 * @param {string} name - The long option name, without dashes.
 * @param {string} [alias] - An optional short flag, such as -o.
 * @returns {string|undefined} Its value when present.
 */
function option(args, name, alias) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  const index = args.findIndex((arg) => arg === `--${name}` || (alias !== undefined && arg === alias));
  const value = inline ? inline.slice(name.length + 3) : index < 0 ? undefined : args[index + 1];
  if ((inline || index >= 0) && (!value || value.startsWith('--'))) throw new UsageError(`--${name} requires a value.`);
  return value;
}

/**
 * Check the flag values before rendering, so a typo is reported as a usage
 * error that names the accepted values. `renderAtlasGraph` keeps its own checks
 * as internal invariants.
 * @param {AppModel} model - The retained application model.
 * @param {object} options - The raw flag values.
 * @param {string} [options.format] - `--format`.
 * @param {string[]} [options.kinds] - `--kinds`, split on commas.
 * @param {string} [options.depth] - `--depth`.
 * @param {string} [options.focus] - `--focus`.
 * @returns {void}
 */
function validateGraphOptions(model, { format, kinds, depth, focus }) {
  if (format !== undefined && !ATLAS_GRAPH_FORMATS.includes(format)) {
    throw new UsageError(`--format must be ${ATLAS_GRAPH_FORMATS.join(' or ')}, not "${format}".`);
  }
  if (kinds !== undefined) {
    const aliases = atlasKindAliases();
    const unknown = kinds.find((kind) => !aliases.has(kind));
    if (unknown !== undefined) {
      throw new UsageError(
        `Unknown Atlas node kind "${unknown}" in --kinds. Kinds: ${Object.values(AtlasNodeKind).join(', ')} (plural forms also work).`,
      );
    }
  }
  if (depth !== undefined && !/^\d+$/.test(depth)) {
    throw new UsageError(`--depth must be a non-negative integer, not "${depth}".`);
  }
  if (focus !== undefined) {
    const matches = resolveSymbol(model, focus);
    if (matches.length === 0) {
      throw new UsageError(`No Atlas symbol named "${focus}".`, {
        hint: `Try ${cyan('avenx atlas')} to see what the model contains.`,
      });
    }
    if (matches.length > 1) {
      throw new UsageError(`"${focus}" is ambiguous: ${matches.map((node) => node.id).join(', ')}`, {
        hint: 'Pass one of these ids to --focus.',
      });
    }
  }
}

/**
 * Write an Atlas diagram to stdout or a requested file.
 * @param {AppModel} model - The retained application model.
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
export function runAtlasGraph(model, args) {
  if (args.includes('--json') || args.includes('-j')) throw new UsageError('Choose --graph or --json, not both.');
  const kinds = option(args, 'kinds');
  const depth = option(args, 'depth');
  const focus = option(args, 'focus');
  if (depth !== undefined && focus === undefined) throw new UsageError('--depth only applies together with --focus.');
  const format = option(args, 'format');
  const kindList = kinds?.split(',').map((kind) => kind.trim());
  validateGraphOptions(model, { format, kinds: kindList, depth, focus });
  const graph = renderAtlasGraph(model, {
    format,
    kinds: kindList,
    focus,
    depth: depth === undefined ? undefined : Number(depth),
  });
  const output = option(args, 'out', '-o');
  if (output) fs.writeFileSync(path.resolve(output), graph, 'utf8');
  else process.stdout.write(graph);
}
