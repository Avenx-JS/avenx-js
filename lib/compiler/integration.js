/**
 * @file integration.js
 * @description The compiler pieces a build-tool plugin needs, as one published
 * entry point: `avenx-core/integration`.
 *
 * `@avenx/vite` compiles components inside Vite's transform hook, so it needs
 * the parser, the style processor and the source-map writer directly rather
 * than the whole-project `AvenxCompiler`. It used to import them as
 * `../../../lib/compiler/...`, which works only inside this repository: in a
 * published package that path points outside `node_modules` and the plugin
 * fails at its first import. This module is what it imports instead.
 *
 * It re-exports; it adds no behaviour. Anything exported here is depended on by
 * an official plugin, so removing or reshaping an export is a breaking change
 * for that plugin, which is published in lockstep with this package.
 * @module avenx-core/integration
 */
export { default as ComponentParser } from './ComponentParser.js';
export { default as StyleProcessor } from './StyleProcessor.js';
export { BuildError } from './errors/index.js';
export { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
export { encodeVLQ, generateTemplateSourceMap, composeBundleSourceMap } from './sourcemap.js';
export { runtimeImportStatement } from './codegen/expression.js';
