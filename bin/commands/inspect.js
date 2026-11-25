import { AtlasEdgeKind, AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { buildModel } from './atlas.js';
import { runInspectGraph } from './atlasGraph.js';
import { bold, cyan, gray, yellow } from '../colors.js';

// `inspect` used to answer these questions with its own scanners - one regex
// for routes, one for class names, one substring search for "is this component
// used". The compiler already knows all of it, so this reads the model
// instead. The visible consequence is that "unused" now means nothing renders
// or imports it, rather than its name not appearing in another file.

/**
 * Whether anything in the application renders or imports a component.
 *
 * A page is never reported unused: it is reached by a route, or it is an entry
 * point the router has simply not been pointed at yet.
 * @param {object} model - The model.
 * @param {object} node - A component node.
 * @returns {boolean} True when nothing reaches it.
 */
function isUnused(model, node) {
  if (node.kind !== AtlasNodeKind.COMPONENT) return false;
  return !model
    .incoming(node.id)
    .some((edge) => edge.kind === AtlasEdgeKind.RENDERS || edge.kind === AtlasEdgeKind.IMPORTS);
}

/**
 * Builds the project's page, component, bridge and guard inventory from the
 * compiler's model. Shared by the text tree and the `--json` payload so the
 * two cannot disagree.
 * @param {object} cli - The AvenxCLI instance.
 * @returns {{ srcDir: string, pages: object[], components: object[], bridges: object[], guards: object[], unresolved: number }}
 */
function collectHierarchy(cli) {
  const srcDir = (cli.config && cli.config.srcDir) || 'src';
  const model = buildModel(cli);

  /** @type {Map<string, string>} */
  const routeOfPage = new Map();
  for (const route of model.nodesOfKind(AtlasNodeKind.ROUTE)) {
    for (const edge of model.outgoing(route.id)) {
      if (edge.kind !== AtlasEdgeKind.ROUTES_TO) continue;
      const existing = routeOfPage.get(edge.to);
      // Prefer a specific path over the root when a page answers both.
      if (!existing || (existing === '/' && route.name !== '/')) {
        routeOfPage.set(edge.to, route.name);
      }
    }
  }

  const pages = model.nodesOfKind(AtlasNodeKind.PAGE).map((page) => ({
    name: page.name,
    route: routeOfPage.get(page.id) ?? null,
    file: page.file,
  }));

  const components = model.nodesOfKind(AtlasNodeKind.COMPONENT).map((component) => ({
    name: component.name,
    file: component.file,
    unused: isUnused(model, component),
  }));

  const bridges = model.nodesOfKind(AtlasNodeKind.BRIDGE).map((bridge) => ({
    name: bridge.name,
    file: bridge.file,
    unused: model.incoming(bridge.id).filter((edge) => edge.kind === AtlasEdgeKind.IMPORTS).length === 0,
  }));

  const guards = model.nodesOfKind(AtlasNodeKind.GUARD).map((guard) => ({
    name: guard.name,
    file: guard.file,
    routes: model
      .incoming(guard.id)
      .filter((edge) => edge.kind === AtlasEdgeKind.GUARDED_BY)
      .map((edge) => model.getNode(edge.from).name),
  }));

  return { srcDir, pages, components, bridges, guards, unresolved: model.unresolved.length };
}

/**
 * Prints the project's page, component and bridge hierarchy.
 * With `--json` (or `-j`) it prints the same inventory as a JSON document.
 * @param {object} cli - The AvenxCLI instance.
 * @param {string[]} [args] - Command arguments.
 * @returns {void}
 */
export function runInspect(cli, args = []) {
  if (args.includes('--graph')) {
    runInspectGraph(buildModel(cli), args);
    return;
  }

  const isJson = args.includes('--json') || args.includes('-j');
  const hierarchy = collectHierarchy(cli);
  const { srcDir: srcRel, pages, components, bridges, guards, unresolved } = hierarchy;

  if (isJson) {
    const payload = {
      srcDir: srcRel,
      pages,
      components,
      bridges,
      guards,
      unresolved,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(bold(cyan(`📦 Avenx Project Hierarchy (${srcRel}/)`)));

  const categories = [
    {
      title: `📄 Pages (${pages.length})`,
      items: pages.map((page) => ({
        text: `${page.name}${page.route ? ` (${page.route})` : ''} -> ${page.file}`,
        warn: false,
      })),
    },
    {
      title: `🧩 Components (${components.length})`,
      items: components.map((component) => ({
        text: `${component.name} -> ${component.file}${component.unused ? ' (⚠️ Unused)' : ''}`,
        warn: component.unused,
      })),
    },
    {
      title: `🌉 Bridges (${bridges.length})`,
      items: bridges.map((bridge) => ({
        text: `${bridge.name} -> ${bridge.file}${bridge.unused ? ' (⚠️ Not imported anywhere)' : ''}`,
        warn: bridge.unused,
      })),
    },
  ];

  if (guards.length > 0) {
    categories.push({
      title: `🛡️  Guards (${guards.length})`,
      items: guards.map((guard) => {
        const unused = guard.routes.length === 0;
        return {
          text: `${guard.name} -> ${guard.file}${guard.routes.length ? ` (${guard.routes.join(', ')})` : ' (⚠️ Not attached to any route)'}`,
          warn: unused,
        };
      }),
    });
  }

  for (let cIdx = 0; cIdx < categories.length; cIdx++) {
    const category = categories[cIdx];
    const isLastCategory = cIdx === categories.length - 1;
    const catPrefix = isLastCategory ? '└── ' : '├── ';
    const childIndent = isLastCategory ? '    ' : '│   ';

    console.log(bold(`${catPrefix}${category.title}`));

    for (let iIdx = 0; iIdx < category.items.length; iIdx++) {
      const item = category.items[iIdx];
      const isLastItem = iIdx === category.items.length - 1;
      const itemPrefix = isLastItem ? '└── ' : '├── ';
      // Styling wraps the whole line so the tree stays aligned and greppable.
      const line = `${childIndent}${itemPrefix}${item.text}`;
      console.log(item.warn ? yellow(line) : line);
    }
  }

  if (unresolved > 0) {
    console.log(
      gray(`
${unresolved} relationship${unresolved === 1 ? '' : 's'} could not be resolved; run \`avenx atlas\` for detail.`),
    );
  }
}

export default runInspect;
