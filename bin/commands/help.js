/**
 * Prints the help message with available commands to the console.
 */
export function printHelp() {
  console.log(`
\x1b[1;36mAvenx-JS CLI\x1b[0m
\x1b[1mUsage:\x1b[0m \x1b[32mavenx\x1b[0m \x1b[90m<command> [type] [name]\x1b[0m

\x1b[1;36mCommands:\x1b[0m
  \x1b[32minit\x1b[0m                      \x1b[90mInitialize a new Avenx project structure\x1b[0m
  \x1b[32mgenerate component <name>\x1b[0m \x1b[90mGenerate a new component (alias: g)\x1b[0m
  \x1b[32mgenerate page <name>\x1b[0m      \x1b[90mGenerate a new page (alias: g p)\x1b[0m
  \x1b[32mgenerate bridge <name>\x1b[0m    \x1b[90mGenerate a new shared reactive bridge\x1b[0m
  \x1b[32mgenerate guard <name>\x1b[0m     \x1b[90mGenerate a new route guard\x1b[0m
  \x1b[32mdestroy component <name>\x1b[0m  \x1b[90mDelete a component and its registrations (alias: d)\x1b[0m
  \x1b[32mdestroy page <name>\x1b[0m       \x1b[90mDelete a page (alias: d p)\x1b[0m
  \x1b[32mdestroy bridge <name>\x1b[0m     \x1b[90mDelete a shared reactive bridge\x1b[0m
  \x1b[32mdestroy guard <name>\x1b[0m      \x1b[90mDelete a route guard\x1b[0m
  \x1b[32mbuild (b)\x1b[0m                 \x1b[90mBuild the project using configured output directory\x1b[0m
  \x1b[32mclean\x1b[0m                     \x1b[90mClear build output directory\x1b[0m
  \x1b[32mcheck (lint)\x1b[0m              \x1b[90mValidate templates without building\x1b[0m
  \x1b[32mserve [port]\x1b[0m              \x1b[90mStart dev server with hot-reload (default: 3000)\x1b[0m
  \x1b[32mwatch (w)\x1b[0m                 \x1b[90mWatch for file changes and rebuild automatically\x1b[0m
  \x1b[32mhelp\x1b[0m                      \x1b[90mShow this help message\x1b[0m

\x1b[1;36mOptions:\x1b[0m
  \x1b[32m--dry-run, -d\x1b[0m             \x1b[90mPreview actions without writing or deleting any files\x1b[0m
  \x1b[32m--version, -v\x1b[0m            \x1b[90mOutput the current version\x1b[0m
    `);
}
