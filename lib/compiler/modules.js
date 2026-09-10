/**
 * @file modules.js
 * @description Wraps what the compiler generates into real ES modules.
 *
 * ## Where the boundary is
 *
 * The compiler owns Avenx semantics: templates, declarations, expressions,
 * scoped CSS, Atlas, the shape of a generated component class. The bundler owns
 * modules: resolution, the dependency graph, dead-code elimination, emission.
 *
 * This file is the seam. It takes the class declaration `ComponentParser`
 * produces — unchanged, still a bare `class X extends AvenxComponent` — and
 * gives it the module framing a graph can read: an import of the runtime, the
 * developer's own imports preserved verbatim, and a default export.
 *
 * Keeping the parser's output shape untouched is deliberate. It is what
 * `avenx-core/testing`, the Vite plugin and six test files consume, and there
 * is no reason a change to how modules are *linked* should change how a
 * component is *compiled*.
 *
 * ## Why the developer's imports are copied verbatim
 *
 * This is the fix for the defect that motivated the whole migration. The old
 * pipeline ran every module through `rewriteRuntimeImports`, which turned the
 * runtime import into destructuring and **deleted every other import**. A
 * component importing an npm package compiled to a green build and a
 * `ReferenceError` in the browser, because the import simply ceased to exist.
 *
 * Here an import statement is passed through untouched. If it names something
 * that does not exist, the bundler says so and the build fails. There is no
 * code path that removes one.
 * @module lib/compiler/modules
 */

import path from 'path';
import { runtimeImportStatement } from './codegen/expression.js';

/**
 * Turns an absolute path into a specifier a generated module can carry.
 *
 * Absolute POSIX-style paths, because the resolver treats them as paths rather
 * than package names and Windows separators would read as escape sequences
 * inside the generated string literal.
 * @param {string} target - Absolute path to the module.
 * @returns {string} A specifier safe to embed.
 */
export function pathSpecifier(target) {
  return JSON.stringify(target.split(path.sep).join('/'));
}

/**
 * Extracts the import declarations from a source file, in order.
 *
 * Used to carry a component's own imports into its generated module. The
 * scanner-based module reader is not used here because this runs on Avenx
 * template source, which is not JavaScript: an `import` line is the one
 * JavaScript-shaped construct allowed at the top of a `.component.js`, and it
 * is read as such.
 * @param {string} source - The component or page source.
 * @returns {string[]} The import statements, as written.
 */
export function collectImportStatements(source) {
  const statements = [];
  const pattern = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]*['"];?[ \t]*$/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    statements.push(match[0].trim());
  }
  return statements;
}

/**
 * Builds the ES module for a compiled component or page.
 * @param {object} options - Module options.
 * @param {string} options.className - The generated class name.
 * @param {string} options.body - The class declaration `ComponentParser` produced.
 * @param {boolean} options.isPage - Whether the unit is a page.
 * @param {string[]} options.imports - The developer's own import statements.
 * @param {Array<{local: string, binding: string}>} options.bridgeBindings - Bridges
 *   the unit imported, so the class body's binding names resolve.
 * @returns {string} The module source.
 */
export function componentModule({ className, body, isPage, imports, bridgeBindings }) {
  const base = isPage ? 'AvenxPage' : 'AvenxComponent';

  // The class body refers to bridges by their stable binding name so that the
  // generated code is the same whatever the developer called the import. One
  // alias per bridge reconciles the two without touching either.
  const aliases = bridgeBindings
    .filter((entry) => entry.local !== entry.binding)
    .map((entry) => `const ${entry.binding} = ${entry.local};`);

  // The base class plus the expression primitives the compiled closures call.
  // Imported unconditionally rather than only when the class body has a table:
  // an unused named import is removed by the bundler's tree shaker, and making
  // the import conditional would mean the emitter has to know what the
  // generator did.
  return [
    runtimeImportStatement(base),
    ...imports,
    ...aliases,
    body,
    `export default ${className};`,
    '',
  ].join('\n');
}

