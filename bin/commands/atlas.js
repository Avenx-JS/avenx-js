import AvenxCompiler from '../../lib/compiler.js';
import { AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { buildAtlas } from '../../lib/compiler/atlas/emit.js';
import {
  displayName,
  flatten,
  locationOf,
  relevantUnresolved,
  resolveSymbol,
  walk,
} from '../../lib/compiler/atlas/query.js';
import { bold, cyan, gray, green, yellow } from '../colors.js';

/**
 * Builds the application model, keeping compiler chatter out of query output.
 *
 * A query is a question about the code, not a build, so the progress lines the
 * compiler normally prints would be noise around the answer. Warnings and
 * errors still reach the terminal.
 * @param {object} cli - The AvenxCLI instance.
 * @returns {AppModel} The model.
 */
export function buildModel(cli) {
  const compiler = new AvenxCompiler({
    ...cli.config,
    // The CLI resolved the project root already; without passing it on, the
    // compiler would re-resolve it from process.cwd() and analyse a different
    // project than the one the command was aimed at.
    ...(cli.baseDir ? { rootDir: cli.baseDir } : {}),
    logging: { ...cli.config.logging, level: 'warn' },
  });
  return compiler.analyze();
}

/**
 * Whether the caller asked for machine-readable output.
 * @param {string[]} args - CLI arguments.
 * @returns {boolean} True for JSON.
 */
function wantsJson(args) {
  return args.includes('--json') || args.includes('-j');
}

/**
 * Reads a numeric flag such as `--depth=4` or `--depth 4`.
 * @param {string[]} args - CLI arguments.
 * @param {string} name - The flag name, without dashes.
 * @param {number} fallback - The value to use when absent.
 * @returns {number} The parsed value.
 */
function numericFlag(args, name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) {
    const value = Number(inline.split('=')[1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) {
    const value = Number(args[index + 1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  return fallback;
}

/**
 * The first positional argument, ignoring flags and their values.
 * @param {string[]} args - CLI arguments.
 * @returns {string|null} The symbol, or null.
 */
function positional(args) {
  const skip = new Set();
  args.forEach((arg, index) => {
    if ((arg === '--depth' || arg === '-d') && args[index + 1]) skip.add(index + 1);
  });
  const found = args.find((arg, index) => !arg.startsWith('-') && !skip.has(index));
  return found || null;
}

/**
 * Prints the candidates for an ambiguous or unknown symbol.
 *
 * Guessing would be worse than asking: `impact items` on a project with three
 * of them should say which three, not silently pick one.
 * @param {object} model - The model.
 * @param {string} query - What was typed.
 * @param {object[]} matches - The candidates.
 * @returns {void}
 */
function reportAmbiguous(model, query, matches) {
  if (matches.length === 0) {
    console.error(`❌ No symbol named "${query}" in the Atlas.`);
    console.error(`\nTry ${cyan('avenx atlas')} to see what the model contains.`);
    return;
  }
  console.error(`❌ "${query}" is ambiguous. Did you mean:`);
  for (const node of matches) {
    console.error(`   ${node.id}${locationOf(node) ? gray(`  ${locationOf(node)}`) : ''}`);
  }
}

/**
 * Colours an edge kind so reads and writes are distinguishable at a glance.
 * @param {string} kind - The edge kind.
 * @returns {string} The rendered label.
 */
function edgeLabel(kind) {
  if (kind === 'writes') return yellow(kind);
  if (kind === 'invokes') return green(kind);
  return cyan(kind);
}

/**
 * Renders a traversal as an indented tree.
 * @param {object} model - The model.
 * @param {object} entry - A tree entry from `walk`.
 * @param {string} prefix - The accumulated indent.
 * @returns {void}
 */
function printTree(model, entry, prefix = '') {
  entry.children.forEach((child, index) => {
    const isLast = index === entry.children.length - 1;
    const branch = isLast ? '└─ ' : '├─ ';
    const nextPrefix = prefix + (isLast ? '   ' : '│  ');

    const parts = [edgeLabel(child.edge.kind), displayName(model, child.node)];
    if (child.edge.path) parts.push(gray(`.${child.edge.path}`));
    if (child.edge.confidence !== 'certain') parts.push(yellow(`[${child.edge.confidence}]`));

    const where = locationOf(child.node) || (child.edge.loc ? `${child.edge.loc.file}:${child.edge.loc.line}` : '');
    console.log(`${prefix}${branch}${parts.join(' ')}${where ? gray(`  ${where}`) : ''}`);
    printTree(model, child, nextPrefix);
  });
}

/**
 * Prints the unresolved entries that bear on a query's answer.
 *
 * Always printed, even when empty, because "0 unresolved" is the part of the
 * answer that says how much of it to trust.
 * @param {object[]} entries - Relevant unresolved entries.
 * @returns {void}
 */
function printUnresolved(entries) {
  if (entries.length === 0) {
    console.log(`\n${gray('0 unresolved relationships in this answer.')}`);
    return;
  }
  console.log(`\n${yellow(`${entries.length} unresolved relationship${entries.length === 1 ? '' : 's'}`)} — this answer may be incomplete:`);
  for (const entry of entries) {
    const where = entry.loc ? gray(`  ${entry.loc.file}${entry.loc.line ? `:${entry.loc.line}` : ''}`) : '';
    console.log(`  ? ${entry.reason}${entry.expr ? `  ${entry.expr}` : ''}${where}`);
  }
}

/**
 * Executes `avenx atlas` — an overview of the application model.
 * @param {object} cli - The AvenxCLI instance.
 * @param {string[]} [args] - CLI arguments.
 * @returns {void}
 */
export function runAtlas(cli, args = []) {
  const model = buildModel(cli);

  if (wantsJson(args)) {
    console.log(JSON.stringify(buildAtlas(model), null, 2));
    return;
  }

  const counts = model.counts();
  console.log(bold(cyan('🗺  Avenx Atlas')));
  if (model.errors.length > 0) {
    // A partial model must announce itself. An absence in it is not evidence
    // of an absence in the application.
    console.log(yellow(`   ⚠ ${model.errors.length} part${model.errors.length === 1 ? '' : 's'} of this project could not be analysed:`));
    for (const failure of model.errors) {
      console.log(yellow(`     [${failure.code}] ${failure.message.split('\n')[0]}`));
    }
    console.log(gray('   Everything below is what Atlas could still see.'));
  }
  console.log(gray(`   ${model.nodes.size} nodes · ${model.edges.length} relationships · ${model.unresolved.length} unresolved\n`));

  const rows = [
    ['Components', counts[AtlasNodeKind.COMPONENT]],
    ['Pages', counts[AtlasNodeKind.PAGE]],
    ['Bridges', counts[AtlasNodeKind.BRIDGE]],
    ['State keys', counts[AtlasNodeKind.STATE]],
    ['Computed', counts[AtlasNodeKind.COMPUTED]],
    ['Getters', counts[AtlasNodeKind.GETTER]],
    ['Actions', counts[AtlasNodeKind.ACTION]],
    ['Resources', counts[AtlasNodeKind.RESOURCE]],
    ['Bindings', counts[AtlasNodeKind.BINDING]],
    ['Handlers', counts[AtlasNodeKind.HANDLER]],
    ['Routes', counts[AtlasNodeKind.ROUTE]],
    ['Guards', counts[AtlasNodeKind.GUARD]],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(width)}  ${bold(String(value))}`);
  }

  for (const kind of [AtlasNodeKind.BRIDGE, AtlasNodeKind.PAGE, AtlasNodeKind.COMPONENT]) {
    const nodes = model.nodesOfKind(kind);
    if (nodes.length === 0) continue;
    console.log(`\n${bold(`${kind[0].toUpperCase()}${kind.slice(1)}s`)}`);
    for (const node of nodes) {
      const members = model
        .outgoing(node.id)
        .filter((edge) => edge.kind === 'declares')
        .map((edge) => model.getNode(edge.to))
        .filter((member) => member && member.kind !== AtlasNodeKind.BINDING && member.kind !== AtlasNodeKind.HANDLER);
      const summary = members.length > 0 ? gray(` — ${members.length} declaration${members.length === 1 ? '' : 's'}`) : '';
      console.log(`  ${node.name}${summary}${node.file ? gray(`  ${node.file}`) : ''}`);
    }
  }

  const routes = model.nodesOfKind(AtlasNodeKind.ROUTE);
  if (routes.length > 0) {
    console.log(`\n${bold('Routes')}`);
    for (const route of routes) {
      const outgoing = model.outgoing(route.id);
      const page = outgoing.find((edge) => edge.kind === 'routes-to');
      const guards = outgoing.filter((edge) => edge.kind === 'guarded-by').map((edge) => model.getNode(edge.to).name);
      const target = page ? model.getNode(page.to).name : yellow('unresolved');
      console.log(`  ${route.name.padEnd(12)} → ${target}${guards.length ? gray(`  guarded by ${guards.join(', ')}`) : ''}`);
    }
  }

  if (model.unresolved.length > 0) {
    /** @type {Object<string, number>} */
    const byReason = {};
    for (const entry of model.unresolved) {
      byReason[entry.reason] = (byReason[entry.reason] || 0) + 1;
    }
    console.log(`\n${bold(yellow('Unresolved'))} ${gray('— relationships Atlas could not follow')}`);
    for (const [reason, count] of Object.entries(byReason).sort()) {
      console.log(`  ${reason.padEnd(24)} ${count}`);
    }
    console.log(gray('\n  Run `avenx atlas --json` for each one, with its location.'));
  } else {
    console.log(`\n${green('Every relationship in this project resolved.')}`);
  }
}

/**
 * Executes `avenx impact <symbol>` and `avenx why <symbol>`.
 *
 * One implementation because they are one traversal in opposite directions:
 * impact follows edges into a node, why follows edges out of it.
 * @param {object} cli - The AvenxCLI instance.
 * @param {string[]} args - CLI arguments.
 * @param {'in'|'out'} direction - Which way to walk.
 * @returns {void}
 */
export function runQuery(cli, args, direction) {
  const verb = direction === 'in' ? 'impact' : 'why';
  const symbol = positional(args);

  if (!symbol) {
    console.error(`❌ Please name a symbol, e.g. ${cyan(`avenx ${verb} cart.items`)}`);
    process.exitCode = 1;
    return;
  }

  const model = buildModel(cli);
  const matches = resolveSymbol(model, symbol);

  if (matches.length !== 1) {
    if (wantsJson(args)) {
      console.log(JSON.stringify({ query: symbol, error: matches.length === 0 ? 'not-found' : 'ambiguous', candidates: matches.map((node) => node.id) }, null, 2));
    } else {
      reportAmbiguous(model, symbol, matches);
    }
    process.exitCode = 1;
    return;
  }

  const target = matches[0];
  const result = walk(model, target.id, { direction, depth: numericFlag(args, 'depth', 12) });
  const reached = flatten(result.root);
  const unresolved = relevantUnresolved(model, reached, target.id);

  if (wantsJson(args)) {
    console.log(
      JSON.stringify(
        {
          query: symbol,
          direction: direction === 'in' ? 'impact' : 'why',
          target: { id: target.id, kind: target.kind, name: target.name, ...(target.loc ? { loc: target.loc } : {}) },
          reached,
          unresolved,
          truncated: result.truncated,
        },
        null,
        2,
      ),
    );
    return;
  }

  const heading = direction === 'in' ? 'What depends on' : 'What this depends on';
  console.log(`${bold(cyan(`${heading}: ${displayName(model, target)}`))}`);
  console.log(gray(`   ${target.kind}${locationOf(target) ? `  ${locationOf(target)}` : ''}\n`));

  if (result.children.length === 0) {
    console.log(gray(direction === 'in' ? '  Nothing in the application depends on this.' : '  This depends on nothing Atlas models.'));
  } else {
    printTree(model, result.root);
    console.log(gray(`\n${reached.length} related node${reached.length === 1 ? '' : 's'}${result.truncated ? ' (depth limit reached — pass --depth=N for more)' : ''}`));
  }

  printUnresolved(unresolved);
}

export default { runAtlas, runQuery };
