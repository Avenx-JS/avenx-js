import fs from 'fs';
import path from 'path';
import { displayName, flatten, resolveSymbol, walk } from '../../lib/compiler/atlas/query.js';
import { cyan, gray, green, yellow } from '../colors.js';
import { fail, parseName } from '../utils.js';
import { buildModel } from './atlas.js';

/**
 * Whether a file belongs to the symbol being destroyed, or is main.app.js
 * (which destroy already rewrites).
 * @param {string} file
 * @param {string[]} ownPathSuffixes
 * @returns {boolean}
 */
function isOwnedOrCleanedUp(file, ownPathSuffixes) {
  const normalized = String(file || '').replace(/\\/g, '/');
  if (normalized.endsWith('main.app.js')) return true;
  return ownPathSuffixes.some((suffix) => normalized.includes(suffix.replace(/\\/g, '/')));
}

/**
 * Remaining references Atlas models to `symbolName`, excluding the files
 * destroy will delete and the main.app.js registrations it already cleans up.
 * @param {object} cli
 * @param {string} symbolName
 * @param {string[]} ownPathSuffixes
 * @returns {{name: string, location: string}[]}
 */
function pathMatchesOwn(file, ownPathSuffixes) {
  const normalized = String(file || '').replace(/\\/g, '/');
  return ownPathSuffixes.some((suffix) => normalized.includes(suffix.replace(/\\/g, '/')));
}

function findOwnerNodes(model, symbolNames, ownPathSuffixes) {
  const found = [];
  const seen = new Set();
  const add = (node) => {
    if (!node) return;
    const owner = node.owner ? model.getNode(node.owner) || node : node;
    if (seen.has(owner.id)) return;
    seen.add(owner.id);
    found.push(owner);
  };

  // Owner nodes (especially bridges) may have no loc; members in the same
  // file still identify the symbol being destroyed.
  for (const node of model.nodes.values()) {
    const file = node.loc && node.loc.file;
    if (file && pathMatchesOwn(file, ownPathSuffixes)) add(node);
  }
  if (found.length > 0) return found;

  for (const symbol of symbolNames) {
    for (const node of resolveSymbol(model, symbol)) add(node);
  }
  return found;
}

function findRemainingReferences(cli, symbolName, ownPathSuffixes) {
  let model;
  try {
    model = buildModel(cli);
  } catch (error) {
    console.log(yellow(`⚠️  Could not analyse remaining references: ${error.message}`));
    return [];
  }

  const symbolNames = Array.isArray(symbolName) ? symbolName : [symbolName];
  const matches = findOwnerNodes(model, symbolNames, ownPathSuffixes);
  if (matches.length === 0) return [];

  const refs = [];
  const seen = new Set();

  for (const target of matches) {
    const result = walk(model, target.id, { direction: 'in', depth: 12 });
    for (const entry of flatten(result.root)) {
      const node = model.getNode(entry.id);
      const loc = entry.loc && entry.loc.file ? entry.loc : node && node.loc;
      const file = loc && loc.file;
      if (!file || isOwnedOrCleanedUp(file, ownPathSuffixes)) continue;

      const location = loc.line ? `${file}:${loc.line}` : file;
      const key = `${location}:${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        name: displayName(model, node) || entry.name || entry.id,
        location,
      });
    }
  }

  return refs;
}

/**
 * Prints remaining references and, unless `--force` or a dry-run, refuses to
 * delete the symbol.
 * @param {string} kind
 * @param {string} name
 * @param {{name: string, location: string}[]} refs
 * @param {{dryRun?: boolean, force?: boolean}} options
 * @returns {boolean} True when destruction should stop.
 */
function reportAndMaybeRefuse(kind, name, refs, { dryRun = false, force = false } = {}) {
  if (refs.length === 0) return false;

  const heading = dryRun
    ? `🧪 [Dry Run] These references would break if ${kind} '${name}' were deleted:`
    : `⚠️  These references would break if ${kind} '${name}' is deleted:`;
  console.log(dryRun ? cyan(heading) : yellow(heading));
  for (const ref of refs) {
    console.log(gray(`  - ${ref.name} (${ref.location})`));
  }

  if (dryRun) {
    console.log(cyan('🧪 [Dry Run] Destroy would refuse without --force.'));
    return false;
  }

  if (force) {
    console.log(yellow(`⚠️  --force: deleting ${kind} '${name}' anyway.`));
    return false;
  }

  fail(
    `Cannot destroy ${kind} '${name}' because ${refs.length} reference${refs.length === 1 ? '' : 's'} remain. Re-run with --force to delete it anyway.`,
  );
  return true;
}

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
    console.log(
      green(`✅ Cleaned up imports and registrations for '${className}' in ${cli.config.srcDir}/main.app.js`),
    );
  }
}

/**
 * Destroys a component folder and template files, and unregisters it from main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 */
export function destroyComponent(cli, name, dryRun = false, force = false) {
  if (!name) {
    fail('Please provide a component name (e.g., avenx d my-component)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);
  const compDir = path.join(cli.baseDir, cli.config.srcDir, 'components', lowerName);
  const testPath = path.join(compDir, `${lowerName}.component.test.js`);
  const refs = findRemainingReferences(cli, [capitalizedName, lowerName], [`/components/${lowerName}/`]);
  if (reportAndMaybeRefuse('component', lowerName, refs, { dryRun, force })) {
    return;
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Component '${lowerName}' files would be deleted:`));
    console.log(gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.js`));
    console.log(
      gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.css`),
    );
    if (fs.existsSync(testPath)) {
      console.log(
        gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.test.js`),
      );
    }
    console.log(gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/components/${lowerName}/`));
    console.log(
      cyan(
        `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove registrations/imports for '${capitalizedName}'.`,
      ),
    );
    console.log(cyan('🧪 [Dry Run] No files were deleted or modified.'));
    return;
  }

  if (fs.existsSync(compDir)) {
    fs.rmSync(compDir, { recursive: true, force: true });
    console.log(
      green(`✅ Component '${lowerName}' directory deleted at ${cli.config.srcDir}/components/${lowerName}/`),
    );
  } else {
    console.log(gray(`ℹ️ Component '${lowerName}' directory was not found.`));
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}

