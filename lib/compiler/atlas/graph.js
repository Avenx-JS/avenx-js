import { AtlasNodeKind } from './AppModel.js';
import { displayName, flatten, resolveSymbol, walk } from './query.js';

const ARCHITECTURE_KINDS = ['route', 'page', 'component', 'bridge'];
const EDGE_COLORS = {
  'routes-to': '#2563eb', 'guarded-by': '#7c3aed', declares: '#64748b',
  reads: '#0891b2', writes: '#d97706', invokes: '#16a34a',
  renders: '#db2777', imports: '#475569', emits: '#9333ea', subscribes: '#0d9488',
};

/**
 * Escape arbitrary source text inside a quoted Mermaid label.
 * @param {string} value - A display label.
 * @returns {string} Mermaid entity-escaped text.
 */
function mermaidLabel(value) {
  return String(value).replace(/["#&<>|\r\n]/g, (char) => `#${char.charCodeAt(0)};`);
}

/**
 * Render the retained model as a deterministic, filtered application diagram.
 * @param {AppModel} model - The compiler's retained model.
 * @param {object} [options] - Diagram options.
 * @param {'mermaid'|'dot'} [options.format] - Output language.
 * @param {string[]} [options.kinds] - Included node kinds (singular or plural).
 * @param {string} [options.focus] - A symbol to center the two query walks on.
 * @param {number} [options.depth] - Maximum query depth when focused.
 * @returns {string} A complete diagram with a trailing newline.
 */
export function renderAtlasGraph(model, options = {}) {
  const { format = 'mermaid', kinds = ARCHITECTURE_KINDS, focus, depth = 3 } = options;
  if (!['mermaid', 'dot'].includes(format)) throw new Error('Graph format must be mermaid or dot.');
  if (!Number.isInteger(depth) || depth < 0) throw new Error('Graph depth must be a non-negative integer.');
  const aliases = new Map(Object.values(AtlasNodeKind).flatMap((kind) => [[kind, kind], [`${kind}s`, kind]]));
  const selectedKinds = new Set(kinds.map((kind) => {
    if (!aliases.has(kind)) throw new Error(`Unknown Atlas node kind "${kind}".`);
    return aliases.get(kind);
  }));
  if (!selectedKinds.size) throw new Error('At least one Atlas node kind is required.');

  let focusedIds = null;
  if (focus !== undefined) {
    const matches = resolveSymbol(model, focus);
    if (matches.length !== 1) {
      throw new Error(matches.length ? `Ambiguous Atlas symbol "${focus}": ${matches.map((node) => node.id).join(', ')}` : `No Atlas symbol named "${focus}".`);
    }
    focusedIds = new Set([matches[0].id]);
    for (const direction of ['in', 'out']) {
      const tree = walk(model, matches[0].id, { direction, depth }).root;
      for (const entry of flatten(tree)) focusedIds.add(entry.id);
    }
  }
  const all = model.toJSON();
  const nodes = all.nodes.filter((node) => selectedKinds.has(node.kind) && (!focusedIds || focusedIds.has(node.id)));
  const ids = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const edges = all.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const status = `${all.unresolved.length} unresolved relationships; ${(all.errors || []).length} analysis errors in the full model`;

  if (format === 'dot') {
    const lines = ['digraph Atlas {', '  rankdir=LR;', `  label=${JSON.stringify(status)};`, '  labelloc="t";'];
    for (const node of nodes) {
      lines.push(`  ${ids.get(node.id)} [label=${JSON.stringify(`${node.kind}: ${displayName(model, node)}`)}];`);
    }
    for (const edge of edges) {
      lines.push(`  ${ids.get(edge.from)} -> ${ids.get(edge.to)} [label=${JSON.stringify(edge.kind)}, color="${EDGE_COLORS[edge.kind] || '#64748b'}", style=${edge.confidence === 'possible' ? 'dashed' : 'solid'}];`);
    }
    return [...lines, '}', ''].join('\n');
  }

  const lines = ['flowchart LR', `  atlas_status["${mermaidLabel(status)}"]`];
  for (const node of nodes) {
    lines.push(`  ${ids.get(node.id)}["${mermaidLabel(`${node.kind}: ${displayName(model, node)}`)}"]`);
  }
  edges.forEach((edge, index) => {
    const arrow = edge.confidence === 'possible' ? '-.->' : '-->';
    lines.push(`  ${ids.get(edge.from)} ${arrow}|"${mermaidLabel(edge.kind)}"| ${ids.get(edge.to)}`);
    lines.push(`  linkStyle ${index} stroke:${EDGE_COLORS[edge.kind] || '#64748b'}`);
  });
  return [...lines, ''].join('\n');
}
