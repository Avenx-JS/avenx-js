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
  clearRegistryCache,
  extractLintableTemplate,
  findInvalidComponentTags,
  findProjectRoot,
} from './componentTagNaming.js';
export { componentTagNamingRule } from './eslintComponentTagNaming.js';
export { templateAccessibilityRule } from './eslintAccessibility.js';
export { findAccessibilityIssues } from '../../compiler/rules/accessibility.js';
export { loadComponent, classNameFor, bridgeDependencies } from './loadComponent.js';
export { default as avenxTemplateParser } from './avenxTemplateParser.js';
// Re-exported so a host that frames a compiled class body itself -- the Vite
// plugin does -- writes the same import the CLI emitter writes.
export { runtimeImportStatement } from '../../compiler/codegen/expression.js';