/**
 * Destroys a page class and template files, and unregisters it from main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 */
export function destroyPage(cli, name, dryRun = false, force = false) {
  if (!name) {
    fail('Please provide a page name (e.g., avenx d page home)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);
  const pageDir = path.join(cli.baseDir, cli.config.srcDir, 'pages');
  const jsPath = path.join(pageDir, `${lowerName}.page.js`);
  const cssPath = path.join(pageDir, `${lowerName}.page.css`);
  const refs = findRemainingReferences(
    cli,
    [capitalizedName, lowerName],
    [`/pages/${lowerName}.page.js`, `/pages/${lowerName}.page.css`],
  );
  if (reportAndMaybeRefuse('page', lowerName, refs, { dryRun, force })) {
    return;
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Page '${lowerName}' files would be deleted:`));
    console.log(gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/pages/${lowerName}.page.js`));
    console.log(gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/pages/${lowerName}.page.css`));
    console.log(
      cyan(
        `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove imports/registrations/routes for '${capitalizedName}'.`,
      ),
    );
    console.log(cyan('🧪 [Dry Run] No files were deleted or modified.'));
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
    console.log(green(`✅ Page '${capitalizedName}' files deleted.`));
  } else {
    console.log(gray(`ℹ️ Page '${capitalizedName}' files were not found.`));
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}

/**
 * Destroys a Bridge class file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 */
export function destroyBridge(cli, name, dryRun = false, force = false) {
  if (!name) {
    fail('Please provide a bridge name (e.g., avenx d bridge auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Bridge';
  const globalDir = path.join(cli.baseDir, cli.config.srcDir, 'global');
  const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);
  const refs = findRemainingReferences(cli, [capitalizedName, lowerName], [`/global/${lowerName}.bridge.js`]);
  if (reportAndMaybeRefuse('bridge', capitalizedName, refs, { dryRun, force })) {
    return;
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Bridge '${capitalizedName}' file would be deleted:`));
    console.log(gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/global/${lowerName}.bridge.js`));
    console.log(
      cyan(
        `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove imports/registrations for '${capitalizedName}'.`,
      ),
    );
    console.log(cyan('🧪 [Dry Run] No files were deleted or modified.'));
    return;
  }

  if (fs.existsSync(bridgePath)) {
    fs.rmSync(bridgePath, { force: true });
    console.log(
      green(`✅ Bridge '${capitalizedName}' file deleted at ${cli.config.srcDir}/global/${lowerName}.bridge.js`),
    );
  } else {
    console.log(gray(`ℹ️ Bridge '${capitalizedName}' file was not found.`));
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}

/**
 * Destroys a Guard class file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 */
export function destroyGuard(cli, name, dryRun = false, force = false) {
  if (!name) {
    fail('Please provide a guard name (e.g., avenx d guard auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Guard';
  const guardDir = path.join(cli.baseDir, cli.config.srcDir, 'guards');
  const guardPath = path.join(guardDir, `${lowerName}.guard.js`);
  const refs = findRemainingReferences(cli, [capitalizedName, lowerName], [`/guards/${lowerName}.guard.js`]);
  if (reportAndMaybeRefuse('guard', capitalizedName, refs, { dryRun, force })) {
    return;
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Guard '${capitalizedName}' file would be deleted:`));
    console.log(gray(`[DRY-RUN] Would delete: ${cli.config.srcDir}/guards/${lowerName}.guard.js`));
    console.log(
      cyan(
        `🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated to remove imports/registrations for '${capitalizedName}'.`,
      ),
    );
    console.log(cyan('🧪 [Dry Run] No files were deleted or modified.'));
    return;
  }

  if (fs.existsSync(guardPath)) {
    fs.rmSync(guardPath, { force: true });
    console.log(
      green(`✅ Guard '${capitalizedName}' file deleted at ${cli.config.srcDir}/guards/${lowerName}.guard.js`),
    );
  } else {
    console.log(gray(`ℹ️ Guard '${capitalizedName}' file was not found.`));
  }

  unregisterFromMainApp(cli, capitalizedName, lowerName);
}
