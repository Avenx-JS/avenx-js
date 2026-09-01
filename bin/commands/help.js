import { bold, cyan, green, gray } from '../colors.js';

/**
 * Prints the help message with available commands to the console.
 */
export function printHelp() {
  console.log(`
${bold(cyan('Avenx-JS CLI'))}
${bold('Usage:')} ${green('avenx')} ${gray('<command> [type] [name]')}

${bold(cyan('Commands:'))}
  ${green('init')}                      ${gray('Initialize a new Avenx project structure')}
  ${green('generate component <name>')} ${gray('Generate a new component (alias: g)')}
  ${green('generate page <name>')}      ${gray('Generate a new page (alias: g p)')}
  ${green('generate bridge <name>')}    ${gray('Generate a new shared reactive bridge')}
  ${green('generate guard <name>')}     ${gray('Generate a new route guard')}
  ${green('destroy component <name>')}  ${gray('Delete a component and its registrations (alias: d)')}
  ${green('destroy page <name>')}       ${gray('Delete a page (alias: d p)')}
  ${green('destroy bridge <name>')}     ${gray('Delete a shared reactive bridge')}
  ${green('destroy guard <name>')}      ${gray('Delete a route guard')}
  ${green('build (b)')}                 ${gray('Build for production: minified runtime, optimized output')}
  ${green('clean')}                     ${gray('Clear build output directory')}
  ${green('check (lint)')}              ${gray('Validate templates without building')}
  ${green('doctor')}                    ${gray('Diagnose environment, config, and project health')}
  ${green('env')}                       ${gray('Print and validate active environment variables')}
  ${green('explain <CODE>')}            ${gray('Explain a compiler/runtime error or warning code')}
  ${green('inspect (i)')}               ${gray('Inspect project route and component hierarchy')}
  ${green('stats (s)')}                 ${gray('Display component & bundle footprint metrics')}
  ${green('atlas')}                     ${gray('Show the compiler\'s semantic map of the application')}
  ${green('impact <symbol>')}           ${gray('What can be affected if this changes')}
  ${green('why <symbol>')}              ${gray('Where this value comes from')}
  ${green('trace list')}                ${gray('List recorded causal traces')}
  ${green('trace view <id|latest>')}    ${gray('Print a trace as a causal tree: event to DOM patch')}
  ${green('trace export <id|latest>')}  ${gray('Turn a recorded trace into a regression test')}
  ${green('trace prune')}               ${gray('Remove stored traces')}
  ${green('serve [port]')}              ${gray('Start dev server with hot-reload (default: 3000)')}
  ${green('watch (w)')}                 ${gray('Watch for file changes and rebuild automatically')}
  ${green('help')}                      ${gray('Show this help message')}

${bold(cyan('Options:'))}
  ${green('--dev')}                     ${gray('Build for development: readable runtime, inline CSS source maps')}
  ${green('--prod')}                    ${gray('Build for production (the default for "build")')}
  ${green('--dry-run, -d')}             ${gray('Preview actions without writing or deleting any files')}
  ${green('--with-test')}               ${gray('Generate a colocated unit test file alongside the component')}
  ${green('--no-test')}                 ${gray('Skip generating unit test files')}
  ${green('--template, -t <name>')}     ${gray('Use a custom scaffold template for code generation')}
  ${green('--json, -j')}                ${gray('Machine-readable output for check, atlas, impact and why')}
  ${green('--depth=<n>')}               ${gray('How many hops "impact" and "why" follow (default: 12)')}
  ${green('--watch, -w')}               ${gray('Watch project component files for continuous template linting')}
  ${green('--no-color')}                ${gray('Disable colored output (the NO_COLOR variable is honored too)')}
  ${green('--trace')}                   ${gray('Record a causal trace while serving (dev only, off by default)')}
  ${green('--out, -o <file>')}          ${gray('Where "trace export" writes the generated regression test')}
  ${green('--keep=<n>, --all')}         ${gray('How much "trace prune" removes')}
  ${green('--version, -v')}             ${gray('Output the current version')}
    `);
}