/**
 * Builds the ES module for a bridge.
 *
 * A bridge file is already valid JavaScript, so almost nothing happens to it:
 * its default export is named so the runtime can be told what to call it, and
 * that is all. Its own imports — the runtime, other bridges — stay as they were
 * written and become real edges in the graph, which is what replaced the old
 * alias-and-concatenate scheme.
 * @param {object} options - Module options.
 * @param {string} options.name - The bridge's declared name.
 * @param {string} options.binding - The stable binding name for the bridge.
 * @param {string} options.source - The bridge source, after env substitution.
 * @returns {string} The module source.
 */
export function bridgeModule({ name, binding, source }) {
  const named = source.replace(/export\s+default\s+/, `const ${binding} = `);

  return [
    "import { defineBridgeName as __avx_defineBridgeName } from 'avenx-core/runtime';",
    named.trimEnd(),
    `__avx_defineBridgeName(${JSON.stringify(name)}, ${binding});`,
    `export default ${binding};`,
    '',
  ].join('\n');
}

/**
 * Builds the application entry module.
 *
 * `main.app.js` is the developer's file and stays theirs. The compiler adds
 * what it discovered for them — the pages under `src/pages/`, the bridges
 * something imports — as ordinary imports and registrations, in the place the
 * old pipeline injected them, so a project that worked before works now.
 * @param {object} options - Entry options.
 * @param {string} options.source - `main.app.js`, after env substitution.
 * @param {Array<{name: string, file: string, kind: string}>} options.registrations -
 *   Units to import and register.
 * @param {string[]} [options.prelude] - Ids of modules to import before
 *   anything else: the documented globals, the development tools, the Rewind
 *   configuration.
 * @returns {string} The module source.
 */
