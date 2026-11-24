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
 * Read the rendering options shared by Atlas and its queries.
 * @param {string[]} args - CLI arguments.
 * @returns {object} Shared format and node-kind options.
 */
function renderingOptions(args) {
  if (args.includes('--json') || args.includes('-j')) throw new UsageError('Choose --graph or --json, not both.');
  return {
    format: option(args, 'format'),
    kinds: option(args, 'kinds')
      ?.split(',')
      .map((kind) => kind.trim()),
  };
}

/**
 * Write a rendered diagram using the shared output option.
 * @param {string} graph - The diagram.
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function writeGraph(graph, args) {
  const output = option(args, 'out', '-o');
  if (output) fs.writeFileSync(path.resolve(output), graph, 'utf8');
  else process.stdout.write(graph);
}

/**
 * Write an Atlas diagram to stdout or a requested file.
 * @param {AppModel} model - The retained application model.
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
export function runAtlasGraph(model, args) {
  const options = renderingOptions(args);
  const depth = option(args, 'depth');
  const focus = option(args, 'focus');
  if (depth !== undefined && focus === undefined) throw new UsageError('--depth only applies together with --focus.');
  validateGraphOptions(model, { ...options, depth, focus });
  const graph = renderAtlasGraph(model, {
    ...options,
    focus,
    depth: depth === undefined ? undefined : Number(depth),
  });
  writeGraph(graph, args);
}

/**
 * Draw exactly the traversal used by an impact/why answer.
 * @param {AppModel} model - The full model, retained for labels and completeness reporting.
 * @param {string[]} args - CLI arguments.
 * @param {object} result - The existing query walk and its depth-limit status.
 * @param {'in'|'out'} direction - Which way the query follows dependencies.
 * @returns {void}
 */
export function runQueryGraph(model, args, result, direction) {
  const options = renderingOptions(args);
  const depth = option(args, 'depth');
  if (option(args, 'focus') !== undefined) throw new UsageError('impact and why already focus on the queried symbol.');
  validateGraphOptions(model, { ...options, depth });
  writeGraph(
    renderAtlasGraph(model, {
      ...options,
      kinds: options.kinds ?? Object.values(AtlasNodeKind),
      traversal: result.root,
      direction,
      truncated: result.truncated,
    }),
    args,
  );
}
