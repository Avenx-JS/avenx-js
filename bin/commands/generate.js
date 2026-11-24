import fs from 'fs';
import path from 'path';
import { parseName, readTemplate, abortIfGeneratedPathExists, fail } from '../utils.js';
import { yellow, cyan, green, gray } from '../colors.js';
import { getClosestKey } from '../../lib/config.js';

/**
 * Renders generator placeholders while preserving runtime bindings in component and page templates.
 * @param {string} template
 * @param {string} templateFile
 * @param {object} names
 * @param {object} [options]
 * @returns {string}
 */
function renderTemplate(template, templateFile, names, options = {}) {
  const { allowRuntimeBindings = false, legacyTestName = false } = options;
  const supported = ['PascalCaseName', 'name', 'file'];

  return template.replace(/{{\s*([^{}]*?)\s*}}/g, (match, rawKey) => {
    const key = rawKey.trim();

    if (key === 'PascalCaseName') return names.pascalName;
    if (key === 'file') return names.fileName;

    if (key === 'name') {
      // The original test template used {{name}} as a filename.
      if (legacyTestName && match === '{{name}}') {
        return names.fileName;
      }

      // Preserve the legacy meaning of the spaced placeholder.
      return match === '{{name}}' ? names.pascalName : names.legacyName;
    }

    const suggestion = getClosestKey(key, supported);

    if (allowRuntimeBindings) {
      // Component/page files also contain runtime expressions.
      // Only reject clear generator-like misspellings.
      const looksLikeGeneratorTypo =
        /^pascal/i.test(key) ||
        (/^[A-Z]/.test(key) && suggestion !== null) ||
        (/^(?:file|name)/i.test(key) && suggestion !== null);

      if (!looksLikeGeneratorTypo) {
        return match;
      }
    }

    const didYouMean = suggestion ? ` Did you mean "{{${suggestion}}}"?` : '';

    throw new Error(
      `Unknown generator placeholder "${match}" in "${templateFile}".` +
        didYouMean +
        ` Supported placeholders: ${supported.map((value) => `{{${value}}}`).join(', ')}.`,
    );
  });
}

/**
 * Checks if test generation is enabled via CLI flag or avenx config.
 * @param {object} cli
 * @param {boolean} [withTestFlag]
 * @param {boolean} [noTestFlag]
 * @returns {boolean}
 */
function shouldGenerateTest(cli, withTestFlag, noTestFlag) {
  if (noTestFlag) return false;
  if (withTestFlag) return true;
  if (cli?.config?.generate && typeof cli.config.generate.withTests === 'boolean') {
    return cli.config.generate.withTests;
  }
  return false;
}

/**
 * Removes the `@css` references from a scaffolded template written without a
 * stylesheet: the `<@css name />` tags and the `@css name` attributes. Left in
 * place they would name style blocks that no stylesheet declares (AVX_W49).
 * @param {string} content - The rendered template.
 * @returns {string} The template without style references.
 */
export function stripStyleReferences(content) {
  return content.replace(/^[ \t]*<@css\s+[\w-]+\s*\/>[ \t]*\r?\n/gm, '').replace(/[ \t]+@css\s+[\w-]+/g, '');
}

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
  // Drop the trailing blank lines first, so the file keeps one blank line
  // before the new statement and ends with a single newline.
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (!hasMount) {
    lines.push('', `app.mount('${className}');`);
  } else {
    lines.push(`// app.mount('${className}'); // Uncomment to mount this component`);
  }

  fs.writeFileSync(mainPath, `${lines.join('\n')}\n`);
  console.log(green(`✅ Component '${className}' registered in ${cli.config.srcDir}/main.app.js`));
}

/**
 * Generates a new Bridge class and template file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean|object} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 */
export function generateBridge(cli, name, dryRun = false, force = false, templateName = null) {
  if (typeof dryRun === 'object' && dryRun !== null) {
    force = dryRun.force || false;
    templateName = dryRun.templateName || null;
    dryRun = dryRun.dryRun || false;
  }

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
      cyan(
        `🧪 [Dry Run] Bridge '${bridgeName}' would be created at ${cli.config.srcDir}/global/${lowerName}.bridge.js`,
      ),
    );
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  const template = readTemplate(
    cli.baseDir,
    cli.config,
    cli.frameworkDir,
    'bridge',
    'bridge.js.template',
    templateName,
  );

  const content = renderTemplate(template, 'bridge/bridge.js.template', {
    legacyName: bridgeName,
    pascalName: parseName(name).capitalizedName,
    fileName: lowerName,
  });

  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(bridgePath, content);

  console.log(green(`✅ Bridge '${bridgeName}' generated at ${cli.config.srcDir}/global/${lowerName}.bridge.js`));
  console.log(
    gray(`ℹ️ Import it where you need it: import ${bridgeName} from '<path>/global/${lowerName}.bridge.js';`),
  );
}

/**
 * Generates a new Guard class and template file.
 * @param {object} cli
 * @param {string} name
 * @param {boolean|object} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 */
