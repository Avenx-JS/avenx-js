import fs from 'fs';
import path from 'path';
import { readTemplate } from '../utils.js';
import { analyzeBridge, memberParams } from '../../lib/compiler/BridgeParser.js';
import { AppModel, AtlasEdgeKind, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { addBridgeUnit } from '../../lib/compiler/atlas/build.js';
import { effectiveRoutePattern, parseRouteTable } from '../../lib/compiler/atlas/routes.js';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

/**
 * Checks whether the project or caller specifies a custom test template for the given kind.
 * @param {object} cli - The CLI instance.
 * @param {string} kind - Scaffold kind (`component`, `page`, `bridge`, or `guard`).
 * @param {string|null} templateName - Explicit `--template` name, if any.
 * @returns {boolean} True when a named or local override template should be used.
 */
export function hasCustomTestTemplate(cli, kind, templateName) {
  if (templateName) return true;
  const filename = `${kind}.test.js.template`;
  const dirs = [cli.config?.templatesDir || '.avenxtemplates', 'templates'].filter(
    (dir, idx, self) => dir && self.indexOf(dir) === idx,
  );
  for (const dir of dirs) {
    if (fs.existsSync(path.join(cli.baseDir, dir, kind, filename))) return true;
    if (fs.existsSync(path.join(cli.baseDir, dir, filename))) return true;
  }
  return false;
}

/**
 * Reads the setup header comment from a built-in test template.
 * @param {object} cli - The CLI instance.
 * @param {string} kind - Scaffold kind (`page` or `bridge`).
 * @returns {string} The header block up to the first `import` statement.
 */
function readSetupHeader(cli, kind) {
  const template = readTemplate(cli.baseDir, cli.config, cli.frameworkDir, kind, `${kind}.test.js.template`);
  const match = template.match(/^import /m);
  return match ? template.slice(0, match.index) : '';
}

/**
 * Formats a property access expression for a bridge member.
 * @param {string} target - The bridge identifier.
 * @param {string} key - The state key name.
 * @returns {string} Valid JavaScript property access.
 */
function formatMemberAccess(target, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${target}.${key}` : `${target}[${JSON.stringify(key)}]`;
}

/**
 * Finds the route parameter names and a sample hash for a page, if its route declares any.
 * @param {object} cli - The CLI instance.
 * @param {string} pageName - The PascalCase page class name.
 * @returns {{ hash: string, params: Record<string, string> }|null} Route setup, or null when no route declares params.
 */
function findPageRouteParams(cli, pageName) {
  const mainAppPath = path.join(cli.baseDir, cli.config.srcDir, 'main.app.js');
  if (!fs.existsSync(mainAppPath)) return null;

  const source = fs.readFileSync(mainAppPath, 'utf8');
  const routes = parseRouteTable(source).filter((route) => route.page === pageName);

  for (const route of routes) {
    const effective = effectiveRoutePattern(route.pattern, route.prefix);
    const normalized = RouteMatcher.normalizePattern(effective);
    const { paramNames } = RouteMatcher.compileRoute(normalized);
    if (paramNames.length === 0) continue;

    let sampleHash = normalized;
    /** @type {Record<string, string>} */
    const params = {};
    for (const param of paramNames) {
      const value = param === 'wildcard' ? 'sample' : '42';
      params[param] = value;
      sampleHash = param === 'wildcard' ? sampleHash.replace('*', value) : sampleHash.replace(`:${param}`, value);
    }
    return { hash: sampleHash, params };
  }

  return null;
}

/**
 * Generates a test for an existing page, adding route-param setup only when the page's route declares params.
 * @param {object} cli - The CLI instance.
 * @param {object} names - Normalized scaffold names.
 * @param {string} names.pascalName - PascalCase page class name.
 * @param {string} names.fileName - Kebab-case file stem.
 * @returns {string} The generated test file contents.
 */
export function generateExistingPageTest(cli, { pascalName, fileName }) {
  const header = readSetupHeader(cli, 'page');
  const routeSetup = findPageRouteParams(cli, pascalName);

  if (routeSetup) {
    const paramEntries = Object.entries(routeSetup.params).map(([key, value]) => {
      const formattedKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`;
      return `${formattedKey}: '${value}'`;
    });
    const paramsLiteral = `{ ${paramEntries.join(', ')} }`;

    return (
      header +
      `import { describe, it, expect, onTestFinished } from 'vitest';\n` +
      `import { AvenxMock, mountTestComponent } from 'avenx-core/testing';\n` +
      `import ${pascalName} from './${fileName}.page.js';\n\n` +
      `describe('${pascalName} Page', () => {\n` +
      `  it('renders with route params', async () => {\n` +
      `    const router = AvenxMock.createMockRouter({\n` +
      `      hash: '${routeSetup.hash}',\n` +
      `      page: '${pascalName}',\n` +
      `      params: ${paramsLiteral},\n` +
      `    });\n` +
      `    onTestFinished(() => router.$destroy());\n\n` +
      `    const wrapper = await mountTestComponent(${pascalName});\n` +
      `    onTestFinished(() => wrapper.unmount());\n\n` +
      `    expect(wrapper.container.children.length).toBeGreaterThan(0);\n\n` +
      `    // TODO: test what ${pascalName} renders. For example:\n` +
      `    //   expect(wrapper.instance.state.title).toBe('${pascalName}');\n` +
      `    //   expect(wrapper.find('h1').textContent).toMatch(/${pascalName}/);\n` +
      `    //   expect(wrapper.find('p').textContent).toMatch(/.../);\n` +
      `  });\n` +
      `});\n`
    );
  }

  return (
    header +
    `import { describe, it, expect, onTestFinished } from 'vitest';\n` +
    `import { mountTestComponent } from 'avenx-core/testing';\n` +
    `import ${pascalName} from './${fileName}.page.js';\n\n` +
    `describe('${pascalName} Page', () => {\n` +
    `  it('renders', async () => {\n` +
    `    const wrapper = await mountTestComponent(${pascalName});\n` +
    `    onTestFinished(() => wrapper.unmount());\n\n` +
    `    expect(wrapper.container.children.length).toBeGreaterThan(0);\n\n` +
    `    // TODO: test what ${pascalName} renders. For example:\n` +
    `    //   expect(wrapper.instance.state.title).toBe('${pascalName}');\n` +
    `    //   expect(wrapper.find('h1').textContent).toMatch(/${pascalName}/);\n` +
    `    //   expect(wrapper.find('p').textContent).toMatch(/.../);\n` +
    `  });\n` +
    `});\n`
  );
}

