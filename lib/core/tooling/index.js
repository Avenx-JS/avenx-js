/**
 * Avenx build-time and editor tooling.
 *
 * Everything here runs in Node: it reads the project from disk to resolve
 * component names and to lint templates. It is kept out of `lib/core/index.js`
 * so the browser build never pulls `fs` or `path` into its graph.
 * @module lib/core/tooling
 */

export {
  componentNameFromFile,
  findRegisteredComponents,
  extractLintableTemplate,
  findInvalidComponentTags,
  findProjectRoot,
} from './componentTagNaming.js';
export { componentTagNamingRule } from './eslintComponentTagNaming.js';
export { loadComponent, classNameFor, bridgeDependencies } from './loadComponent.js';
export { default as avenxTemplateParser } from './avenxTemplateParser.js';
// Re-exported so a host that frames a compiled class body itself -- the Vite
// plugin does -- writes the same import the CLI emitter writes.
export { runtimeImportStatement } from '../../compiler/codegen/expression.js';
