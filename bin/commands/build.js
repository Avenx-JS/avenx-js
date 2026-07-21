import fs from 'fs';
import path from 'path';
import AvenxCompiler from '../../lib/compiler.js';

/**
 * Runs the compiler build.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 */
export function buildProject(cli) {
  new AvenxCompiler(cli.config).build();
}

/**
 * Cleans the project by deleting the build output directory.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 */
export function cleanProject(cli) {
  const distDir = path.join(cli.baseDir, cli.config.distDir);
  if (fs.existsSync(distDir)) {
    console.log(`🧹 Cleaning build output directory: ${cli.config.distDir}...`);
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('✅ Clean complete.');
  } else {
    console.log(`🧹 Build output directory ${cli.config.distDir} does not exist. Nothing to clean.`);
  }
}

/**
 * Validates template files without building.
 * @param {object} cli - AvenxCLI instance containing config and baseDir.
 */
export function checkProject(cli) {
  const originalWarn = console.warn;
  let warningCount = 0;

  console.warn = (...messages) => {
    warningCount++;
    originalWarn(...messages);
  };

  const compiler = new AvenxCompiler(cli.config);

  compiler.processComponents();
  compiler.processPages();

  console.warn = originalWarn;

  if (warningCount > 0) {
    console.error(`\nFound ${warningCount} validation warning(s).`);
    process.exit(1);
  }

  console.log('✓ No template validation issues found.');

  process.exit(0);
}
