import fs from 'node:fs';
import path from 'node:path';
import { renderAtlasGraph } from '../../lib/compiler/atlas/graph.js';

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
  if ((inline || index >= 0) && (!value || value.startsWith('--'))) throw new Error(`--${name} requires a value.`);
  return value;
}

/**
 * Write an Atlas diagram to stdout or a requested file.
 * @param {AppModel} model - The retained application model.
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
export function runAtlasGraph(model, args) {
  if (args.includes('--json') || args.includes('-j')) throw new Error('Choose --graph or --json, not both.');
  const kinds = option(args, 'kinds');
  const depth = option(args, 'depth');
  const focus = option(args, 'focus');
  if (depth !== undefined && focus === undefined) throw new Error('--depth only applies together with --focus.');
  const graph = renderAtlasGraph(model, {
    format: option(args, 'format'),
    kinds: kinds?.split(',').map((kind) => kind.trim()),
    focus,
    depth: depth === undefined ? undefined : Number(depth),
  });
  const output = option(args, 'out', '-o');
  if (output) fs.writeFileSync(path.resolve(output), graph, 'utf8');
  else process.stdout.write(graph);
}