export function generateGuard(cli, name, dryRun = false, force = false, templateName = null) {
  if (typeof dryRun === 'object' && dryRun !== null) {
    force = dryRun.force || false;
    templateName = dryRun.templateName || null;
    dryRun = dryRun.dryRun || false;
  }

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
      cyan(
        `🧪 [Dry Run] Guard '${capitalizedName}' would be created at ${cli.config.srcDir}/guards/${lowerName}.guard.js`,
      ),
    );
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'guard', 'guard.js.template', templateName);

  const content = renderTemplate(template, 'guard/guard.js.template', {
    legacyName: capitalizedName,
    pascalName: capitalizedName,
    fileName: lowerName,
  });

  fs.mkdirSync(guardDir, { recursive: true });
  fs.writeFileSync(guardPath, content);

  console.log(green(`✅ Guard '${capitalizedName}' generated at ${cli.config.srcDir}/guards/${lowerName}.guard.js`));
  console.log(gray(`ℹ️ It can be used in your route configurations.`));
}

/**
 * Generates a new Page class and template files.
 * @param {object} cli
 * @param {string} name
 * @param {boolean|object} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 * @param {boolean} [noStyle] - Skip the stylesheet and the template's `@css` references.
 */
export function generatePage(cli, name, dryRun = false, force = false, templateName = null, noStyle = false) {
  if (typeof dryRun === 'object' && dryRun !== null) {
    force = dryRun.force || false;
    templateName = dryRun.templateName || null;
    noStyle = dryRun.noStyle || false;
    dryRun = dryRun.dryRun || false;
  }

  if (!name) {
    fail('Please provide a page name (e.g., avenx g page home)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);

  const pageDir = path.join(cli.baseDir, cli.config.srcDir, 'pages');
  const jsPath = path.join(pageDir, `${lowerName}.page.js`);
  const cssPath = path.join(pageDir, `${lowerName}.page.css`);
  const willGenerateStyle = !noStyle;

  if (!force && abortIfGeneratedPathExists(cli.baseDir, 'Page', lowerName, [jsPath, cssPath])) {
    return;
  }

  if (force && (fs.existsSync(jsPath) || fs.existsSync(cssPath))) {
    console.warn(yellow(`⚠️ Force enabled: overwriting existing Page '${lowerName}'.`));
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Page '${capitalizedName}' would be created at:`));
    console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.js`);
    if (willGenerateStyle) {
      console.log(`  ${cli.config.srcDir}/pages/${lowerName}.page.css`);
    }
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  const jsTemplate = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'page', 'page.js.template', templateName);

  const cssTemplate = willGenerateStyle
    ? readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'page', 'page.css.template', templateName)
    : null;

  const pageNames = {
    legacyName: capitalizedName,
    pascalName: capitalizedName,
    fileName: lowerName,
  };

  const renderedPage = renderTemplate(jsTemplate, 'page/page.js.template', pageNames, { allowRuntimeBindings: true });
  const jsContent = willGenerateStyle ? renderedPage : stripStyleReferences(renderedPage);

  const cssContent = willGenerateStyle ? renderTemplate(cssTemplate, 'page/page.css.template', pageNames) : null;

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(jsPath, jsContent);
  if (willGenerateStyle) {
    fs.writeFileSync(cssPath, cssContent);
  }

  console.log(green(`✅ Page '${capitalizedName}' generated at ${cli.config.srcDir}/pages/${lowerName}.page.js`));
  reportPageWiring(cli, capitalizedName, lowerName);
}

/**
 * Tells the developer what to add so the new page can actually be reached.
 *
 * The previous line read "it will be automatically registered and routed if
 * you update src/main.app.js", which says both that nothing is required and
 * that something is. Nothing is automatic: a page the route table does not
 * name is compiled into the bundle and never rendered, and the application
 * shows an empty container with no error. A developer who followed
 * `avenx init` and `avenx generate page` reached exactly that, so this prints
 * the line to add rather than alluding to it.
 * @param {object} cli - The CLI instance.
 * @param {string} className - The generated page's class name.
 * @param {string} lowerName - The kebab-case file name.
 * @returns {void}
 */
