import fs from 'fs';
import path from 'path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { buildModel } from './atlas.js';
import { bold, cyan, green, yellow, gray } from '../colors.js';

/**
 * Formats byte counts into human readable strings (e.g. 500 B, 1.25 KB, 2.10 MB).
 * @param {number} bytes - Size in bytes.
 * @returns {string} Formatted size string.
 */
export function formatBytes(bytes) {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Converts a string to PascalCase.
 * @param {string} str
 * @returns {string}
 */
function toPascalCase(str) {
  if (!str) return '';
  return str
    .replace(/[-_.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Recursively gets all files in a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function getAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extracts raw template content from component source code.
 * @param {string} content
 * @returns {string}
 */
function extractRawTemplate(content) {
  if (!content) return '';
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<state.*? \/>/g, '')
    .replace(/<computed.*? \/>/g, '')
    .replace(/<action.*?>[\s\S]*?<\/action>/g, '')
    .replace(/<resource.*?>[\s\S]*?<\/resource>/g, '')
    .replace(/<resource\s+[\s\S]*?\/>/gi, '')
    .trim();
}

/**
 * Reads what each unit declares from the compiler's semantic model.
 *
 * Keyed by file path rather than by name: `stats` derives a display name from
 * whatever `class X` a file contains, while the compiler names a unit after
 * its file. Those disagree often enough that matching on them would silently
 * report zero. The path is the same fact on both sides.
 *
 * Falls back to per-file parsing when the model cannot be built — `stats` is a
 * footprint report and should still produce byte sizes for a project that does
 * not currently compile.
 * @param {object} cli - The AvenxCLI instance.
 * @returns {{available: boolean, stateCounts: Map<string, number>}} Declared
 *   state counts by root-relative file path.
 */
function collectSemantics(cli) {
  /** @type {Map<string, number>} */
  const stateCounts = new Map();
  try {
    const model = buildModel(cli);
    if (model.errors.length > 0) {
      return { available: false, stateCounts };
    }
    for (const node of model.nodes.values()) {
      if (node.kind !== AtlasNodeKind.STATE || !node.owner) continue;
      const owner = model.getNode(node.owner);
      if (!owner || !owner.file) continue;
      stateCounts.set(owner.file, (stateCounts.get(owner.file) || 0) + 1);
    }
    return { available: true, stateCounts };
  } catch {
    return { available: false, stateCounts };
  }
}

/**
 * Scans the project source directory and collects component, page, bridge, and guard metrics.
 * @param {object} cli - AvenxCLI instance containing baseDir and config.
 * @returns {object} Analysis result containing summary and item metrics.
 */
export function analyzeStats(cli) {
  const srcRel = (cli.config && cli.config.srcDir) || 'src';
  const rootDir = cli.baseDir || process.cwd();
  const srcDir = path.join(rootDir, srcRel);

  const allFiles = getAllFiles(srcDir);
  // ComponentParser's first argument is a StyleProcessor. It used to be handed
  // the config object, so every styleProcessor.process() call threw into the
  // catch below and scoped CSS was silently reported as zero bytes.
  const parser = new ComponentParser(new StyleProcessor((cli.config && cli.config.style) || {}, cli.config), (cli.config && cli.config.voidTags) || [], cli.config);

  // Byte sizes have to be measured from the files. What each file *is*, and
  // what it declares, is something the compiler already knows, so those come
  // from the model rather than from a second set of regexes.
  const semantics = collectSemantics(cli);

  const items = [];
  let totalFiles = 0;
  let totalComponents = 0;
  let totalPages = 0;
  let totalBridges = 0;
  let totalGuards = 0;

  let totalFileSizeBytes = 0;
  let totalRawTemplateBytes = 0;
  let totalCompiledTemplateBytes = 0;
  let totalScopedCssBytes = 0;
  let totalStateProps = 0;

  for (const file of allFiles) {
    if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;

    const relPath = path.relative(rootDir, file).split(path.sep).join('/');
    const filename = path.basename(file);
    const stat = fs.statSync(file);
    const fileSizeBytes = stat.size;

    const isPage = file.includes(`${path.sep}pages${path.sep}`) || filename.endsWith('.page.js');
    const isBridge =
      file.includes(`${path.sep}bridges${path.sep}`) ||
      file.includes(`${path.sep}global${path.sep}`) ||
      filename.endsWith('.bridge.js');
    const isGuard = file.includes(`${path.sep}guards${path.sep}`) || filename.endsWith('.guard.js');
    const isComponent =
      !isPage &&
      !isBridge &&
      !isGuard &&
      (file.includes(`${path.sep}components${path.sep}`) || filename.endsWith('.component.js'));

    let type = 'other';
    if (isComponent) type = 'component';
    else if (isPage) type = 'page';
    else if (isBridge) type = 'bridge';
    else if (isGuard) type = 'guard';

    const content = fs.readFileSync(file, 'utf-8');
    const classMatch = content.match(/(?:export\s+(?:default\s+)?)?class\s+([A-Za-z0-9_$]+)/);
    let name;
    if (classMatch) {
      name = classMatch[1];
    } else {
      const base = filename
        .replace(/\.component\.js$/, '')
        .replace(/\.page\.js$/, '')
        .replace(/\.bridge\.js$/, '')
        .replace(/\.guard\.js$/, '')
        .replace(/\.js$/, '');
      name = toPascalCase(base);
    }

    let statePropsCount = semantics.stateCounts.get(relPath) || 0;
    let rawTemplateBytes = 0;
    let compiledTemplateBytes = 0;
    let scopedCssBytes = 0;

    try {
      const state = parser.expressionParser.parseState(content);
      if (!semantics.available) {
        statePropsCount = Object.keys(state || {}).length;
      }

      if (isComponent || isPage) {
        // 2. Raw template extraction & byte size
        const rawTpl = extractRawTemplate(content);
        rawTemplateBytes = Buffer.byteLength(rawTpl, 'utf8');

        // 3. Compiled template extraction & byte size
        const compiledTpl = parser.extractTemplate(content, {}, name, file, state, {}, {});
        compiledTemplateBytes = Buffer.byteLength(compiledTpl || '', 'utf8');

        // 4. Scoped CSS extraction & byte size
        let rawCss = '';
        const styleMatch = content.match(/<style[\s\S]*?>([\s\S]*?)<\/style>/i);
        if (styleMatch) {
          rawCss = styleMatch[1];
        }
        const cssFile = file.replace(/\.(component|page)\.js$/, '.$1.css');
        if (fs.existsSync(cssFile)) {
          rawCss += '\n' + fs.readFileSync(cssFile, 'utf-8');
        }
        if (rawCss.trim()) {
          const scopedCss = parser.styleProcessor.process(rawCss, {}, name, '');
          scopedCssBytes = Buffer.byteLength(scopedCss || '', 'utf8');
        }
      }
    } catch {
      // Fallback on parse failure
    }

    totalFiles++;
    if (isComponent) totalComponents++;
    else if (isPage) totalPages++;
    else if (isBridge) totalBridges++;
    else if (isGuard) totalGuards++;

    totalFileSizeBytes += fileSizeBytes;
    totalRawTemplateBytes += rawTemplateBytes;
    totalCompiledTemplateBytes += compiledTemplateBytes;
    totalScopedCssBytes += scopedCssBytes;
    totalStateProps += statePropsCount;

    items.push({
      name,
      type,
      file: relPath,
      fileSizeBytes,
      rawTemplateBytes,
      compiledTemplateBytes,
      scopedCssBytes,
      statePropsCount,
    });
  }

  items.sort((a, b) => a.file.localeCompare(b.file));

  let templateReductionPercent = 0;
  if (totalRawTemplateBytes > 0) {
    const diff = totalRawTemplateBytes - totalCompiledTemplateBytes;
    templateReductionPercent = Number(((diff / totalRawTemplateBytes) * 100).toFixed(1));
  }

  return {
    summary: {
      totalFiles,
      totalComponents,
      totalPages,
      totalBridges,
      totalGuards,
      totalFileSizeBytes,
      totalRawTemplateBytes,
      totalCompiledTemplateBytes,
      totalScopedCssBytes,
      totalStateProps,
      templateReductionPercent,
    },
    items,
  };
}

/**
 * Runs the `avenx stats` CLI command to output footprint metrics in text or JSON format.
 * @param {object} cli - AvenxCLI instance.
 * @param {string[]} [args] - Command arguments.
 */
export function runStats(cli, args = []) {
  const isJson = args.includes('--json') || args.includes('-j');
  const statsData = analyzeStats(cli);

  if (isJson) {
    console.log(JSON.stringify(statsData, null, 2));
    return;
  }

  const { summary, items } = statsData;
  const srcRel = (cli.config && cli.config.srcDir) || 'src';

  console.log(bold(cyan(`📊 Avenx Component & Bundle Footprint Metrics (${srcRel}/)`)));
  console.log(gray(`Project: ${cli.baseDir}\n`));

  if (items.length === 0) {
    console.log(gray('No source files found in ') + cyan(`${srcRel}/`) + gray('.'));
    return;
  }

  // Print Items Table
  console.log(
    bold(
      [
        'Name'.padEnd(25),
        'Type'.padEnd(12),
        'File Size'.padStart(10),
        'Raw Tpl'.padStart(10),
        'Comp Tpl'.padStart(10),
        'CSS Size'.padStart(10),
        'State'.padStart(7),
      ].join('  '),
    ),
  );
  console.log(gray('─'.repeat(85)));

  for (const item of items) {
    const fileStr = formatBytes(item.fileSizeBytes).padStart(10);
    const rawStr = item.rawTemplateBytes > 0 ? formatBytes(item.rawTemplateBytes).padStart(10) : gray('-'.padStart(10));
    const compStr =
      item.compiledTemplateBytes > 0 ? formatBytes(item.compiledTemplateBytes).padStart(10) : gray('-'.padStart(10));
    const cssStr = item.scopedCssBytes > 0 ? formatBytes(item.scopedCssBytes).padStart(10) : gray('-'.padStart(10));
    const stateStr = String(item.statePropsCount).padStart(7);

    const typeStr =
      item.type === 'component'
        ? green('Component'.padEnd(12))
        : item.type === 'page'
          ? cyan('Page'.padEnd(12))
          : item.type === 'bridge'
            ? yellow('Bridge'.padEnd(12))
            : gray(item.type.padEnd(12));

    console.log(
      `${item.name.padEnd(25)}  ${typeStr}  ${fileStr}  ${rawStr}  ${compStr}  ${cssStr}  ${stateStr}`,
    );
  }

  console.log(gray('─'.repeat(85)));

  // Summary Totals
  console.log(`\n${bold(cyan('Summary Totals:'))}`);
  console.log(`  ${gray('Total Files:')}            ${bold(String(summary.totalFiles))}`);
  console.log(
    `  ${gray('  Components:')}         ${green(String(summary.totalComponents))}  |  ${gray('Pages:')} ${cyan(String(summary.totalPages))}  |  ${gray('Bridges:')} ${yellow(String(summary.totalBridges))}`,
  );
  console.log(`  ${gray('Total Source Size:')}      ${bold(formatBytes(summary.totalFileSizeBytes))}`);
  console.log(`  ${gray('Raw Template Payload:')}   ${formatBytes(summary.totalRawTemplateBytes)}`);
  console.log(
    `  ${gray('Compiled Template:')}      ${formatBytes(summary.totalCompiledTemplateBytes)} (${summary.templateReductionPercent >= 0 ? `-${summary.templateReductionPercent}%` : `+${Math.abs(summary.templateReductionPercent)}%`})`,
  );
  console.log(`  ${gray('Scoped CSS Payload:')}     ${formatBytes(summary.totalScopedCssBytes)}`);
  console.log(`  ${gray('State Properties:')}       ${summary.totalStateProps}\n`);
}