/**
 * Finds the matching closing brace/bracket/paren for an opening one, skipping strings and comments.
 * @param {string} source - The source text.
 * @param {number} openIndex - Offset of the opening delimiter.
 * @returns {{ end: number, commas: number[] }} Closing offset (or -1) and top-level comma offsets.
 */
function scanDelimitedBlock(source, openIndex) {
  let depth = 0;
  let index = openIndex;
  const commas = [];

  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];

    if (ch === '/' && next === '/') {
      const endLine = source.indexOf('\n', index);
      index = endLine === -1 ? source.length : endLine;
      continue;
    }
    if (ch === '/' && next === '*') {
      const endBlock = source.indexOf('*/', index + 2);
      index = endBlock === -1 ? source.length : endBlock + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      index++;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === ch) break;
        index++;
      }
      index++;
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return { end: index, commas };
    } else if (ch === ',' && depth === 1) {
      commas.push(index);
    }

    index++;
  }

  return { end: -1, commas };
}

/**
 * Classifies a state key's initializer expression into a literal form when statically known.
 * @param {string} rawExpr - The raw initializer text after `:`.
 * @returns {{ kind: string, value?: *, literal?: string }} The parsed literal info.
 */
function classifyInitializer(rawExpr) {
  const expr = rawExpr
    .replace(/\/\/[^\n]*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (/^-?\d+(?:\.\d+)?$/.test(expr)) {
    return { kind: 'number', value: Number(expr), literal: expr };
  }
  if (expr === 'true' || expr === 'false') {
    return { kind: 'boolean', value: expr === 'true', literal: expr };
  }
  if (expr === 'null') {
    return { kind: 'null', value: null, literal: 'null' };
  }
  if (expr === 'undefined') {
    return { kind: 'undefined', value: undefined, literal: 'undefined' };
  }
  if (expr === '[]') {
    return { kind: 'array', value: [], literal: '[]' };
  }
  if (expr === '{}') {
    return { kind: 'object', value: {}, literal: '{}' };
  }
  const strMatch = expr.match(/^(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1$/);
  if (strMatch) {
    const inner = strMatch[2].replace(/\\'/g, "'").replace(/'/g, "\\'");
    return { kind: 'string', value: strMatch[2], literal: `'${inner}'` };
  }
  return { kind: 'unknown' };
}

/**
 * Extracts initializers for each key inside a bridge's `state: { ... }` literal.
 * @param {string} source - The bridge source text.
 * @param {object} descriptor - The bridge descriptor from `analyzeBridge`.
 * @returns {Map<string, { kind: string, value?: *, literal?: string }>} Initializers keyed by state key.
 */
function extractStateInitializers(source, descriptor) {
  const result = new Map();
  const stateKeys = new Set(descriptor.stateKeys);
  const stateMembers = (descriptor.members || []).filter((member) => member.kind === 'state');
  if (stateMembers.length === 0) return result;

  // Locate the enclosing `state: { ... }` block by walking back to the `{` before the first state member.
  const firstStart = stateMembers[0].valueStart;
  const stateKeyMatch = source.slice(0, firstStart).match(/state\s*:\s*\{[^}]*$/);
  if (!stateKeyMatch) return result;

  const stateBrace = source.indexOf('{', firstStart - stateKeyMatch[0].length);
  if (stateBrace === -1) return result;

  const { end, commas } = scanDelimitedBlock(source, stateBrace);
  if (end === -1) return result;

  const boundaries = [stateBrace, ...commas];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i] + 1;
    const stop = i + 1 < boundaries.length ? boundaries[i + 1] : end;
    const segment = source.slice(start, stop);
    const match = segment.match(
      /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/,
    );
    if (!match) continue;
    const key = match[2] !== undefined ? match[2] : match[3];
    if (stateKeys.has(key)) {
      result.set(key, classifyInitializer(match[4]));
    }
  }

  return result;
}

/**
 * Counts the top-level parameters in a parameter list string.
 * @param {string} paramsText - Text inside `(...)`.
 * @returns {number} Number of parameters.
 */
function countParams(paramsText) {
  const trimmed = paramsText.trim();
  if (!trimmed) return 0;
  let depth = 0;
  let count = 1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

/**
 * Picks a sample argument literal that differs from the target state's initial value.
 * @param {{ kind: string, value?: * }|undefined} initial - Initializer classification.
 * @returns {string} JavaScript argument literal.
 */
function sampleArgFor(initial) {
  if (!initial) return "'updated'";
  if (initial.kind === 'number') return initial.value === 1 ? '2' : '1';
  if (initial.kind === 'boolean') return initial.value === true ? 'false' : 'true';
  if (initial.kind === 'string') return initial.value === 'updated' ? "'next'" : "'updated'";
  return "'updated'";
}

/**
 * Generates a test for an existing bridge, asserting each declared state key's initial value
 * and that calling an action changes what it writes.
 * @param {object} cli - The CLI instance.
 * @param {object} names - Normalized scaffold names.
 * @param {string} names.legacyName - CamelCase bridge identifier.
 * @param {string} names.fileName - Kebab-case file stem.
 * @param {string} sourcePath - Absolute path to the `.bridge.js` file.
 * @returns {string} The generated test file contents.
 */
export function generateExistingBridgeTest(cli, { legacyName: bridgeVar, fileName }, sourcePath) {
  const header = readSetupHeader(cli, 'bridge');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const descriptor = analyzeBridge(sourcePath, source);

  if (!descriptor) {
    return (
      header +
      `import { describe, it, expect } from 'vitest';\n` +
      `import ${bridgeVar} from './${fileName}.bridge.js';\n\n` +
      `describe('${bridgeVar} Bridge', () => {\n` +
      `  it('exports a bridge instance', () => {\n` +
      `    expect(${bridgeVar}).toBeDefined();\n` +
      `  });\n` +
      `});\n`
    );
  }

  const initializers = extractStateInitializers(source, descriptor);
  const stateAssertions = descriptor.stateKeys.map((key) => {
    const access = formatMemberAccess(bridgeVar, key);
    const init = initializers.get(key);
    if (!init || init.kind === 'unknown') {
      return `    expect(${bridgeVar}).toHaveProperty('${key}');`;
    }
    if (init.kind === 'undefined') {
      return `    expect(${access}).toBeUndefined();`;
    }
    if (init.kind === 'array' || init.kind === 'object') {
      return `    expect(${access}).toEqual(${init.literal});`;
    }
    return `    expect(${access}).toBe(${init.literal});`;
  });

  const model = new AppModel();
  const ownerId = addBridgeUnit(model, descriptor, { rootDir: cli.baseDir, source });
  const stateKeySet = new Set(descriptor.stateKeys);

  const mutatingActions = descriptor.actions
    .map((actionName) => {
      const actionId = nodeId(AtlasNodeKind.ACTION, ownerId, actionName);
      const writtenKeys = model.edges
        .filter((edge) => edge.from === actionId && edge.kind === AtlasEdgeKind.WRITES)
        .map((edge) => model.getNode(edge.to)?.name)
        .filter((name) => name && stateKeySet.has(name));
      return { name: actionName, writtenKeys };
    })
    .filter((entry) => entry.writtenKeys.length > 0);

  const chosenAction =
    mutatingActions.find((entry) => !/^(reset|clear)/i.test(entry.name)) || mutatingActions[0] || null;

  const lines = [
    `${header}import { describe, it, expect } from 'vitest';`,
    `import ${bridgeVar} from './${fileName}.bridge.js';`,
    '',
    `describe('${bridgeVar} Bridge', () => {`,
  ];

  if (stateAssertions.length > 0) {
    lines.push(`  it('starts with its declared state', () => {`);
    lines.push(...stateAssertions);
    lines.push(`  });`);
  } else {
    lines.push(`  it('exports a bridge instance', () => {`);
    lines.push(`    expect(${bridgeVar}).toBeDefined();`);
    lines.push(`  });`);
  }

  if (chosenAction) {
    const targetKey = chosenAction.writtenKeys[0];
    const targetAccess = formatMemberAccess(bridgeVar, targetKey);
    const targetInit = initializers.get(targetKey);
    const beforeExpr =
      targetInit?.kind === 'array'
        ? `[...${targetAccess}]`
        : targetInit?.kind === 'object'
          ? `{ ...${targetAccess} }`
          : targetAccess;

    const member = (descriptor.members || []).find((m) => m.kind === 'action' && m.name === chosenAction.name);
    const paramCount = member?.body ? countParams(memberParams(source, member.body.start)) : 0;
    const args = Array.from({ length: paramCount }, () => sampleArgFor(targetInit));
    const callAccess = formatMemberAccess(bridgeVar, chosenAction.name);

    lines.push('');
    lines.push(`  it('updates ${targetKey} when ${chosenAction.name} is called', async () => {`);
    lines.push(`    const before = ${beforeExpr};`);
    lines.push('');
    lines.push(`    await ${callAccess}(${args.join(', ')});`);
    lines.push('');
    lines.push(`    expect(${targetAccess}).not.toEqual(before);`);
    lines.push(`  });`);
  }

  lines.push(`});`, '');
  return lines.join('\n');
}
