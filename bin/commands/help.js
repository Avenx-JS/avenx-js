import { bold, cyan, green, gray } from '../colors.js';

/**
 * Prints the help message with available commands to the console.
 */
export function printHelp() {
  console.log(`
${bold(cyan('Avenx-JS CLI'))}
${bold('Usage:')} ${green('avenx')} ${gray('<command> [type] [name]')}

${bold(cyan('Commands:'))}
  ${green('init [name]')}               ${gray('Initialize a new Avenx project here, or in a new ./<name> directory')}
  ${green('generate component <name>')} ${gray('Generate a new component (alias: g)')}
  ${green('generate page <name>')}      ${gray('Generate a new page (alias: g p)')}
  ${green('generate bridge <name>')}    ${gray('Generate a new shared reactive bridge')}
  ${green('generate guard <name>')}     ${gray('Generate a new route guard')}
  ${green('generate test <name>')}      ${gray('Add a colocated test to an existing component')}
  ${green('destroy component <name>')}  ${gray('Delete a component and its registrations (alias: d)')}
  ${green('destroy page <name>')}       ${gray('Delete a page (alias: d p)')}
  ${green('destroy bridge <name>')}     ${gray('Delete a shared reactive bridge')}
  ${green('destroy guard <name>')}      ${gray('Delete a route guard')}
  ${green('build (b)')}                 ${gray('Build for production: minified runtime, optimized output')}
  ${green('clean')}                     ${gray('Clear build output directory (--dry-run previews without deleting)')}
  ${green('check (lint)')}              ${gray('Validate templates without building')}
  ${green('doctor')}                    ${gray('Diagnose project health; --fix repairs scaffold files, --dry-run previews, --json reports')}
  ${green('env')}                       ${gray('Print and validate active environment variables')}
  ${green('explain <CODE|--list>')}     ${gray('Explain a compiler/runtime error or warning code, or list them all')}
  ${green('inspect (i)')}               ${gray('Inspect project route and component hierarchy')}
  ${green('stats (s)')}                 ${gray('Display component & bundle footprint metrics')}
  ${green('atlas')}                     ${gray("Show the compiler's semantic map of the application")}
  ${green('impact <symbol>')}           ${gray('What can be affected if this changes')}
  ${green('why <symbol>')}              ${gray('Where this value comes from')}
  ${green('trace list (ls)')}           ${gray('List recorded causal traces (default for bare "avenx trace")')}
  ${green('trace view (show) <id|latest>')} ${gray('Print a trace as a causal tree: event to DOM patch')}
  ${green('trace export <id|latest>')}  ${gray('Turn a recorded trace into a regression test')}
  ${green('trace diff <a> <b>')}        ${gray('Compare trace ids, latest, or exported .trace.json files')}
  ${green('trace prune (clean)')}       ${gray('Remove stored traces')}
  ${green('serve [port]')}              ${gray('Start dev server with hot-reload (default: 3000)')}
  ${green('watch (w)')}                 ${gray('Watch for file changes and rebuild automatically')}
  ${green('format')}                    ${gray('Format project files using Prettier (--dry-run lists, --check fails if unformatted)')}
  ${green('help')}                      ${gray('Show this help message')}
  
${bold(cyan('Options:'))}
  ${green('--layout <blank|routing>')}  ${gray('Specify project layout template for init (default: blank)')}
  ${green('--style <none|sass|...>')}   ${gray('Specify CSS preprocessor for init (none, sass, less, postcss)')}
  ${green('--yes, -y')}                 ${gray('Skip the "init" wizard and take the defaults (none, blank)')}
  ${green('--interactive, -i')}         ${gray('Run the "init" wizard even when stdin or stdout is not a TTY')}
  ${green('--dev')}                     ${gray('Build for development: readable runtime, inline CSS source maps')}
  ${green('--prod')}                    ${gray('Build for production (the default for "build")')}
  ${green('--csp-strict')}              ${gray("Refuse any output needing 'unsafe-eval', in development builds too")}
  ${green('--code-splitting, --split')} ${gray('Emit each page as its own chunk in <distDir>/pages/ ("build" only)')}
  ${green('--dry-run, -d')}             ${gray('Preview actions without writing or deleting any files')}
  ${green('--force, -f')}               ${gray('Force overwrite existing files during scaffold generation')}
  ${green('--with-test')}               ${gray('Generate a colocated unit test file alongside the component')}
  ${green('--no-test')}                 ${gray('Skip generating unit test files')}
  ${green('--no-style')}                ${gray('Skip the stylesheet of a generated component or page')}
  ${green('--template, -t <name>')}     ${gray('Use a custom scaffold template for code generation')}
  ${green('--json, -j')}                ${gray('Machine-readable output for check, doctor, stats, atlas, impact, why, explain, inspect, env, trace list, trace view and trace diff (explain: --json only, with --list too; trace: list, view and diff only)')}
  ${green('--list')}                    ${gray('explain: list every code with severity, category and whether warnings can configure it')}
  ${green('--category <name>')}         ${gray('explain --list: keep only one category (compiler, runtime, styling, routing, accessibility, environment)')}
  ${green('--depth=<n>')}               ${gray('How many hops "impact" and "why" follow (default: 12)')}
  ${green('--watch, -w')}               ${gray('Watch project component files for continuous template linting')}
  ${green('--strict, --strict-a11y')}   ${gray('Make "check" fail on accessibility warnings too')}
  ${green('--sarif')}                   ${gray('Emit SARIF 2.1.0 from "check" for code scanning annotations')}
  ${green('--save [file]')}             ${gray('Save built asset sizes with "stats" (default: .avenx/size-baseline.json)')}
  ${green('--compare [file]')}          ${gray('Compare built asset sizes against a saved baseline')}
  ${green('--max-increase <n%>')}       ${gray('Fail "stats --compare" if total raw, minified or gzip growth exceeds n%')}
  ${green('--no-color')}                ${gray('Disable colored output (the NO_COLOR variable is honored too)')}
  ${green('--port, -p <port>')}         ${gray('Port for "serve" (else a bare port arg, then PORT, config server.port, 3000)')}
  ${green('--host, -h <host>')}         ${gray('Host for "serve" to bind (default: localhost)')}
  ${green('--open, -o')}                ${gray('Open a browser when "serve" starts')}
  ${green('--https')}                   ${gray('Serve HTTPS (requires a certificate and key)')}
  ${green('--cert <file>, --key <file>')} ${gray('Development TLS certificate and private key')}
  ${green('--no-live-reload')}          ${gray('Disable live reload while serving')}
  ${green('--no-error-overlay')}        ${gray('Do not show build diagnostics as a browser overlay while serving')}
  ${green('--trace')}                   ${gray('Record a causal trace while serving (dev only, off by default)')}
  ${green('--roots=<n>')}               ${gray('Show only the first n causal roots in "trace view"')}
  ${green('--fail-on-change')}          ${gray('Exit with status 1 when "trace diff" finds a change')}
  ${green('--out, -o <file>')}          ${gray('Output file for "trace export", "atlas --graph" or "check --sarif"')}
  ${green('--graph --format <type>')}   ${gray('Draw the Atlas as mermaid (default) or dot')}
  ${green('--kinds <list>')}            ${gray('Atlas graph node kinds; default: route,page,component,bridge')}
  ${green('--focus <symbol>')}          ${gray('Bound an Atlas graph around a symbol, with --depth <n>')}
  ${green('--keep=<n>, --all')}         ${gray('How much "trace prune" removes')}
  ${green('--help')}                    ${gray('Show this help for any command, before it runs')}
  ${green('--version, -v')}             ${gray('Output the current version')}
    `);
}
