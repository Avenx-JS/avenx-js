import fs from 'fs';
import path from 'path';
import { parseName, readTemplate, abortIfGeneratedPathExists, fail } from '../utils.js';

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
  console.log(`✅ Component '${className}' registered in ${cli.config.srcDir}/main.app.js`);
}

/**
 * Generates a new Bridge class and template file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function generateBridge(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a bridge name (e.g., avenx g bridge auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Bridge';

  const globalDir = path.join(cli.baseDir, cli.config.srcDir, 'global');
  const bridgePath = path.join(globalDir, `${lowerName}.bridge.js`);

  if (abortIfGeneratedPathExists(cli.baseDir, 'Bridge', lowerName, [bridgePath])) {
    return;
  }

  if (dryRun) {
    console.log(
      `🧪 [Dry Run] Bridge '${capitalizedName}' would be created at ${cli.config.srcDir}/global/${lowerName}.bridge.js`,
    );
    console.log('🧪 [Dry Run] No files were written.');
    return;
  }

  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'bridge', 'bridge.js.template');

  fs.writeFileSync(bridgePath, template.replace(/{{ name }}/g, capitalizedName));

  console.log(`✅ Bridge '${capitalizedName}' generated at ${cli.config.srcDir}/global/${lowerName}.bridge.js`);
  console.log(`ℹ️ It will be automatically registered as '${capitalizedName}' on the next build.`);
}

/**
 * Generates a new Guard class and template file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function generateGuard(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a guard name (e.g., avenx g guard auth)');
    return;
  }

  const { capitalizedName: baseName, folderFileName: lowerName } = parseName(name);
  const capitalizedName = baseName + 'Guard';

  const guardDir = path.join(cli.baseDir, cli.config.srcDir, 'guards');
  const guardPath = path.join(guardDir, `${lowerName}.guard.js`);

  if (abortIfGeneratedPathExists(cli.baseDir, 'Guard', lowerName, [guardPath])) {
    return;
  }

  if (dryRun) {
    console.log(
      `🧪 [Dry Run] Guard '${capitalizedName}' would be created at ${cli.config.srcDir}/guards/${lowerName}.guard.js`,
    );
    console.log('🧪 [Dry Run] No files were written.');
    return;
  }

  if (!fs.existsSync(guardDir)) {
    fs.mkdirSync(guardDir, { recursive: true });
  }

  const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'guard', 'guard.js.template');

  fs.writeFileSync(guardPath, template.replace(/{{ name }}/g, capitalizedName));

  console.log(`✅ Guard '${capitalizedName}' generated at ${cli.config.srcDir}/guards/${lowerName}.guard.js`);
  console.log(`ℹ️ It can be used in your route configurations.`);
}

/**
 * Generates a new Page class and template files.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function generatePage(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a page name (e.g., avenx g page home)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);

  const pageDir = path.join(cli.baseDir, cli.config.srcDir, 'pages');
  const jsPath = path.join(pageDir, `${lowerName}.page.js`);
  const cssPath = path.join(pageDir, `${lowerName}.page.css`);

  if (abortIfGeneratedPathExists(cli.baseDir, 'Page', lowerName, [jsPath, cssPath])) {
    return;
  }

  if (dryRun) {
    console.log(`🧪 [Dry Run] Page '${capitalizedName}' would be created at:`);
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.js`);
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.css`);
    console.log('🧪 [Dry Run] No files were written.');
    return;
  }

  if (!fs.existsSync(pageDir)) {
    fs.mkdirSync(pageDir, { recursive: true });
  }

  const jsTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'page', 'page.js.template');
  const cssTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'page', 'page.css.template');

  fs.writeFileSync(jsPath, jsTemplate.replace(/{{ name }}/g, capitalizedName));
  fs.writeFileSync(cssPath, cssTemplate);

  console.log(`✅ Page '${capitalizedName}' generated at ${cli.config.srcDir}/pages/${lowerName}.page.js`);
  console.log(`ℹ️ It will be automatically registered and routed if you update src/main.app.js.`);
}

/**
 * Generates a new component folder and template files, and registers it in main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean} [dryRun]
 */
export function generateComponent(cli, name, dryRun = false) {
  if (!name) {
    fail('Please provide a component name (e.g., avenx g my-component)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);

  const compDir = path.join(cli.baseDir, cli.config.srcDir, 'components', lowerName);

  if (abortIfGeneratedPathExists(cli.baseDir, 'Component', lowerName, [compDir])) {
    return;
  }

  if (dryRun) {
    console.log(`🧪 [Dry Run] Component '${lowerName}' would be created at:`);
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.js`);
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.css`);
    console.log(`🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated with:`);
    console.log(`  import ${capitalizedName} from './components/${lowerName}/${lowerName}.component.js';`);
    console.log(`  app.register('${capitalizedName}', ${capitalizedName});`);
    console.log('🧪 [Dry Run] No files were written.');
    return;
  }

  fs.mkdirSync(compDir, { recursive: true });

  const jsTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'component', 'component.js.template');
  const cssTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'component', 'component.css.template');

  fs.writeFileSync(
    path.join(compDir, `${lowerName}.component.js`),
    jsTemplate.replace('{{ name }}', capitalizedName),
  );
  fs.writeFileSync(path.join(compDir, `${lowerName}.component.css`), cssTemplate);

  console.log(`✅ Component '${lowerName}' generated at ${cli.config.srcDir}/components/${lowerName}/`);
  registerInMainApp(cli, capitalizedName, lowerName);
}
