import { AtlasEdgeKind, AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { buildModel } from './atlas.js';
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
 * Prints the project's page, component and bridge hierarchy.
 * @param {object} cli - The AvenxCLI instance.
 * @returns {void}
 */
export function runInspect(cli) {
  const srcRel = (cli.config && cli.config.srcDir) || 'src';
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

  const pages = model.nodesOfKind(AtlasNodeKind.PAGE);
  const components = model.nodesOfKind(AtlasNodeKind.COMPONENT);
  const bridges = model.nodesOfKind(AtlasNodeKind.BRIDGE);
  const guards = model.nodesOfKind(AtlasNodeKind.GUARD);

  console.log(bold(cyan(`📦 Avenx Project Hierarchy (${srcRel}/)`)));

  const categories = [
    {
      title: `📄 Pages (${pages.length})`,
      items: pages.map((page) => {
        const route = routeOfPage.get(page.id);
        return { text: `${page.name}${route ? ` (${route})` : ''} -> ${page.file}`, warn: false };
      }),
    },
    {
      title: `🧩 Components (${components.length})`,
      items: components.map((component) => {
        const unused = isUnused(model, component);
        return {
          text: `${component.name} -> ${component.file}${unused ? ' (⚠️ Unused)' : ''}`,
          warn: unused,
        };
      }),
    },
    {
      title: `🌉 Bridges (${bridges.length})`,
      items: bridges.map((bridge) => {
        const consumers = model.incoming(bridge.id).filter((edge) => edge.kind === AtlasEdgeKind.IMPORTS).length;
        const unused = consumers === 0;
        return {
          text: `${bridge.name} -> ${bridge.file}${unused ? ' (⚠️ Not imported anywhere)' : ''}`,
          warn: unused,
        };
      }),
    },
  ];

  if (guards.length > 0) {
    categories.push({
      title: `🛡️  Guards (${guards.length})`,
      items: guards.map((guard) => {
        const routes = model
          .incoming(guard.id)
          .filter((edge) => edge.kind === AtlasEdgeKind.GUARDED_BY)
          .map((edge) => model.getNode(edge.from).name);
        const unused = routes.length === 0;
        return {
          text: `${guard.name} -> ${guard.file}${routes.length ? ` (${routes.join(', ')})` : ' (⚠️ Not attached to any route)'}`,
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

  if (model.unresolved.length > 0) {
    console.log(
      gray(
        `\n${model.unresolved.length} relationship${model.unresolved.length === 1 ? '' : 's'} could not be resolved; run \`avenx atlas\` for detail.`,
      ),
    );
  }
}

export default runInspect;
