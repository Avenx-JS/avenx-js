import { parse } from '../parser/js/parser.js';

/**
 * Classifies startup conservatively. Unknown helpers/imports may mount the app.
 * Comments and string contents are not executable entry points.
 * @param {string} source - main.app.js source.
 * @returns {'present'|'absent'|'unknown'} Startup evidence.
 */
export function classifyEntry(source) {
  let tree;
  try { tree = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }); }
  catch { return 'unknown'; }
  let present = false;
  let unknown = false;
  const constructors = new Set();
  for (const node of tree.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const from = node.source.value;
    if (from === 'avenx-core/runtime' || from === 'avenx-core/core') {
      for (const spec of node.specifiers) {
        if (spec.imported?.name === 'AvenxApp') constructors.add(spec.local.name);
      }
    } else if (!/\.(component|page|bridge|guard)\.js$/.test(from)) {
      unknown = true;
    }
  }
  const visit = (node) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    if (node.type === 'MemberExpression') {
      const name = node.computed ? node.property.value : node.property.name;
      if (['mount', 'mountPage', 'initRouter'].includes(name)) present = true;
      else if (node.computed) unknown = true;
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const name = callee.type === 'MemberExpression'
        ? (callee.computed ? callee.property.value : callee.property.name) : null;
      if (!['mount', 'mountPage', 'initRouter', 'register'].includes(name)) unknown = true;
    }
    if (node.type === 'NewExpression' && !constructors.has(node.callee.name)) unknown = true;
    if (node.type.startsWith('Export') || node.type === 'ImportExpression') unknown = true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(tree);
  return present ? 'present' : unknown ? 'unknown' : 'absent';
}
