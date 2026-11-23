import fs from 'fs';
import path from 'path';
import { Resolver, AVENX_PACKAGE_ROOT, realPath } from '../bundler/resolve.js';
import { parseModule } from '../bundler/parseModule.js';
import { CodeMask } from '../bundler/scanner.js';

/**
 * Detects routing in application modules, including imports outside srcDir.
 * Generated expression strings retain $route/$router, so strings are examined
 * conservatively as well as code. Comments do not cause a capability to link.
 * The runtime itself is excluded: its API declarations are not application use.
 * @param {object} options - The application being compiled.
 * @param {string} options.mainFile - Entry module path.
 * @param {Map<string, string>} options.virtualModules - Compiled units.
 * @param {object[]} options.registrations - Automatic page/bridge registrations.
 * @param {object} options.config - Module resolution configuration.
 * @param {string} options.rootDir - Project root.
 * @returns {string|null} The reason routing must be installed, if any.
 */
export function routingReason({ mainFile, virtualModules, registrations, config, rootDir }) {
  if (registrations.some((unit) => unit.kind === 'page')) return 'the application declares pages';
  if ([...virtualModules.keys()].some((file) => file.endsWith('.guard.js'))) return 'the application declares guards';

  const resolver = new Resolver({ virtualModules, config, rootDir, roots: [rootDir] });
  const runtimeRoot = realPath(path.join(AVENX_PACKAGE_ROOT, 'lib/core')) + path.sep;
  const pending = [mainFile, ...virtualModules.keys()];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.startsWith(runtimeRoot) || file.endsWith('.json')) continue;
    const source = virtualModules.get(file) ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    const code = new CodeMask(source).withoutComments();
    if (/\b(?:initRouter|AvenxRouter|AvenxGuard)\b|(?<![\w$])\$(?:route|router)\b/.test(code)) {
      return `routing is referenced by ${path.relative(rootDir, file).split(path.sep).join('/')}`;
    }
    for (const specifier of parseModule(source, file).dependencies) {
      if (specifier === 'avenx-core/runtime/router') return 'the router installer is explicitly imported';
      // The normal bundler reports resolution failures with the full diagnostic.
      // This discovery pass may also visit an unused component whose imports
      // will never be in the entry graph.
      try {
        pending.push(resolver.resolve(specifier, file));
      } catch {
        // Leave validation to the actual linked graph.
      }
    }
  }
  return null;
}
