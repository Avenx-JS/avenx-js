import fs from 'fs';
import path from 'path';
import { parseName, readTemplate, abortIfGeneratedPathExists, fail } from '../utils.js';
import { cyan, gray, green, yellow } from '../colors.js';

/**
 * Automatically adds import and registration for a component in src/main.app.js.
 * @param {object} cli
 * @param {string} className
 * @param {string} folderName
 */
export function registerInMainApp(cli, className, folderName) {
  const mainPath = path.join(cli.baseDir, cli.config.srcDir, 'main.app.js');
  if (!fs.existsSync(mainPath)) return;

  const content = fs.readFileSync(mainPath, 'utf-8');
  const importStatement = `import ${className} from './components/${folderName}/${folderName}.component.js';`;
  const registerStatement = `app.register('${className}', ${className});`;

  const lines = content.split('\n');
  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ')) lastImportIndex = i;
  }

  if (lastImportIndex !== -1) {
    lines.splice(lastImportIndex + 1, 0, importStatement);
  } else {
    lines.unshift(importStatement);
  }

  let lastRegisterIndex = -1;
  let appInstanceIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('app.register(')) lastRegisterIndex = i;
    if (lines[i].includes('new AvenxApp')) appInstanceIndex = i;
  }

  if (lastRegisterIndex !== -1) {
    lines.splice(lastRegisterIndex + 1, 0, registerStatement);
  } else if (appInstanceIndex !== -1) {
    lines.splice(appInstanceIndex + 1, 0, '', registerStatement);
  } else {
    lines.push('', registerStatement);
  }

  const hasMount = lines.some((line) => line.includes('app.mount('));
  if (!hasMount) {
    lines.push(`\napp.mount('${className}');`);
  } else {
    lines.push(`// app.mount('${className}'); // Uncomment to mount this component`);
  }

  fs.writeFileSync(mainPath, lines.join('\n'));
  console.log(green(`✅ Component '${className}' registered in ${cli.config.srcDir}/main.app.js`));
}

/**
 * Generates a new Bridge module.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 */
export function generateBridge(cli, name, dryRun = false, force = false, templateName = null) {
  if (!name) {
    fail('Please provide a bridge name (e.g., avenx g bridge auth)');
    return;
  }

  const { folderFileName: lowerName } = parseName(name);
  // A bridge is identified by its module, so its name is simply the file name
  // in camelCase — the same identifier you would import it under.
  const bridgeName = lowerName
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');

  const globalDir = path.join(cli.baseDir, cli.config.srcDir, 'global');
  const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);

  if (!force && abortIfGeneratedPathExists(cli.baseDir, 'Bridge', lowerName, [bridgePath])) {
    return;
  }

  if (force && fs.existsSync(bridgePath)) {
    console.warn(yellow(`⚠️ Force enabled: overwriting existing Bridge '${lowerName}'.`));
  }

  if (dryRun) {
    console.log(
      cyan(`🧪 [Dry Run] Bridge '${bridgeName}' would be created at ${cli.config.srcDir}/global/${lowerName}.bridge.js`),
    );
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'bridge', 'bridge.js.template', templateName);

  fs.writeFileSync(
    bridgePath,
    template.replace(/{{ name }}/g, bridgeName).replace(/{{ file }}/g, lowerName),
  );

  console.log(green(`✅ Bridge '${bridgeName}' generated at ${cli.config.srcDir}/global/${lowerName}.bridge.js`));
  console.log(
    gray(`ℹ️ Import it where you need it: import ${bridgeName} from '<path>/global/${lowerName}.bridge.js';`),
  );
}

/**
 * Generates a new Guard class and template file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 */
