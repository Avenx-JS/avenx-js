import fs from 'fs';
import path from 'path';
import { parseName, fail } from '../utils.js';

/**
 * Automatically removes imports, registrations, and mount statements for a class from src/main.app.js.
 * @param {object} cli
 * @param {string} className
 * @param {string} folderName
 */
export function unregisterFromMainApp(cli, className, folderName) {
  const mainPath = path.join(cli.baseDir, cli.config.srcDir, 'main.app.js');
  if (!fs.existsSync(mainPath)) return;

  const content = fs.readFileSync(mainPath, 'utf-8');

  // Remove import statements
  const importRegex = new RegExp(
    `^import\\s+(?:${className}|\\{\\s*${className}\\s*\\})\\s+from\\s+['"].*?${folderName}.*?['"];?\\r?\\n?`,
    'm',
  );
  const generalImportRegex = new RegExp(
    `^import\\s+(?:${className}|\\{\\s*${className}\\s*\\})\\s+from\\s+['"].*?['"];?\\r?\\n?`,
    'm',
  );

  // Remove app.register calls
  const registerRegex = new RegExp(
    `^\\s*app\\.register\\(\\s*['"]${className}['"]\\s*,\\s*${className}\\s*\\);?\\r?\\n?`,
    'm',
  );

  // Remove app.mount calls and their commented versions
  const mountRegex = new RegExp(`^\\s*(?://\\s*)?app\\.mount\\(\\s*['"]${className}['"]\\s*\\);?\\r?\\n?`, 'm');
  const commentedMountRegex = new RegExp(
    `^\\s*(?://\\s*)?app\\.mount\\(\\s*['"]${className}['"]\\s*\\);?\\s*//\\s*Uncomment\\s+to\\s+mount\\s+this\\s+component\\r?\\n?`,
    'm',
  );

  let newContent = content
    .replace(commentedMountRegex, '')
    .replace(mountRegex, '')
    .replace(registerRegex, '')
    .replace(importRegex, '');

  if (newContent === content) {
    newContent = content
      .replace(commentedMountRegex, '')
      .replace(mountRegex, '')
      .replace(registerRegex, '')
      .replace(generalImportRegex, '');
  } else {
    newContent = newContent.replace(generalImportRegex, '');
  }

  // Clean up extra consecutive newlines
  newContent = newContent.replace(/\n{3,}/g, '\n\n');

  if (content !== newContent) {
    fs.writeFileSync(mainPath, newContent);
    console.log(`✅ Cleaned up imports and registrations for '${className}' in ${cli.config.srcDir}/main.app.js`);
  }
}

/**
 * Destroys a component folder and template files, and unregisters it from main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function destroyComponent(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a component name (e.g., avenx d my-component)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);
  const compDir = path.join(cli.baseDir, cli.config.srcDir, 'components', lowerName);

  if (dryRun) {
    console.log(`🧪 [Dry Run] Component '${lowerName}' files would be deleted:`);
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.js`);
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.css`);
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/`);
    console.log(
      `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove registrations/imports for '${capitalizedName}'.`,
    );
    console.log('🧪 [Dry Run] No files were deleted or modified.');
    return;
  }

  if (fs.existsSync(compDir)) {
    fs.rmSync(compDir, { recursive: true, force: true });
    console.log(`✅ Component '${lowerName}' directory deleted at ${cli.config.srcDir}/components/${lowerName}/`);
  } else {
    console.log(`ℹ️ Component '${lowerName}' directory was not found.`);
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}

/**
 * Destroys a page class and template files, and unregisters it from main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function destroyPage(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a page name (e.g., avenx d page home)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);
  const pageDir = path.join(cli.baseDir, cli.config.srcDir, 'pages');
  const jsPath = path.join(pageDir, `${lowerName}.page.js`);
  const cssPath = path.join(pageDir, `${lowerName}.page.css`);

  if (dryRun) {
    console.log(`🧪 [Dry Run] Page '${lowerName}' files would be deleted:`);
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.js`);
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.css`);
    console.log(
      `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove imports/registrations/routes for '${capitalizedName}'.`,
    );
    console.log('🧪 [Dry Run] No files were deleted or modified.');
    return;
  }

  let deletedAny = false;
  if (fs.existsSync(jsPath)) {
    fs.rmSync(jsPath, { force: true });
    console.log(`  Deleted: ${cli.config.srcDir}/pages/${lowerName}.page.js`);
    deletedAny = true;
  }
  if (fs.existsSync(cssPath)) {
    fs.rmSync(cssPath, { force: true });
    console.log(`  Deleted: ${cli.config.srcDir}/pages/${lowerName}.page.css`);
    deletedAny = true;
  }

  if (deletedAny) {
    console.log(`✅ Page '${capitalizedName}' files deleted.`);
  } else {
    console.log(`ℹ️ Page '${capitalizedName}' files were not found.`);
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}

/**
 * Destroys a Bridge class file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function destroyBridge(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a bridge name (e.g., avenx d bridge auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Bridge';
  const globalDir = path.join(cli.baseDir, cli.config.srcDir, 'global');
  const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);

  if (dryRun) {
    console.log(`🧪 [Dry Run] Bridge '${capitalizedName}' file would be deleted:`);
    console.log(`  ${cli.config.srcDir}/global/${lowerName}.bridge.js`);
    console.log(
      `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove imports/registrations for '${capitalizedName}'.`,
    );
    console.log('🧪 [Dry Run] No files were deleted or modified.');
    return;
  }

  if (fs.existsSync(bridgePath)) {
    fs.rmSync(bridgePath, { force: true });
    console.log(`✅ Bridge '${capitalizedName}' file deleted at ${cli.config.srcDir}/global/${lowerName}.bridge.js`);
  } else {
    console.log(`ℹ️ Bridge '${capitalizedName}' file was not found.`);
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}

/**
 * Destroys a Guard class file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function destroyGuard(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a guard name (e.g., avenx d guard auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Guard';
  const guardDir = path.join(cli.baseDir, cli.config.srcDir, 'guards');
  const guardPath = path.join(guardDir, `${lowerName}.guard.js`);

  if (dryRun) {
    console.log(`🧪 [Dry Run] Guard '${capitalizedName}' file would be deleted:`);
    console.log(`  ${cli.config.srcDir}/guards/${lowerName}.guard.js`);
    console.log(
      `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove imports/registrations for '${capitalizedName}'.`,
    );
    console.log('🧪 [Dry Run] No files were deleted or modified.');
    return;
  }

  if (fs.existsSync(guardPath)) {
    fs.rmSync(guardPath, { force: true });
    console.log(`✅ Guard '${capitalizedName}' file deleted at ${cli.config.srcDir}/guards/${lowerName}.guard.js`);
  } else {
    console.log(`ℹ️ Guard '${capitalizedName}' file was not found.`);
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}