function reportPageWiring(cli, className, lowerName) {
  const mainAppPath = path.join(cli.baseDir, cli.config.srcDir, 'main.app.js');
  const route = lowerName === 'home' || lowerName === 'index' ? '' : `#/${lowerName}`;

  let source;
  try {
    source = fs.readFileSync(mainAppPath, 'utf8');
  } catch {
    console.log(gray(`ℹ️ Add a route for it in ${cli.config.srcDir}/main.app.js.`));
    return;
  }

  if (new RegExp(`['"\`]${className}['"\`]`).test(source)) {
    console.log(gray(`ℹ️ ${cli.config.srcDir}/main.app.js already names '${className}'.`));
    return;
  }

  if (/\binitRouter\s*\(/.test(source)) {
    console.log(gray(`ℹ️ Add it to the route table in ${cli.config.srcDir}/main.app.js:`));
    console.log(gray(`     '${route}': '${className}',`));
    return;
  }

  console.log(gray(`ℹ️ Nothing routes to it yet. Add to ${cli.config.srcDir}/main.app.js:`));
  console.log(gray(`     app.initRouter({ '${route}': '${className}' });`));
  console.log(gray('   Without a route, the page is bundled but never rendered (AVX_W53).'));
}

/**
 * Generates a new component folder and template files, and registers it in main.app.js.
 * @param {object} cli
 * @param {string} name
 * @param {boolean|object} [dryRun]
 * @param {boolean} [force]
 * @param {string|null} [templateName]
 * @param {boolean} [withTest]
 * @param {boolean} [noTest]
 * @param {boolean} [noStyle] - Skip the stylesheet and the template's `@css` references.
 */
export function generateComponent(
  cli,
  name,
  dryRun = false,
  force = false,
  templateName = null,
  withTest = false,
  noTest = false,
  noStyle = false,
) {
  if (typeof dryRun === 'object' && dryRun !== null) {
    force = dryRun.force || false;
    templateName = dryRun.templateName || null;
    withTest = dryRun.withTest || false;
    noTest = dryRun.noTest || false;
    noStyle = dryRun.noStyle || false;
    dryRun = dryRun.dryRun || false;
  } else if (typeof force === 'boolean' && typeof templateName === 'boolean') {
    // Backward compatibility if called as (cli, name, dryRun, withTest, noTest)
    noTest = templateName;
    withTest = force;
    force = false;
    templateName = null;
  }

  if (!name) {
    fail('Please provide a component name (e.g., avenx g my-component)');
    return;
  }

  const { capitalizedName, folderFileName: lowerName } = parseName(name);
  const compDir = path.join(cli.baseDir, cli.config.srcDir, 'components', lowerName);
  const willGenerateTest = shouldGenerateTest(cli, withTest, noTest);
  const willGenerateStyle = !noStyle;

  const jsPath = path.join(compDir, `${lowerName}.component.js`);
  const cssPath = path.join(compDir, `${lowerName}.component.css`);
  const testPath = path.join(compDir, `${lowerName}.component.test.js`);

  const pathsToCheck = [compDir];
  if (!force && abortIfGeneratedPathExists(cli.baseDir, 'Component', lowerName, pathsToCheck)) {
    return;
  }

  if (force && fs.existsSync(compDir)) {
    console.warn(yellow(`⚠️ Force enabled: overwriting existing Component '${lowerName}'.`));
  }

  if (dryRun) {
    console.log(cyan(`🧪 [Dry Run] Component '${lowerName}' would be created at:`));
    console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.js`);
    if (willGenerateStyle) {
      console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.css`);
    }
    if (willGenerateTest) {
      console.log(`  ${cli.config.srcDir}/components/${lowerName}/${lowerName}.component.test.js`);
    }
    console.log(cyan(`🧪 [Dry Run] ${cli.config.srcDir}/main.app.js would be updated with:`));
    console.log(`  import ${capitalizedName} from './components/${lowerName}/${lowerName}.component.js';`);
    console.log(`  app.register('${capitalizedName}', ${capitalizedName});`);
    console.log(cyan('🧪 [Dry Run] No files were written.'));
    return;
  }

  const jsTemplate = readTemplate(
    cli.baseDir,
    cli.config,
    cli.frameworkDir,
    'component',
    'component.js.template',
    templateName,
  );

  const cssTemplate = willGenerateStyle
    ? readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'component', 'component.css.template', templateName)
    : null;

  const testTemplate = willGenerateTest
    ? readTemplate(cli.baseDir, cli.config, cli.frameworkDir, 'component', 'component.test.js.template', templateName)
    : null;

  const names = {
    legacyName: capitalizedName,
    pascalName: capitalizedName,
    fileName: lowerName,
  };

  // Validate all templates before writing any generated files.
  const renderedComponent = renderTemplate(jsTemplate, 'component/component.js.template', names, {
    allowRuntimeBindings: true,
  });
  const jsContent = willGenerateStyle ? renderedComponent : stripStyleReferences(renderedComponent);

  const cssContent = willGenerateStyle ? renderTemplate(cssTemplate, 'component/component.css.template', names) : null;

  const testContent = willGenerateTest
    ? renderTemplate(testTemplate, 'component/component.test.js.template', names, { legacyTestName: true })
    : null;

  fs.mkdirSync(compDir, { recursive: true });

  fs.writeFileSync(jsPath, jsContent);
  if (willGenerateStyle) {
    fs.writeFileSync(cssPath, cssContent);
  }

  if (willGenerateTest) {
    fs.writeFileSync(testPath, testContent);
  }

  console.log(green(`✅ Component '${lowerName}' generated at ${cli.config.srcDir}/components/${lowerName}/`));
  registerInMainApp(cli, capitalizedName, lowerName);
}