export function generateGuard(cli, name, dryRun = false, force = false, templateName = null) {
  if (!name) {
    fail('Please provide a guard name (e.g., avenx g guard auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Guard';

  const guardDir = path.join(cli.baseDir, cli.config.srcDir, 'guards');
  const guardPath = path.join(guardDir, `${lowerName}.guard.js`);

  if (!force && abortIfGeneratedPathExists(cli.baseDir, 'Guard', lowerName, [guardPath])) {
    return;
  }

  if (force && fs.existsSync(guardPath)) {
    console.warn(yellow(`⚠️ Force enabled: overwriting existing Guard '${lowerName}'.`));
  }

  if (dryRun) {
    console.log(
      cyan(`🧪 [Dry Run] Guard '${capitalizedName}' would be created at ${cli.config.srcDir}/guards/${lowerName}.guard.js`),
    );
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  if (!fs.existsSync(guardDir)) {
    fs.mkdirSync(guardDir, { recursive: true });
  }

  const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'guard', 'guard.js.template', templateName);

  fs.writeFileSync(guardPath, template.replace(/{{ name }}/g, capitalizedName));

  console.log(green(`✅ Guard '${capitalizedName}' generated at ${cli.config.srcDir}/guards/${lowerName}.guard.js`));
  console.log(gray(`ℹ️ It can be used in your route configurations.`));
}

/**
 * Generates a new Page class and template files.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 */
export function generatePage(cli, name, dryRun = false, force = false, templateName = null) {
  if (!name) {
    fail('Please provide a page name (e.g., avenx g page home)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);

  const pageDir = path.join(cli.baseDir, cli.config.srcDir, 'pages');
  const jsPath = path.join(pageDir, `${lowerName}.page.js`);
  const cssPath = path.join(pageDir, `${lowerName}.page.css`);

  if (!force && abortIfGeneratedPathExists(cli.baseDir, 'Page', lowerName, [jsPath, cssPath])) {
    return;
  }

  if (force && (fs.existsSync(jsPath) || fs.existsSync(cssPath))) {
    console.warn(yellow(`⚠️ Force enabled: overwriting existing Page '${lowerName}'.`));
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Page '${capitalizedName}' would be created at:`));
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.js`);
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.css`);
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  if (!fs.existsSync(pageDir)) {
    fs.mkdirSync(pageDir, { recursive: true });
  }

  const jsTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'page', 'page.js.template', templateName);
  const cssTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'page', 'page.css.template', templateName);

  fs.writeFileSync(jsPath, jsTemplate.replace(/{{ name }}/g, capitalizedName));
  fs.writeFileSync(cssPath, cssTemplate);

  console.log(green(`✅ Page '${capitalizedName}' generated at ${cli.config.srcDir}/pages/${lowerName}.page.js`));
  console.log(gray(`ℹ️ It will be automatically registered and routed if you update src/main.app.js.`));
}

/**
 * Generates a new component folder and template files, and registers it in main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 */
export function generateComponent(cli, name, dryRun = false, force = false, templateName = null) {
  if (!name) {
    fail('Please provide a component name (e.g., avenx g my-component)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);

  const compDir = path.join(cli.baseDir, cli.config.srcDir, 'components', lowerName);

  if (!force && abortIfGeneratedPathExists(cli.baseDir, 'Component', lowerName, [compDir])) {
    return;
  }

  if (force && fs.existsSync(compDir)) {
    console.warn(yellow(`⚠️ Force enabled: overwriting existing Component '${lowerName}'.`));
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Component '${lowerName}' would be created at:`));
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.js`);
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.css`);
    console.log(cyan(`🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated with:`));
    console.log(`  import ${capitalizedName} from './components/${lowerName}/${lowerName}.component.js';`);
    console.log(`  app.register('${capitalizedName}', ${capitalizedName});`);
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  fs.mkdirSync(compDir, { recursive: true });

  const jsTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'component', 'component.js.template', templateName);
  const cssTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'component', 'component.css.template', templateName);

  fs.writeFileSync(
    path.join(compDir, `${lowerName}.component.js`),
    jsTemplate.replace(/{{ name }}/g, capitalizedName),
  );
  fs.writeFileSync(path.join(compDir, `${lowerName}.component.css`), cssTemplate);

  console.log(green(`✅ Component '${lowerName}' generated at ${cli.config.srcDir}/components/${lowerName}/`));
  registerInMainApp(cli, capitalizedName, lowerName);
}