export function entryModule({ source, registrations, prelude = [] }) {
  const imports = [];
  const calls = [];

  for (const id of prelude) {
    imports.push(`import ${pathSpecifier(id)};`);
  }

  registrations.forEach((entry, index) => {
    const local = `__avx_${entry.kind}_${index}`;
    imports.push(`import ${local} from ${pathSpecifier(entry.file)};`);
    const method = entry.kind === 'page' ? 'registerPage' : entry.kind === 'bridge' ? 'registerBridge' : 'register';
    calls.push(`app.${method}(${JSON.stringify(entry.name)}, ${local});`);
  });

  let body = source;

  if (calls.length > 0) {
    // The developer may have called their application something other than
    // `app`, and may have marked where registrations belong.
    let appName = 'app';
    const appMatch = body.match(/(?:const|let|var)?\s*([\w$.]+)\s*=\s*new\s+AvenxApp\(/);
    if (appMatch) {
      appName = appMatch[1].trim();
    }

    let block = calls.join('\n');
    if (appName !== 'app') {
      block = block.replace(/\bapp\.register/g, `${appName}.register`);
    }

    if (body.includes('// @avenx-inject')) {
      body = body.replace('// @avenx-inject', block);
    } else {
      const declaration = /((?:const|let|var)?\s*[\w$.]+\s*=\s*new\s+AvenxApp\([\s\S]*?\);?)/;
      if (declaration.test(body)) {
        body = body.replace(declaration, `$1\n${block}`);
      } else {
        body = `${block}\n${body}`;
      }
    }
  }

  return [...imports, body, ''].join('\n');
}

/**
 * Builds the module that installs Avenx's documented globals.
 *
 * ## A deliberate narrowing
 *
 * The concatenated build had no module system, so generated component classes
 * reached the runtime through bare globals and `globalThis.Avenx` had to carry
 * the whole export surface for anything else to be reachable at all.
 *
 * Generated modules now import what they use, so the global object is no longer
 * a mechanism — it is a compatibility surface. It carries exactly the names
 * `lib/core/globals.js` declares public. Importing the whole namespace to
 * publish it would pin every module in the runtime into every bundle, which
 * would trade a real saving for an escape hatch that imports already provide.
 * @param {string[]} names - The public global names.
 * @param {string} namespace - The namespace global's name.
 * @returns {string} The module source.
 */
export function globalsModule(names, namespace) {
  return [
    `import { ${names.join(', ')} } from 'avenx-core/runtime';`,
    '',
    `const __avx_public = { ${names.join(', ')} };`,
    '',
    'const __avx_root =',
    "  typeof globalThis !== 'undefined'",
    '    ? globalThis',
    "    : typeof window !== 'undefined'",
    '      ? window',
    "      : typeof global !== 'undefined'",
    '        ? global',
    '        : null;',
    '',
    'if (__avx_root) {',
    `  __avx_root[${JSON.stringify(namespace)}] = __avx_public;`,
    '  for (const __avx_name of Object.keys(__avx_public)) {',
    '    __avx_root[__avx_name] = __avx_public[__avx_name];',
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * Builds the module that configures Rewind for this project.
 *
 * A project that leaves `rewind` alone gets no module at all, so the defaults
 * baked into the journal are the only thing shipped and the bundle is
 * unchanged from what it was before Rewind existed.
 * @param {object} settings - Non-default journal settings.
 * @returns {string} The module source.
 */
export function rewindConfigModule(settings) {
  return [
    "import { journal } from 'avenx-core/runtime';",
    '',
    `journal.configure(${JSON.stringify(settings)});`,
    '',
  ].join('\n');
}

/**
 * Builds the development-only module that exposes the trace recorder.
 *
 * ## Why this module exists at all
 *
 * The recorder used to ship to every bundle, production included, because a
 * pre-bundled runtime blob had no way to leave anything out. Now it ships when
 * something references it, and in a production build nothing does -- which
 * makes the documentation's promise that recording "never reaches a production
 * build" structurally true rather than nearly true.
 *
 * `avenx serve --trace` still has to work, and it works by calling
 * `window.Avenx.installTraceRecorder(...)` from an injected script. So a
 * development build imports the recorder here, which both keeps it in the graph
 * and puts it where the dev server looks for it. Development and production
 * differ in exactly this: whether the debugging tool is present.
 * @param {string} namespace - The namespace global's name.
 * @returns {string} The module source.
 */
export function devtoolsModule(namespace) {
  const names = [
    'installTraceRecorder',
    'uninstallTraceRecorder',
    'isRecording',
    'TRACE_ENDPOINT',
    'startRecording',
    'stopRecording',
    'activeRecorder',
  ];

  return [
    `import { ${names.join(', ')} } from 'avenx-core/runtime';`,
    '',
    `const __avx_devtools = { ${names.join(', ')} };`,
    '',
    'const __avx_root =',
    "  typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null;",
    '',
    `if (__avx_root && __avx_root[${JSON.stringify(namespace)}]) {`,
    `  Object.assign(__avx_root[${JSON.stringify(namespace)}], __avx_devtools);`,
    '}',
    '',
  ].join('\n');
}

/**
 * Builds the module that installs the expression interpreter.
 *
 * The counterpart of the recorder above, and present for the same reason: a
 * development build should keep working while a template is being edited, and a
 * production build should not carry a JavaScript parser that can never run.
 * @returns {string} The module source.
 */
export function interpreterModule() {
  return [
    '// Installs the expression interpreter.',
    '//',
    '// A development build keeps working while a template is being edited: an',
    '// expression the generator could not compile -- reported as AVX_W48 -- is',
    '// interpreted instead of failing. A production build imports nothing here,',
    '// so the parser, the tree-walking evaluator and the old source-text sandbox',
    '// are unreachable and the bundler drops them. That is the whole of the',
    '// difference, and it is why a production bundle contains no `new Function`.',
    "import 'avenx-core/runtime/interpreter';",
    '',
  ].join('\n');
}
